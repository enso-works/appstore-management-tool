import { renderStatic } from "./ssr";
import { getTemplateModule } from "../../templates";
import type { BrandTheme, TemplateRenderInput } from "../../templates/types";
import type { Project } from "../config";
import { fontFaceCss, fontFamilyCss, resolveFontStack, type ResolvedFont } from "../fonts";
import type { RenderJob } from "../render-plan";
import type { LocaleContent } from "../schema";

export interface ArtworkUrls {
  /** URL of the raw capture as the page will load it. */
  sourceImage: string;
  /** Maps an absolute font file path to a URL the page can load. */
  fontUrl: (absPath: string) => string;
}

export function brandThemeOf(project: Project, stack?: ResolvedFont[]): BrandTheme {
  const resolved = stack ?? resolveFontStack(project).stack;
  return {
    fontFamily: project.config.brand.font.family,
    fontStack: fontFamilyCss(resolved),
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
  stack?: ResolvedFont[],
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
    brand: brandThemeOf(project, stack),
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
  /** Brand font first, then fallbacks. */
  fonts: ResolvedFont[];
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
  const { stack } = resolveFontStack(project);
  if (!stack.some((f) => f.family.toLowerCase() === project.config.brand.font.family.toLowerCase())) {
    throw new Error(
      `Font "${project.config.brand.font.family}" is not available locally. Run: store-shots fonts add "${project.config.brand.font.family}" --project ${project.root}`,
    );
  }
  const input = templateInputFor(project, job, content, urls.sourceImage, "export", stack);
  const mod = getTemplateModule(job.screen.template)!;
  const body = renderStatic(mod.render(input));
  const html = [
    "<!doctype html>",
    `<html lang="${job.locale}" dir="${input.direction}">`,
    "<head>",
    '<meta charset="utf-8">',
    `<title>${job.key}</title>`,
    `<style>${baseCss()}\n${stack.map((f) => fontFaceCss(f, urls.fontUrl)).join("\n")}</style>`,
    "</head>",
    `<body style="width:${job.target.width}px;height:${job.target.height}px;overflow:hidden;">`,
    body,
    "</body></html>",
  ].join("\n");
  return { html, fonts: stack };
}
