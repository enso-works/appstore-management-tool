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
  /** Include the drag-to-position script (editor Single mode). */
  interactive?: boolean;
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
    assetUrl: urls.assetUrl,
  });
  const script = `<script>
(function () {
  function report() {
    var fits = ${FIT_SOURCE};
    var checks = ${IN_PAGE_CHECKS_SOURCE};
    parent.postMessage({ type: "store-shots-preview", key: ${JSON.stringify(job.key)}, fits: fits, checks: checks }, "*");
  }
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(function () {
      var imgs = Array.prototype.slice.call(document.images);
      Promise.all(imgs.map(function (i) { return i.decode ? i.decode().catch(function () {}) : null; })).then(report, report);
    });
  } else { report(); }
})();
</script>`;
  const dragScript = req.interactive ? DRAG_SCRIPT.replace("__KEY__", JSON.stringify(job.key)) : "";
  return {
    html: html.replace("</body></html>", `${script}\n${dragScript}\n</body></html>`),
    job: { key: job.key, sourceExists, sourceRelPath: job.sourcePath.slice(project.paths.raw.length + 1) },
  };
}

/** 1x1 transparent PNG; the checker reports a missing image as naturalWidth 0 only when the load fails, so mark it via data-missing instead. */
const MISSING_SOURCE_DATA_URI =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="1300" viewBox="0 0 600 1300"><rect width="600" height="1300" fill="#222"/><text x="300" y="640" fill="#bbb" font-family="system-ui" font-size="40" text-anchor="middle">raw capture missing</text></svg>`,
  );

/**
 * Editor-only: drag the device to move it (plain), tilt it (alt) or scale it
 * (shift). Feedback is applied live via transform; on release the deltas are
 * posted to the parent, which turns them into override values and re-renders.
 * Dragging anywhere else posts pan events so the canvas still pans.
 */
const DRAG_SCRIPT = `<script>
(function () {
  var key = __KEY__;
  var device = document.querySelector("[data-device]");
  var active = null;
  function post(msg) { parent.postMessage(msg, "*"); }
  document.addEventListener("pointerdown", function (e) {
    if (e.button !== 0) return;
    var onDevice = device && device.contains(e.target);
    active = { x: e.clientX, y: e.clientY, onDevice: onDevice, alt: e.altKey, shift: e.shiftKey, moved: false };
    if (onDevice) {
      active.base = device.style.transform || "";
      document.body.style.cursor = e.altKey ? "grab" : e.shiftKey ? "nwse-resize" : "move";
    }
    post({ type: "store-shots-pan", key: key, phase: "start", onDevice: onDevice });
    e.preventDefault();
  });
  document.addEventListener("pointermove", function (e) {
    if (!active) return;
    var dx = e.clientX - active.x, dy = e.clientY - active.y;
    if (Math.abs(dx) + Math.abs(dy) > 2) active.moved = true;
    if (active.onDevice) {
      var t = active.base;
      if (active.alt) t = t + " rotate(" + (dx / 8) + "deg)";
      else if (active.shift) t = t + " scale(" + Math.max(0.2, 1 + dx / 600) + ")";
      else t = "translate(" + dx + "px," + dy + "px) " + t;
      device.style.transform = t;
    } else {
      post({ type: "store-shots-pan", key: key, phase: "move", dx: dx, dy: dy });
    }
  });
  function end(e) {
    if (!active) return;
    var dx = e.clientX - active.x, dy = e.clientY - active.y;
    var a = active; active = null;
    document.body.style.cursor = "";
    if (a.onDevice && a.moved) {
      post({ type: "store-shots-drag-end", key: key, dx: dx, dy: dy, mode: a.alt ? "tilt" : a.shift ? "scale" : "move", dTilt: dx / 8, dScale: Math.max(0.2, 1 + dx / 600) });
    } else {
      post({ type: "store-shots-pan", key: key, phase: "end", dx: dx, dy: dy, click: !a.moved });
    }
  }
  document.addEventListener("pointerup", end);
  document.addEventListener("pointercancel", end);
  if (device) device.style.cursor = "move";
})();
</script>`;
