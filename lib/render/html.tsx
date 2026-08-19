import { renderToStaticMarkup } from "react-dom/server";
import { getTemplateModule } from "../../templates";
import type { BrandTheme, TemplateRenderInput } from "../../templates/types";
import type { Project } from "../config";
import { fontFaceCss, resolveFont, type ResolvedFont } from "../fonts";
import type { RenderJob } from "../render-plan";
import type { LocaleContent } from "../schema";

export interface ArtworkUrls {
  /** URL of the raw capture as the page will load it. */
  sourceImage: string;
  /** Maps an absolute font file path to a URL the page can load. */
  fontUrl: (absPath: string) => string;
}

export function brandThemeOf(project: Project): BrandTheme {
  return {
    fontFamily: project.config.brand.font.family,
    primary: project.config.brand.primary,
    onPrimary: project.config.brand.onPrimary,
  };
}

/** Build the template input for a job. Throws if the template or overrides are invalid (validate catches those first). */
export function templateInputFor(
  project: Project,
  job: RenderJob,
  content: LocaleContent,
  sourceImageUrl: string,
  mode: "preview" | "export",
): TemplateRenderInput {
  const mod = getTemplateModule(job.screen.template);
  if (!mod) throw new Error(`Unknown template "${job.screen.template}"`);
  const overrides = mod.overridesSchema.parse(job.screen.overrides) as Record<string, unknown>;
  return {
    target: job.target,
    locale: job.locale,
    direction: content.direction ?? "ltr",
    fields: content.screens[job.screen.id] ?? {},
    sourceImageUrl,
    brand: brandThemeOf(project),
    overrides,
    mode,
  };
}

/** Base CSS shared by export and preview: reset, no motion, exact sizing. */
export function baseCss(): string {
  return [
    "*,*::before,*::after{box-sizing:border-box;margin:0;padding:0;animation:none!important;transition:none!important;}",
    "html,body{background:transparent;}",
    "img{display:block;}",
    "[data-artwork]{-webkit-font-smoothing:antialiased;text-rendering:geometricPrecision;}",
  ].join("\n");
}

export interface RenderedArtwork {
  html: string;
  font: ResolvedFont;
}

/**
 * Self-contained HTML document for one job: fonts via @font-face (local files),
 * the template markup, and nothing else — no editor UI, no scripts. The export
 * worker loads it from a file:// URL so file:// images and fonts resolve.
 */
export function renderArtworkHtml(
  project: Project,
  job: RenderJob,
  content: LocaleContent,
  urls: ArtworkUrls,
): RenderedArtwork {
  const font = resolveFont(project, project.config.brand.font.family);
  if (!font) {
    throw new Error(
      `Font "${project.config.brand.font.family}" is not available locally. Run: store-shots fonts add "${project.config.brand.font.family}" --project ${project.root}`,
    );
  }
  const input = templateInputFor(project, job, content, urls.sourceImage, "export");
  const mod = getTemplateModule(job.screen.template)!;
  const body = renderToStaticMarkup(mod.render(input));
  const html = [
    "<!doctype html>",
    `<html lang="${job.locale}" dir="${input.direction}">`,
    "<head>",
    '<meta charset="utf-8">',
    `<title>${job.key}</title>`,
    `<style>${baseCss()}\n${fontFaceCss(font, urls.fontUrl)}</style>`,
    "</head>",
    `<body style="width:${job.target.width}px;height:${job.target.height}px;overflow:hidden;">`,
    body,
    "</body></html>",
  ].join("\n");
  return { html, font };
}
