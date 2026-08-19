import path from "node:path";
import { sourceDeviceFor, type Project } from "./config";
import type { Manifest, ScreenDefinition } from "./schema";
import { getTarget, type TargetProfile } from "./targets";
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
  /** Absolute path of the output PNG. */
  outputPath: string;
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

/** 01_home_IPHONE_69.png — numeric prefix keeps order; token avoids collisions. */
export function outputFileName(screen: ScreenDefinition, target: TargetProfile, format: "png" | "jpg"): string {
  return `${padOrder(screen.order)}_${screen.id.replaceAll("-", "_")}_${target.fileToken}.${format}`;
}

export interface PlanFilter {
  locales?: string[];
  screens?: string[];
  targets?: string[];
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
    const target = getTarget(targetId);
    if (!target) continue;
    const device = sourceDeviceFor(project, targetId);
    for (const locale of project.config.locales) {
      if (filter.locales && !filter.locales.includes(locale)) continue;
      for (const screen of screens) {
        if (screen.targets && !screen.targets.includes(targetId)) continue;
        const sourceLocale = screen.source.localized ? locale : project.config.defaultLocale;
        const file = interpolatePattern(screen.source.filePattern, {
          order: screen.order,
          id: screen.id,
          locale: sourceLocale,
          device,
          target: targetId,
        });
        const job: RenderJob = {
          key: `${targetId}/${locale}/${screen.id}`,
          target,
          locale,
          screen,
          sourceLocale,
          sourceDevice: device,
          sourcePath: path.join(project.paths.raw, device, sourceLocale, file),
          outputPath: path.join(
            project.paths.outputScreenshots,
            locale,
            outputFileName(screen, target, project.config.output.format),
          ),
        };
        try {
          job.sourcePath = resolveWithin(project.paths.raw, path.join(device, sourceLocale, file));
        } catch (err) {
          if (!(err instanceof PathEscapeError)) throw err;
          job.sourceError = `source path "${path.join(device, sourceLocale, file)}" escapes ${project.config.paths.raw}`;
        }
        jobs.push(job);
      }
    }
  }
  return jobs;
}

export function describeJob(project: Project, job: RenderJob): string {
  return `${job.key}: ${displayRelative(project.root, job.sourcePath)} -> ${displayRelative(project.root, job.outputPath)}`;
}
