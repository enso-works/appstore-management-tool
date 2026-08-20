import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { readAppJson, type Project } from "./config";
import { requiredFontFamilies, resolveFontStack, sha256File } from "./fonts";
import { readGeneratedManifest, writeGeneratedManifest } from "./generated-manifest";
import { IssueList, type Issue } from "./issues";
import { displayRelative, resolveWithin } from "./paths";
import { ExportRenderer, inspectPng, slicePng } from "./render/export";
import { renderArtworkHtml } from "./render/html";
import type { RenderJob, PlanFilter } from "./render-plan";
import { buildRenderPlan } from "./render-plan";
import type { GeneratedManifest, LocaleContent } from "./schema";
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
  /** Compared with the previous generated manifest: files whose bytes changed, new files, files no longer produced. */
  changes: { changed: string[]; added: string[]; removed: string[] };
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
    changes: { changed: [], added: [], removed: [] },
    durationMs: 0,
  };

  const { stack: fontStack, missing: missingFonts } = resolveFontStack(project);
  const required = requiredFontFamilies(project);
  const font = required.every((fam) => fontStack.some((f) => f.family.toLowerCase() === fam.toLowerCase()))
    ? fontStack[0]
    : undefined;
  const alreadyReported = new Set(issues.items.filter((i) => i.code === "font.fallback-missing").map((i) => i.message));
  for (const m of missingFonts.filter((x) => !required.includes(x))) {
    if ([...alreadyReported].some((msg) => msg.includes(`"${m}"`))) continue;
    issues.warn("font.fallback-missing", `Fallback font "${m}" is not available locally; it will be skipped`, {
      file: "store-shots.config.json",
      hint: `store-shots fonts add "${m}"`,
    });
  }
  if (!font && !issues.items.some((i) => i.code === "font.missing")) {
    const missingRequired = required.filter((fam) => missingFonts.includes(fam));
    for (const fam of missingRequired) {
      issues.error("font.missing", `Font "${fam}" is not available locally`, {
        file: "store-shots.config.json",
        hint: `store-shots fonts add "${fam}" --project ${displayRelative(process.cwd(), project.root) || "."}`,
      });
    }
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
  let originalPrevious: GeneratedManifest | undefined;
  try {
    previous = readGeneratedManifest(project);
    originalPrevious = previous;
  } catch (err) {
    issues.warn(
      "manifest.generated-unreadable",
      `Ignoring unreadable ${project.config.paths.outputScreenshots}/.store-shots-manifest.json: ${(err as Error).message}`,
    );
  }
  const plannedPaths = new Set(
    plan.flatMap((j) => j.outputPaths.map((p) => path.relative(project.root, p).split(path.sep).join("/"))),
  );
  // Stale = recorded by the previous run but no longer planned (screen removed, locale dropped...).
  // Only deleted on a full run; a filtered run must not touch jobs outside the filter.
  if (!opts.noClean && project.config.output.cleanBeforeRender && !opts.filter && previous) {
    const stale = previous.files.filter((f) => !plannedPaths.has(f.path));
    for (const f of stale) {
      const abs = path.join(project.root, f.path);
      const relCheck = path.relative(project.root, abs);
      if (relCheck.startsWith("..") || path.isAbsolute(relCheck)) continue; // never follow an escaping entry
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
  const templatesHash = templatesSourceHash();

  try {
    await renderer.start();
    for (const job of plan) {
      const t0 = Date.now();
      const jobIssues = new IssueList();
      const rel = relOutput(project, job);
      const relPaths = job.outputPaths.map((p) => path.relative(project.root, p).split(path.sep).join("/"));
      const prevEntries = relPaths.map((rp) => previous?.files.find((f) => f.path === rp));
      const prevEntry = prevEntries[0];
      // A job that does not render this run keeps its previous manifest entries
      // (if any) so its old outputs stay tracked and cleanable.
      const keepPrevious = () => {
        prevEntries.forEach((e, i) => {
          if (e && fs.existsSync(job.outputPaths[i])) files.push(e);
        });
      };
      const blocking = issues.items.filter((i) => issueBlocksJob(i, job));
      if (!blocking.length && (job.sourceError || !fs.existsSync(job.sourcePath))) {
        // validateSources reports a missing file once; a second job sharing it must still be skipped, not crash.
        blocking.push({
          level: "error",
          code: "source.missing",
          message: job.sourceError ?? "Raw capture not found",
          key: job.key,
          file: displayRelative(project.root, job.sourcePath),
        });
      }
      if (blocking.length) {
        summary.jobs.push({ key: job.key, status: "skipped", issues: blocking, durationMs: 0 });
        summary.skipped++;
        keepPrevious();
        log(`SKIP ${job.key}: ${blocking[0].message}`);
        continue;
      }
      const content = validation.content.get(job.locale)!;
      const hash = inputsHash(project, job, content, toolVersion, fontHashes, templatesHash);
      if (
        !opts.force &&
        prevEntry &&
        prevEntries.every(
          (e, i) =>
            e &&
            e.inputsSha256 === hash &&
            fs.existsSync(job.outputPaths[i]) &&
            sha256File(job.outputPaths[i]) === e.sha256,
        )
      ) {
        for (const e of prevEntries) files.push(e!);
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
          canvasWidth: job.canvasWidth,
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
        if (result.width !== job.canvasWidth || result.height !== job.target.height) {
          jobIssues.error(
            "render.size",
            `Output is ${result.width}x${result.height}, expected ${job.canvasWidth}x${job.target.height}`,
            { key: job.key },
          );
        }
        if (result.channels !== 3)
          jobIssues.error("render.alpha", `Output has ${result.channels} channels, expected 3 (no alpha)`, {
            key: job.key,
          });

        if (!jobIssues.hasErrors) {
          const pngs =
            job.slices > 1 ? await slicePng(result.png, job.slices, job.target.width, job.target.height) : [result.png];
          const written: { path: string; slice: number; sha256: string }[] = [];
          for (let i = 0; i < pngs.length; i++) {
            const outPath = job.outputPaths[i];
            fs.mkdirSync(path.dirname(outPath), { recursive: true });
            const tmp = path.join(path.dirname(outPath), `.${path.basename(outPath)}.tmp`);
            fs.writeFileSync(tmp, pngs[i]);
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
              break;
            }
            fs.renameSync(tmp, outPath);
            written.push({
              path: path.relative(project.root, outPath).split(path.sep).join("/"),
              slice: i,
              sha256: sha256File(outPath),
            });
          }
          if (!jobIssues.hasErrors) {
            for (const w of written) {
              files.push({
                path: w.path,
                target: job.target.id,
                locale: job.locale,
                screen: job.screen.id,
                ...(job.slices > 1 ? { slice: w.slice } : {}),
                sha256: w.sha256,
                inputsSha256: hash,
              });
              summary.filesWritten.push(w.path);
            }
          }
        }
      } catch (err) {
        jobIssues.error("render.crash", (err as Error).message, { key: job.key });
      }
      issues.merge(jobIssues);
      const status: JobStatus = jobIssues.hasErrors ? "failed" : "rendered";
      if (status === "failed") keepPrevious();
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
  {
    const before = new Map((originalPrevious?.files ?? []).map((f) => [f.path, f.sha256]));
    const after = new Map(files.map((f) => [f.path, f.sha256]));
    for (const [p, sha] of after) {
      if (!before.has(p)) summary.changes.added.push(p);
      else if (before.get(p) !== sha) summary.changes.changed.push(p);
    }
    for (const p of before.keys()) if (!after.has(p)) summary.changes.removed.push(p);
  }
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

/** Output path relative to the app root (what the generated manifest records). */
function relOutput(project: Project, job: RenderJob): string {
  return path.relative(project.root, job.outputPath).split(path.sep).join("/");
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

/** Hash of the template sources: a template edit must invalidate every output. */
let templatesHashCache: string | undefined;
export function templatesSourceHash(): string {
  if (templatesHashCache) return templatesHashCache;
  const dir = path.resolve(import.meta.dirname, "..", "templates");
  const h = crypto.createHash("sha256");
  for (const name of fs.readdirSync(dir).sort()) {
    if (/\.tsx?$/.test(name)) h.update(name).update(fs.readFileSync(path.join(dir, name)));
  }
  templatesHashCache = h.digest("hex");
  return templatesHashCache;
}

/** Stable hash of everything that influences one output file (incremental rendering). */
export function inputsHash(
  project: Project,
  job: RenderJob,
  content: LocaleContent,
  toolVersion: string,
  fontHashes: string[],
  templatesHash: string,
): string {
  const fields = content.screens[job.screen.id] ?? {};
  const assets: Record<string, string> = {};
  const assetRefs: string[] = [];
  const bg = job.screen.overrides.backgroundImage;
  if (typeof bg === "string" && bg.startsWith("asset:")) assetRefs.push(bg.slice("asset:".length));
  for (const layer of job.screen.layers ?? []) if (layer.type === "image") assetRefs.push(layer.asset);
  for (const rel of assetRefs) {
    try {
      const abs = resolveWithin(project.paths.assets, rel);
      if (fs.existsSync(abs)) assets[rel] = sha256File(abs);
    } catch {
      // invalid asset paths are reported by validate; nothing to hash
    }
  }
  const h = crypto.createHash("sha256");
  h.update(
    JSON.stringify({
      toolVersion,
      templatesHash,
      target: job.target.id,
      locale: job.locale,
      direction: content.direction ?? null,
      screen: { id: job.screen.id, template: job.screen.template, overrides: job.screen.overrides },
      fields,
      brand: project.config.brand,
      output: project.config.output,
      source: sha256File(job.sourcePath),
      fonts: fontHashes,
      assets,
    }),
  );
  return h.digest("hex");
}
