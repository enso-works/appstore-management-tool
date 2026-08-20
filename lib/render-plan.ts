import path from "node:path";
import { sourceDeviceFor, type Project } from "./config";
import type { Manifest, ScreenDefinition } from "./schema";
import { getTarget, outputDirFor, type TargetProfile } from "./targets";
import { displayRelative, PathEscapeError, resolveWithin } from "./paths";

export interface RenderJob {
  /** <target>/<locale>/<screen> */
  key: string;
  target: TargetProfile;
  locale: string;
  screen: ScreenDefinition;
  /** Locale whose raw capture is used (differs from `locale` when source.localized is false). */
  sourceLocale: string;
  sourceDevice: string;
  /** Absolute path of the raw capture (inside paths.raw). */
  sourcePath: string;
  /** Set when the interpolated source path escaped paths.raw; the job cannot render. */
  sourceError?: string;
  /** Absolute path of the output PNG (first slice for panoramas). */
  outputPath: string;
  /** Number of output files (1, or panorama.slices). */
  slices: number;
  /** Absolute output path per slice (length === slices). */
  outputPaths: string[];
  /** Artwork width in px (slices x target.width). */
  canvasWidth: number;
  /** This screen's window into the full strip (for backgrounds that span all screens). */
  strip?: { offsetX: number; width: number };
}

export function padOrder(order: number): string {
  return String(order).padStart(2, "0");
}

export function interpolatePattern(
  pattern: string,
  vars: { order: number; id: string; locale: string; device: string; target: string },
): string {
  return pattern
    .replaceAll("{order}", padOrder(vars.order))
    .replaceAll("{id}", vars.id)
    .replaceAll("{locale}", vars.locale)
    .replaceAll("{device}", vars.device)
    .replaceAll("{target}", vars.target);
}

/** 01_home_IPHONE_69.png — numeric prefix keeps order; token avoids collisions. Panorama slices use order+slice. */
export function outputFileName(
  screen: ScreenDefinition,
  target: TargetProfile,
  format: "png" | "jpg",
  slice = 0,
): string {
  return `${padOrder(screen.order + slice)}_${screen.id.replaceAll("-", "_")}_${target.fileToken}.${format}`;
}

/** Orders a screen occupies: its own plus reserved ones for panorama slices. */
export function ordersOf(screen: ScreenDefinition): number[] {
  const n = screen.panorama?.slices ?? 1;
  return Array.from({ length: n }, (_, i) => screen.order + i);
}

export interface PlanFilter {
  locales?: string[];
  screens?: string[];
  targets?: string[];
}

/** One job for a screen x target x locale; `undefined` when the target is unknown or excluded by the screen. */
export function buildJob(
  project: Project,
  screen: ScreenDefinition,
  targetId: string,
  locale: string,
): RenderJob | undefined {
  const target = getTarget(targetId);
  if (!target) return undefined;
  if (screen.targets && !screen.targets.includes(targetId)) return undefined;
  const device = sourceDeviceFor(project, targetId);
  const sourceLocale = screen.source.localized ? locale : project.config.defaultLocale;
  const file = interpolatePattern(screen.source.filePattern, {
    order: screen.order,
    id: screen.id,
    locale: sourceLocale,
    device,
    target: targetId,
  });
  const slices = target.family === "feature-graphic" ? 1 : (screen.panorama?.slices ?? 1);
  const dir = outputDirFor(target, locale, project.paths);
  const outputPaths =
    target.family === "feature-graphic"
      ? [path.join(dir, "featureGraphic.png")] // supply expects exactly this name
      : Array.from({ length: slices }, (_, i) =>
          path.join(dir, outputFileName(screen, target, project.config.output.format, i)),
        );
  const job: RenderJob = {
    key: `${targetId}/${locale}/${screen.id}`,
    target,
    locale,
    screen,
    sourceLocale,
    sourceDevice: device,
    sourcePath: path.join(project.paths.raw, device, sourceLocale, file),
    outputPath: outputPaths[0],
    slices,
    outputPaths,
    canvasWidth: target.width * slices,
  };
  try {
    job.sourcePath = resolveWithin(project.paths.raw, path.join(device, sourceLocale, file));
  } catch (err) {
    if (!(err instanceof PathEscapeError)) throw err;
    job.sourceError = `source path "${path.join(device, sourceLocale, file)}" escapes ${project.config.paths.raw}`;
  }
  return job;
}

/** A screen's horizontal window into the strip of all enabled screens (offset and total width in px). */
export function stripWindowFor(
  screens: ScreenDefinition[],
  screenId: string,
  targetWidth: number,
): { offsetX: number; width: number } {
  const ordered = [...screens].filter((s) => s.enabled).sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  let acc = 0;
  let offsetX = 0;
  for (const s of ordered) {
    if (s.id === screenId) offsetX = acc;
    acc += targetWidth * (s.panorama?.slices ?? 1);
  }
  return { offsetX, width: acc };
}

/** Deterministic job list: targets in config order, locales in config order, screens by order. */
export function buildRenderPlan(project: Project, manifest: Manifest, filter: PlanFilter = {}): RenderJob[] {
  const jobs: RenderJob[] = [];
  const screens = [...manifest.screens]
    .filter((s) => s.enabled)
    .filter((s) => !filter.screens || filter.screens.includes(s.id))
    .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));

  for (const targetId of project.config.targets) {
    if (filter.targets && !filter.targets.includes(targetId)) continue;
    for (const locale of project.config.locales) {
      if (filter.locales && !filter.locales.includes(locale)) continue;
      for (const screen of screens) {
        const job = buildJob(project, screen, targetId, locale);
        if (job) {
          job.strip = stripWindowFor(screens, screen.id, job.target.width);
          jobs.push(job);
        }
      }
    }
  }
  return jobs;
}

export function describeJob(project: Project, job: RenderJob): string {
  return `${job.key}: ${displayRelative(project.root, job.sourcePath)} -> ${displayRelative(project.root, job.outputPath)}`;
}
