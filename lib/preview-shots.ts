import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import sharp from "sharp";
import type { Project } from "./config";
import { withSetCopy } from "./content";
import { checkRender } from "./generate";
import { IssueList, type Issue } from "./issues";
import { fileExists } from "./paths";
import { ExportRenderer } from "./render/export";
import { renderArtworkHtml } from "./render/html";
import { missingCapture } from "./render/preview";
import { buildRenderPlan, buildSetPlan, padOrder, type PlanFilter } from "./render-plan";
import { getTarget, isOptInTarget, isScreenshotSet } from "./targets";
import { validateProject } from "./validate";

/**
 * `store-shots preview`: chosen screens rendered to PNG files to look at, the
 * way a coding agent (or anyone without the Mac app) checks a design. Unlike
 * generate it needs no captures (a missing one is drawn as the capture
 * sketch), writes nothing the store gets, and a panorama stays one wide image.
 * The render checks are generate's: text that overflows or covers the phone is
 * reported per file.
 */
export interface PreviewOptions extends PlanFilter {
  /** Where the PNGs go; default store/generated/preview/, emptied first. */
  outDir?: string;
  /** Scale every file to this height in pixels; default full size. */
  height?: number;
  renderer?: ExportRenderer;
}

export interface PreviewShot {
  key: string;
  screen: string;
  target: string;
  locale: string;
  set?: string;
  /** Absolute path of the PNG. */
  file: string;
  /** The capture was missing and the sketch stands in for it. */
  placeholder: boolean;
  issues: Issue[];
}

export interface PreviewResult {
  /** Absolute. */
  outDir: string;
  shots: PreviewShot[];
  /** Problems in the app's files (copy, manifest, fonts), missing captures left out. */
  issues: Issue[];
}

/** By default: the app's lead screenshot set (its iPhone set, else its first) in its default language. */
export function defaultPreviewFilter(project: Project, filter: PlanFilter): PlanFilter {
  const sets = project.config.targets.filter((t) => isScreenshotSet(t) && !isOptInTarget(t));
  const lead = sets.find((t) => getTarget(t)?.family === "iphone") ?? sets[0];
  return {
    ...filter,
    targets: filter.targets ?? (lead ? [lead] : undefined),
    locales: filter.locales ?? [project.config.defaultLocale],
  };
}

export async function previewShots(project: Project, opts: PreviewOptions = {}): Promise<PreviewResult> {
  const validation = validateProject(project);
  if (!validation.manifest) throw new Error("The app has no readable store/manifest.json");
  const filter = defaultPreviewFilter(project, opts);
  const jobs = [
    ...buildRenderPlan(project, validation.manifest, filter),
    ...(filter.sets ? buildSetPlan(project, validation.manifest, filter) : []),
  ];
  const isDefaultDir = !opts.outDir;
  const outDir = path.resolve(opts.outDir ?? path.join(project.paths.generated, "preview"));
  if (isDefaultDir) fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });

  const renderer = opts.renderer ?? new ExportRenderer();
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "store-shots-preview-"));
  const shots: PreviewShot[] = [];
  try {
    for (const job of jobs) {
      const placeholder = !fileExists(job.sourcePath);
      const content = withSetCopy(validation.content.get(job.locale)!, job.set);
      const { html } = renderArtworkHtml(project, job, content, {
        sourceImage: placeholder ? missingCapture(project, job.target) : pathToFileURL(job.sourcePath).href,
        fontUrl: (p) => pathToFileURL(p).href,
        assetUrl: (rel) => pathToFileURL(path.join(project.paths.assets, rel)).href,
      });
      const result = await renderer.render(job.key, html, job.target, {
        backgroundColor: project.config.output.backgroundColor,
        workDir,
        canvasWidth: job.canvasWidth,
      });
      const jobIssues = new IssueList();
      checkRender(project, job, result, jobIssues);
      const file = path.join(
        outDir,
        ...(job.set ? ["sets", job.set] : []),
        job.target.id,
        job.locale,
        `${padOrder(job.screen.order)}-${job.screen.id}.png`,
      );
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const png = opts.height ? await sharp(result.png).resize({ height: opts.height }).png().toBuffer() : result.png;
      fs.writeFileSync(file, png);
      shots.push({
        key: job.key,
        screen: job.screen.id,
        target: job.target.id,
        locale: job.locale,
        ...(job.set ? { set: job.set } : {}),
        file,
        placeholder,
        // Size and alpha are generate's checks on the files the store gets.
        issues: jobIssues.items.filter((i) => i.code !== "render.size" && i.code !== "render.alpha"),
      });
    }
  } finally {
    if (!opts.renderer) await renderer.close();
    fs.rmSync(workDir, { recursive: true, force: true });
  }
  return {
    outDir,
    shots,
    issues: validation.issues.items.filter((i) => i.code !== "source.missing"),
  };
}
