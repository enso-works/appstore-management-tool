import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import sharp from "sharp";
import { themeChanges } from "./apply-theme";
import { loadProject, readJsonFile, type Project } from "./config";
import { loadContent } from "./content";
import { fileExists } from "./paths";
import { renderArtworkHtml } from "./render/html";
import type { ExportRenderer } from "./render/export";
import { missingCapture } from "./render/preview";
import { buildRenderPlan } from "./render-plan";
import { manifestSchema, projectConfigSchema } from "./schema";
import { getTarget, isOptInTarget, isScreenshotSet, type Orientation } from "./targets";
import { STARTER_SCREEN_IDS } from "./themes";

/**
 * A theme's preview: the first screens of a page rendered in the theme, side by
 * side, small. Drawn from an app's own captures and copy when there is an app
 * (Design > Theme...), else from the demo app in fixtures/ (Import App, before
 * the app has anything). Nothing is written to the app.
 */
export interface ThemePreviewOptions {
  theme: string;
  accent: string;
  /** The app to draw from; the demo app when absent. */
  project?: Project;
  /** For the demo app: which way round its screens are. */
  orientation?: Orientation;
  /** Screens side by side. */
  screens?: number;
  /** Height of each screen in the preview, in pixels. */
  height?: number;
}

const SAMPLE_COPY: Record<string, Record<string, string | null>> = {
  hero: { eyebrow: "YOUR APP", headline: "The one line that sells it", caption: "A short line on why it matters." },
  "feature-1": { eyebrow: null, headline: "Show the best screen next", caption: "What it does, in a few words." },
  "feature-2": { eyebrow: "EVERY DAY", headline: "One idea per screen", caption: "Short copy reads at a glance." },
  "feature-3": { eyebrow: null, headline: "Then the details", caption: null },
  "feature-4": { eyebrow: null, headline: "And how it ends", caption: null },
};

// Located the way lib/fonts.ts finds the bundled fonts: import.meta.dirname is not set in the engine's bundle.
const demoConfig = () =>
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "demo-app", "store-shots.config.json");

export async function themePreview(renderer: ExportRenderer, opts: ThemePreviewOptions): Promise<Buffer> {
  const base = opts.project ?? loadProject(demoConfig());
  const rawConfig = readJsonFile(base.configPath) as Record<string, unknown>;
  if (!opts.project && opts.orientation === "landscape") rawConfig.targets = ["iphone-6.9-2868x1320"];
  // Without an app, what a new one starts with: the starter screens, sample copy, no captures yet.
  const rawManifest = opts.project
    ? (readJsonFile(base.paths.manifest) as Record<string, unknown>)
    : {
        screens: STARTER_SCREEN_IDS.map((id, i) => ({
          id,
          order: i + 1,
          template: "hero-top",
          source: { filePattern: `starter-${id}.png` },
        })),
      };
  const changes = themeChanges(rawConfig, rawManifest, opts.theme, opts.accent);
  const project: Project = { ...base, config: projectConfigSchema.parse(changes.config) };
  const manifest = manifestSchema.parse(changes.manifest);

  // The app's lead device: its iPhone set (else its first screenshot set), never a header or event picture.
  const targets = project.config.targets.filter((t) => isScreenshotSet(t) && !isOptInTarget(t));
  const target = targets.find((t) => getTarget(t)?.family === "iphone") ?? targets[0];
  if (!target) throw new Error("The app has no screenshot set to preview");
  const locale = project.config.defaultLocale;
  const content = opts.project
    ? (loadContent(project).byLocale.get(locale) ?? { locale, direction: "ltr" as const, screens: {} })
    : { locale, direction: "ltr" as const, screens: SAMPLE_COPY };
  const jobs = buildRenderPlan(project, manifest, { locales: [locale], targets: [target] }).slice(0, opts.screens ?? 3);
  if (!jobs.length) throw new Error("The app has no screens to preview");

  const height = opts.height ?? 520;
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "store-shots-theme-"));
  try {
    const tiles: Buffer[] = [];
    for (const job of jobs) {
      const { html } = renderArtworkHtml(project, job, content, {
        // Until a capture is in, the same sketch of an app screen the editor shows.
        sourceImage: fileExists(job.sourcePath)
          ? pathToFileURL(job.sourcePath).href
          : missingCapture(project, job.target),
        fontUrl: (p) => pathToFileURL(p).href,
        assetUrl: (rel) => pathToFileURL(path.join(project.paths.assets, rel)).href,
      });
      const result = await renderer.render(job.key, html, job.target, {
        backgroundColor: project.config.output.backgroundColor,
        workDir,
        canvasWidth: job.canvasWidth,
      });
      tiles.push(await sharp(result.png).resize({ height }).png().toBuffer());
    }
    const gap = Math.round(height * 0.03);
    const widths = await Promise.all(tiles.map(async (t) => (await sharp(t).metadata()).width ?? 0));
    const width = widths.reduce((a, w) => a + w, 0) + gap * (tiles.length - 1);
    let left = 0;
    const composite = tiles.map((input, i) => {
      const placed = { input, left, top: 0 };
      left += widths[i] + gap;
      return placed;
    });
    return await sharp({ create: { width, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .composite(composite)
      .png()
      .toBuffer();
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
}
