import { getTemplateModule } from "../../templates";
import type { Project } from "../config";
import { directionForLocale } from "../locales";
import { fileExists } from "../paths";
import { buildJob } from "../render-plan";
import { formatZodError, screenSchema, type LocaleContent, type ScreenDefinition } from "../schema";
import { IN_PAGE_CHECKS_SOURCE } from "./checks";
import { FIT_SOURCE } from "./fit";
import { renderArtworkHtml, type ArtworkUrls } from "./html";

export interface PreviewRequest {
  targetId: string;
  locale: string;
  /** Draft screen definition (template, overrides, source) — may differ from the saved manifest. */
  screen: unknown;
  /** Draft copy for this screen. */
  fields: Record<string, string | null | undefined>;
  direction?: "ltr" | "rtl";
}

export interface PreviewResult {
  html: string;
  job: { key: string; sourceExists: boolean; sourceRelPath: string };
}

/**
 * The same HTML the export worker renders, plus a small script that runs the
 * fitter and the checks and posts the results to the parent window. Assets are
 * served through /api/... URLs instead of file://.
 */
export function previewHtml(
  project: Project,
  req: PreviewRequest,
  urls: Omit<ArtworkUrls, "sourceImage"> & { sourceImage: (absPath: string) => string },
): PreviewResult {
  const parsedScreen = screenSchema.safeParse(req.screen);
  if (!parsedScreen.success) throw new Error(`Invalid screen: ${formatZodError(parsedScreen.error).join("; ")}`);
  const screen: ScreenDefinition = parsedScreen.data;
  if (!getTemplateModule(screen.template)) throw new Error(`Unknown template "${screen.template}"`);
  const job = buildJob(project, screen, req.targetId, req.locale);
  if (!job) throw new Error(`Target "${req.targetId}" is not available for this screen`);
  const fields: Record<string, string | null> = {};
  for (const [k, v] of Object.entries(req.fields ?? {})) if (v !== undefined) fields[k] = v;
  const content: LocaleContent = {
    locale: req.locale,
    direction: req.direction ?? directionForLocale(req.locale),
    screens: { [screen.id]: fields },
  };
  const sourceExists = !job.sourceError && fileExists(job.sourcePath);
  const { html } = renderArtworkHtml(project, job, content, {
    sourceImage: sourceExists ? urls.sourceImage(job.sourcePath) : MISSING_SOURCE_DATA_URI,
    fontUrl: urls.fontUrl,
  });
  const script = `<script>
(function () {
  function report() {
    var fits = ${FIT_SOURCE};
    var checks = ${IN_PAGE_CHECKS_SOURCE};
    parent.postMessage({ type: "store-shots-preview", fits: fits, checks: checks }, "*");
  }
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(function () {
      var imgs = Array.prototype.slice.call(document.images);
      Promise.all(imgs.map(function (i) { return i.decode ? i.decode().catch(function () {}) : null; })).then(report, report);
    });
  } else { report(); }
})();
</script>`;
  return {
    html: html.replace("</body></html>", `${script}\n</body></html>`),
    job: { key: job.key, sourceExists, sourceRelPath: job.sourcePath.slice(project.paths.raw.length + 1) },
  };
}

/** 1x1 transparent PNG; the checker reports a missing image as naturalWidth 0 only when the load fails, so mark it via data-missing instead. */
const MISSING_SOURCE_DATA_URI =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="1300" viewBox="0 0 600 1300"><rect width="600" height="1300" fill="#222"/><text x="300" y="640" fill="#bbb" font-family="system-ui" font-size="40" text-anchor="middle">raw capture missing</text></svg>`,
  );
