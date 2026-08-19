import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { readAppJson, type Project } from "./config";
import { resolveFontStack, sha256File } from "./fonts";
import { readGeneratedManifest, writeGeneratedManifest } from "./generated-manifest";
import { IssueList, type Issue } from "./issues";
import { displayRelative } from "./paths";
import { ExportRenderer, inspectPng } from "./render/export";
import { renderArtworkHtml } from "./render/html";
import type { RenderJob, PlanFilter } from "./render-plan";
import { buildRenderPlan } from "./render-plan";
import type { GeneratedManifest } from "./schema";
import { validateProject } from "./validate";

export interface GenerateOptions {
  filter?: PlanFilter;
  /** Any error or warning anywhere blocks all output (plan §13.4). */
  strict?: boolean;
  /** Skip deleting stale previously generated files (default: config.output.cleanBeforeRender). */
  noClean?: boolean;
  /** Re-render jobs whose inputs have not changed since the last run. */
  force?: boolean;
  /** Print the plan and exit without rendering. */
  dryRun?: boolean;
  log?: (line: string) => void;
  /** Injected for tests. */
  renderer?: ExportRenderer;
  now?: () => Date;
}

export type JobStatus = "rendered" | "failed" | "skipped" | "unchanged";

export interface JobResult {
  key: string;
  status: JobStatus;
  output?: string;
  issues: Issue[];
  durationMs: number;
}

export interface GenerationSummary {
  project: string;
  planned: number;
  rendered: number;
  failed: number;
  skipped: number;
  /** Jobs whose inputs matched the previous run; output kept as is (plan §20). */
  unchanged: number;
  aborted: boolean;
  issues: Issue[];
  jobs: JobResult[];
  filesWritten: string[];
  durationMs: number;
}

/** An issue blocks a job when its key names that job, its locale/screen, its locale, or its target/locale set. */
export function issueBlocksJob(issue: Issue, job: RenderJob): boolean {
  if (issue.level !== "error" || !issue.key) return false;
  return (
    issue.key === job.key ||
    issue.key === `${job.locale}/${job.screen.id}` ||
    issue.key === job.locale ||
    issue.key === `${job.target.id}/${job.locale}`
  );
}

/** Errors that name no job (config, manifest, font) abort the whole run. */
export function isGlobalError(issue: Issue, plan: RenderJob[]): boolean {
  if (issue.level !== "error") return false;
  return !plan.some((job) => issueBlocksJob(issue, job));
}

export async function generateProject(project: Project, opts: GenerateOptions = {}): Promise<GenerationSummary> {
  const started = Date.now();
  const log = opts.log ?? (() => {});
  const validation = validateProject(project);
  const issues = new IssueList().merge(validation.issues);
  const summary: GenerationSummary = {
    project: project.config.projectName,
    planned: 0,
    rendered: 0,
    failed: 0,
    skipped: 0,
    unchanged: 0,
    aborted: false,
    issues: issues.items,
    jobs: [],
    filesWritten: [],
    durationMs: 0,
  };

  const { stack: fontStack, missing: missingFonts } = resolveFontStack(project);
  const font = fontStack.find((f) => f.family.toLowerCase() === project.config.brand.font.family.toLowerCase());
  for (const m of missingFonts.filter((x) => x !== project.config.brand.font.family)) {
    issues.warn("font.fallback-missing", `Fallback font "${m}" is not available locally; it will be skipped`, {
      file: "store-shots.config.json",
      hint: `store-shots fonts add "${m}"`,
    });
  }
  if (!font) {
    issues.error("font.missing", `Font "${project.config.brand.font.family}" is not available locally`, {
      file: "store-shots.config.json",
      hint: `store-shots fonts add "${project.config.brand.font.family}" --project ${displayRelative(process.cwd(), project.root) || "."}`,
    });
  }

  if (!validation.manifest) {
    summary.aborted = true;
    summary.durationMs = Date.now() - started;
    return summary;
  }
  const plan = buildRenderPlan(project, validation.manifest, opts.filter);
  summary.planned = plan.length;

  // Classify against the unfiltered plan: an error that belongs to a job outside
  // the filter is irrelevant to this run, not a reason to abort it.
  const fullPlan = opts.filter ? buildRenderPlan(project, validation.manifest) : plan;
  const globalErrors = issues.items.filter((i) => isGlobalError(i, fullPlan));
  // Issues that matter for THIS run: global ones, ones blocking a planned job,
  // and keyless/warning ones. Errors scoped to jobs outside the filter are dropped.
  const relevant = issues.items.filter(
    (i) =>
      i.level !== "info" &&
      (isGlobalError(i, fullPlan) || plan.some((j) => issueBlocksJob(i, j)) || !i.key || i.level === "warn"),
  );
  summary.issues = relevant;
  if (globalErrors.length || (opts.strict && relevant.some((i) => i.level === "error" || i.level === "warn"))) {
    summary.aborted = true;
    summary.skipped = plan.length;
    summary.jobs = plan.map((j) => ({ key: j.key, status: "skipped", issues: [], durationMs: 0 }));
    summary.durationMs = Date.now() - started;
    return summary;
  }

  if (opts.dryRun) {
    summary.jobs = plan.map((j) => ({ key: j.key, status: "skipped", issues: [], durationMs: 0 }));
    summary.skipped = plan.length;
    summary.durationMs = Date.now() - started;
    return summary;
  }

  let previous: GeneratedManifest | undefined;
  try {
    previous = readGeneratedManifest(project);
  } catch (err) {
    issues.warn(
      "manifest.generated-unreadable",
      `Ignoring unreadable ${relOutput(project, plan[0] ?? ({ outputPath: project.paths.outputScreenshots } as RenderJob)).split("/")[0]}/.store-shots-manifest.json: ${(err as Error).message}`,
    );
  }
  const plannedPaths = new Set(plan.map((j) => relOutput(project, j)));
  // Stale = recorded by the previous run but no longer planned (screen removed, locale dropped...).
  // Only deleted on a full run; a filtered run must not touch jobs outside the filter.
  if (!opts.noClean && project.config.output.cleanBeforeRender && !opts.filter && previous) {
    const stale = previous.files.filter((f) => !plannedPaths.has(f.path));
    for (const f of stale) {
      const abs = path.join(project.paths.outputScreenshots, f.path);
      if (fs.existsSync(abs)) fs.rmSync(abs);
    }
    if (stale.length) log(`removed ${stale.length} stale file(s) from the previous run`);
    previous = { ...previous, files: previous.files.filter((f) => plannedPaths.has(f.path)) };
  }

  const renderer = opts.renderer ?? new ExportRenderer();
  const workDir = path.join(project.paths.generated, "export");
  const appVersion = safeAppVersion(project);
  const toolVersion = readToolVersion();
  // Entries for jobs outside this run's plan are carried over untouched.
  const files: GeneratedManifest["files"] = previous?.files.filter((f) => !plannedPaths.has(f.path)) ?? [];
  const fontHashes = fontStack.flatMap((f) => f.files.map((x) => x.sha256));

  try {
    await renderer.start();
    for (const job of plan) {
      const t0 = Date.now();
      const jobIssues = new IssueList();
      const blocking = issues.items.filter((i) => issueBlocksJob(i, job));
      if (blocking.length) {
        summary.jobs.push({ key: job.key, status: "skipped", issues: blocking, durationMs: 0 });
        summary.skipped++;
        log(`SKIP ${job.key}: ${blocking[0].message}`);
        continue;
      }
      const content = validation.content.get(job.locale)!;
      const rel = relOutput(project, job);
      const hash = inputsHash(project, job, content.screens[job.screen.id] ?? {}, toolVersion, fontHashes);
      const prevEntry = previous?.files.find((f) => f.path === rel);
      if (
        !opts.force &&
        prevEntry &&
        prevEntry.inputsSha256 === hash &&
        fs.existsSync(job.outputPath) &&
        sha256File(job.outputPath) === prevEntry.sha256
      ) {
        files.push(prevEntry);
        summary.unchanged++;
        summary.jobs.push({ key: job.key, status: "unchanged", output: rel, issues: [], durationMs: 0 });
        log(`SAME ${job.key} (inputs unchanged)`);
        continue;
      }
      try {
        const { html } = renderArtworkHtml(project, job, content, {
          sourceImage: pathToFileURL(job.sourcePath).href,
          fontUrl: (p) => pathToFileURL(p).href,
          assetUrl: (rel) => pathToFileURL(path.join(project.paths.assets, rel)).href,
        });
        const result = await renderer.render(job.key, html, job.target, {
          backgroundColor: project.config.output.backgroundColor,
          workDir,
        });
        const c = result.checks;
        if (c.fontsFailed.length)
          jobIssues.error("render.font-failed", `Font face(s) failed to load: ${c.fontsFailed.join(", ")}`, {
            key: job.key,
          });
        if (c.missingImages.length)
          jobIssues.error("render.missing-image", `Image(s) did not load: ${c.missingImages.join(", ")}`, {
            key: job.key,
          });
        for (const f of result.fits) {
          if (f.scale < 1 && f.fits) {
            jobIssues.info(
              "render.fitted",
              `"${f.id}" shrunk to ${Math.round(f.scale * 100)}% (${f.fromPx}px -> ${f.toPx}px) to fit`,
              { key: job.key },
            );
          }
        }
        for (const o of c.overflow) {
          const fit = result.fits.find((f) => f.id === o.id);
          const atMin = fit && fit.scale < 1 ? ` even at the minimum allowed size (${fit.toPx}px)` : "";
          const msg = `"${o.id}" overflows its box${atMin} (${o.scrollWidth}x${o.scrollHeight} in ${o.clientWidth}x${o.clientHeight})`;
          const extra = {
            key: job.key,
            file: displayRelative(project.root, path.join(project.paths.content, `${job.locale}.json`)),
            hint: `shorten screens.${job.screen.id}.${o.id} for ${job.locale}`,
          };
          if (project.config.validation.failOnOverflow) jobIssues.error("render.overflow", msg, extra);
          else jobIssues.warn("render.overflow", msg, extra);
        }
        for (const id of c.textOverlapsDevice) {
          const msg = `"${id}" overlaps the device shell`;
          if (project.config.validation.failOnTextOverlap)
            jobIssues.error("render.text-overlaps-device", msg, { key: job.key });
          else
            jobIssues.warn("render.text-overlaps-device", msg, {
              key: job.key,
              hint: "set validation.failOnTextOverlap to make this an error",
            });
        }
        if (result.width !== job.target.width || result.height !== job.target.height) {
          jobIssues.error(
            "render.size",
            `Output is ${result.width}x${result.height}, expected ${job.target.width}x${job.target.height}`,
            { key: job.key },
          );
        }
        if (result.channels !== 3)
          jobIssues.error("render.alpha", `Output has ${result.channels} channels, expected 3 (no alpha)`, {
            key: job.key,
          });

        if (!jobIssues.hasErrors) {
          fs.mkdirSync(path.dirname(job.outputPath), { recursive: true });
          const tmp = path.join(path.dirname(job.outputPath), `.${path.basename(job.outputPath)}.tmp`);
          fs.writeFileSync(tmp, result.png);
          const inspected = await inspectPng(tmp);
          if (
            inspected.width !== job.target.width ||
            inspected.height !== job.target.height ||
            inspected.hasAlpha ||
            inspected.format !== "png"
          ) {
            fs.rmSync(tmp, { force: true });
            jobIssues.error(
              "render.verify",
              `Written file failed inspection (${inspected.format} ${inspected.width}x${inspected.height} alpha=${inspected.hasAlpha})`,
              { key: job.key },
            );
          } else {
            fs.renameSync(tmp, job.outputPath);
            const rel = relOutput(project, job);
            files.push({
              path: rel,
              target: job.target.id,
              locale: job.locale,
              screen: job.screen.id,
              sha256: sha256File(job.outputPath),
              inputsSha256: hash,
            });
            summary.filesWritten.push(displayRelative(project.root, job.outputPath));
          }
        }
      } catch (err) {
        jobIssues.error("render.crash", (err as Error).message, { key: job.key });
      }
      issues.merge(jobIssues);
      const status: JobStatus = jobIssues.hasErrors ? "failed" : "rendered";
      if (status === "rendered") summary.rendered++;
      else summary.failed++;
      summary.jobs.push({
        key: job.key,
        status,
        output: status === "rendered" ? relOutput(project, job) : undefined,
        issues: jobIssues.items,
        durationMs: Date.now() - t0,
      });
      log(
        `${status === "rendered" ? "OK  " : "FAIL"} ${job.key}${status === "rendered" ? ` -> ${relOutput(project, job)}` : `: ${jobIssues.errors[0]?.message}`} (${Date.now() - t0} ms)`,
      );
    }
  } finally {
    if (!opts.renderer) await renderer.close();
  }

  files.sort((a, b) => a.path.localeCompare(b.path));
  writeGeneratedManifest(project, {
    version: 1,
    generatedAt: (opts.now ?? (() => new Date()))().toISOString(),
    appVersion,
    files,
  });
  summary.issues = [
    ...relevant,
    ...summary.jobs.flatMap((j) => (j.status === "skipped" || j.status === "unchanged" ? [] : j.issues)),
  ];
  summary.durationMs = Date.now() - started;
  return summary;
}

function relOutput(project: Project, job: RenderJob): string {
  return path.relative(project.paths.outputScreenshots, job.outputPath).split(path.sep).join("/");
}

function safeAppVersion(project: Project): string | undefined {
  try {
    const v = readAppJson(project)?.version;
    return typeof v === "string" ? v : undefined;
  } catch {
    return undefined;
  }
}

function readToolVersion(): string {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, "..", "package.json"), "utf8")) as {
      version?: string;
    };
    return pkg.version ?? "0";
  } catch {
    return "0";
  }
}

/** Stable hash of everything that influences one output file (for incremental rendering, Phase 7). */
export function inputsHash(
  project: Project,
  job: RenderJob,
  fields: Record<string, string | null | undefined>,
  toolVersion: string,
  fontHashes: string[],
): string {
  const h = crypto.createHash("sha256");
  h.update(
    JSON.stringify({
      toolVersion,
      target: job.target.id,
      locale: job.locale,
      screen: { id: job.screen.id, template: job.screen.template, overrides: job.screen.overrides },
      fields,
      brand: project.config.brand,
      output: project.config.output,
      source: sha256File(job.sourcePath),
      fonts: fontHashes,
    }),
  );
  return h.digest("hex");
}
