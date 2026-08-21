import path from "node:path";
import { pathToFileURL } from "node:url";
import { renderStatic } from "./ssr";
import { getTemplateModule } from "../../templates";
import type { BrandTheme, ResolvedLayer, TemplateRenderInput } from "../../templates/types";
import type { Project } from "../config";
import { fontFaceCss, fontFamilyCss, resolveFontStack, type ResolvedFont } from "../fonts";
import { frameNameFromShell, getFrame, resolveShell } from "../frames";
import type { RenderJob } from "../render-plan";
import type { LocaleContent } from "../schema";

export interface ArtworkUrls {
  /** URL of the raw capture as the page will load it. */
  sourceImage: string;
  /** Maps an absolute font file path to a URL the page can load. */
  fontUrl: (absPath: string) => string;
  /** Maps a store/assets-relative path to a URL the page can load. */
  assetUrl: (relPath: string) => string;
  /** Maps a device-frame file (absolute path) to a URL the page can load; default file://. */
  frameUrl?: (absPath: string) => string;
}

export function brandThemeOf(project: Project, stack?: ResolvedFont[]): BrandTheme {
  const resolved = stack ?? resolveFontStack(project).stack;
  const b = project.config.brand;
  const headline = b.headlineFont?.family;
  const headlineFirst = headline
    ? [
        ...resolved.filter((f) => f.family.toLowerCase() === headline.toLowerCase()),
        ...resolved.filter((f) => f.family.toLowerCase() !== headline.toLowerCase()),
      ]
    : undefined;
  return {
    fontFamily: b.font.family,
    fontStack: fontFamilyCss(resolved),
    headlineFontStack: headlineFirst ? fontFamilyCss(headlineFirst) : undefined,
    primary: b.primary,
    onPrimary: b.onPrimary,
    backgroundDefaults: b.background,
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
  assetUrl: (relPath: string) => string = (rel) => pathToFileURL(path.join(project.paths.assets, rel)).href,
): TemplateRenderInput {
  const mod = getTemplateModule(job.screen.template);
  if (!mod) throw new Error(`Unknown template "${job.screen.template}"`);
  const overrides = mod.overridesSchema.parse(job.screen.overrides) as Record<string, unknown>;
  // Templates always see one concrete shell value for the target being rendered.
  overrides.shell = resolveShell(overrides.shell, job.target.family) ?? "";
  if (overrides.shell === "") delete overrides.shell;
  const fields = content.screens[job.screen.id] ?? {};
  const layers: ResolvedLayer[] = (job.screen.layers ?? []).map((layer) =>
    layer.type === "image"
      ? { ...layer, url: assetUrl(layer.asset) }
      : { ...layer, text: (fields[layer.id] ?? "") as string },
  );
  return {
    target: job.target,
    canvasWidth: job.canvasWidth,
    locale: job.locale,
    direction: content.direction ?? "ltr",
    fields,
    sourceImageUrl,
    brand: brandThemeOf(project, stack),
    overrides,
    mode,
    assetUrl,
    layers,
    strip: job.strip,
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
  const input = templateInputFor(project, job, content, urls.sourceImage, "export", stack, urls.assetUrl);
  const frameName = frameNameFromShell(resolveShell(job.screen.overrides.shell, job.target.family));
  if (frameName) {
    const frame = getFrame(frameName);
    if (!frame) {
      throw new Error(
        `Device frame "${frameName}" is not available locally. Run: store-shots frames setup, then check the name with: store-shots frames list`,
      );
    }
    const toUrl = urls.frameUrl ?? ((p: string) => pathToFileURL(p).href);
    input.frame = {
      url: toUrl(frame.file),
      frameWidth: frame.frameWidth,
      frameHeight: frame.frameHeight,
      screenX: frame.screenX,
      screenY: frame.screenY,
      screenWidth: frame.screenWidth,
      screenRadius: frame.screenRadius,
    };
  }
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
    `<body style="width:${job.canvasWidth}px;height:${job.target.height}px;overflow:hidden;">`,
    body,
    "</body></html>",
  ].join("\n");
  return { html, fonts: stack };
}
