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
  job: { key: string; sourceExists: boolean; sourceRelPath: string; budgets: Record<string, number> };
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
    frameUrl: urls.frameUrl,
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
  const mod = getTemplateModule(screen.template);
  const budgets: Record<string, number> = {};
  if (mod?.descriptor.fieldBudget) {
    for (const f of [...mod.descriptor.requiredFields, ...mod.descriptor.optionalFields]) {
      const b = mod.descriptor.fieldBudget(f, job.target, screen.overrides);
      if (b) budgets[f] = b;
    }
  }
  return {
    html: html.replace("</body></html>", `${script}\n${dragScript}\n</body></html>`),
    job: { key: job.key, sourceExists, sourceRelPath: job.sourcePath.slice(project.paths.raw.length + 1), budgets },
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
  function stackOf(el) { return el && el.closest ? el.closest("[data-text-stack]") : null; }
  function layerOf(el) { return el && el.closest ? el.closest("[data-layer]") : null; }
  document.addEventListener("pointerdown", function (e) {
    if (e.button !== 0) return;
    var layerEl = layerOf(e.target);
    var onDevice = !layerEl && device && device.contains(e.target);
    var stack = onDevice || layerEl ? null : stackOf(e.target);
    active = { x: e.clientX, y: e.clientY, onDevice: onDevice, stack: stack, layer: layerEl, alt: e.altKey, shift: e.shiftKey, moved: false };
    if (layerEl) {
      active.base = layerEl.style.transform || "";
      document.body.style.cursor = "move";
    } else if (onDevice) {
      active.base = device.style.transform || "";
      document.body.style.cursor = e.altKey ? "grab" : e.shiftKey ? "nwse-resize" : "move";
    } else if (stack) {
      active.base = stack.style.transform || "";
      document.body.style.cursor = "move";
    }
    post({ type: "store-shots-pan", key: key, phase: "start", onDevice: onDevice || !!stack });
    e.preventDefault();
  });
  document.addEventListener("pointermove", function (e) {
    if (!active) return;
    var dx = e.clientX - active.x, dy = e.clientY - active.y;
    if (Math.abs(dx) + Math.abs(dy) > 2) active.moved = true;
    if (active.layer) {
      active.layer.style.transform = "translate(" + dx + "px," + dy + "px) " + active.base;
    } else if (active.onDevice) {
      var t = active.base;
      if (active.alt) t = t + " rotate(" + (dx / 8) + "deg)";
      else if (active.shift) t = t + " scale(" + Math.max(0.2, 1 + dx / 600) + ")";
      else t = "translate(" + dx + "px," + dy + "px) " + t;
      device.style.transform = t;
    } else if (active.stack) {
      active.stack.style.transform = "translate(" + dx + "px," + dy + "px) " + active.base;
    } else {
      post({ type: "store-shots-pan", key: key, phase: "move", dx: dx, dy: dy });
    }
  });
  function hitOf(a) {
    if (a.layer) return "layer:" + a.layer.getAttribute("data-layer");
    if (a.onDevice) return "phone";
    if (a.stack) return "text:" + (a.stack.getAttribute("data-text-stack") || "0");
    return "background";
  }
  var handles = [];
  function clearHandles() { handles.forEach(function (h) { h.remove(); }); handles = []; }
  function makeHandle(x, y, size, round, cursor, label) {
    var h = document.createElement("div");
    h.style.cssText = "position:absolute;z-index:99;box-sizing:border-box;display:flex;align-items:center;justify-content:center;" +
      "background:#2563eb;color:#fff;border:" + Math.max(2, Math.round(size * 0.08)) + "px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,0.4);" +
      "user-select:none;touch-action:none;font-family:system-ui,sans-serif;";
    h.style.left = Math.round(x - size / 2) + "px";
    h.style.top = Math.round(y - size / 2) + "px";
    h.style.width = size + "px";
    h.style.height = size + "px";
    h.style.borderRadius = round ? "50%" : Math.round(size * 0.25) + "px";
    h.style.cursor = cursor;
    h.style.fontSize = Math.round(size * 0.6) + "px";
    h.textContent = label;
    document.body.appendChild(h);
    handles.push(h);
    return h;
  }
  function handleDrag(h, onMove, onEnd) {
    h.addEventListener("pointerdown", function (e) {
      e.stopPropagation();
      e.preventDefault();
      var move = function (ev) { onMove(ev); };
      var up = function (ev) {
        document.removeEventListener("pointermove", move);
        document.removeEventListener("pointerup", up);
        onEnd(ev);
      };
      document.addEventListener("pointermove", move);
      document.addEventListener("pointerup", up);
      onMove(e);
    });
  }
  function updateHandles(hit) {
    clearHandles();
    if (hit !== "phone" || !device) return;
    var r = device.getBoundingClientRect();
    var size = Math.max(28, Math.round(r.width * 0.09));
    var base = device.style.transform || "";
    var cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    // Rotate: circular handle on the right side, drag around the centre.
    var rot = makeHandle(r.right + size * 1.1, cy, size, true, "grab", "\u21bb");
    var a0 = null, deg = 0;
    handleDrag(rot, function (ev) {
      var a = Math.atan2(ev.clientY - cy, ev.clientX - cx);
      if (a0 === null) a0 = a;
      deg = ((a - a0) * 180) / Math.PI;
      device.style.transform = base + " rotate(" + deg + "deg)";
    }, function () {
      if (Math.abs(deg) > 0.2) post({ type: "store-shots-drag-end", key: key, mode: "tilt", dTilt: deg });
      a0 = null;
    });
    // Scale: square handle on the bottom-right corner, drag away from the centre.
    var sc = makeHandle(r.right, r.bottom, size, false, "nwse-resize", "\u2922");
    var d0 = null, factor = 1;
    handleDrag(sc, function (ev) {
      var d = Math.hypot(ev.clientX - cx, ev.clientY - cy);
      if (d0 === null) d0 = d;
      factor = Math.max(0.2, d / d0);
      device.style.transform = base + " scale(" + factor + ")";
    }, function () {
      if (Math.abs(factor - 1) > 0.005) post({ type: "store-shots-drag-end", key: key, mode: "scale", dScale: factor });
      d0 = null;
    });
  }
  function highlight(hit) {
    document.querySelectorAll("[data-device],[data-text-stack],[data-layer]").forEach(function (el) { el.style.outline = ""; el.style.outlineOffset = ""; });
    var el = null;
    if (hit === "phone") el = device;
    else if (hit && hit.indexOf("text:") === 0) el = document.querySelector('[data-text-stack="' + hit.slice(5) + '"]');
    else if (hit && hit.indexOf("layer:") === 0) el = document.querySelector('[data-layer="' + hit.slice(6) + '"]');
    if (el) { el.style.outline = Math.max(2, Math.round(window.innerWidth * 0.004)) + "px dashed rgba(37,99,235,0.9)"; el.style.outlineOffset = "6px"; }
    updateHandles(hit);
  }
  window.addEventListener("message", function (e) {
    if (e.data && e.data.type === "store-shots-select") highlight(e.data.hit);
  });
  function end(e) {
    if (!active) return;
    var dx = e.clientX - active.x, dy = e.clientY - active.y;
    var a = active; active = null;
    document.body.style.cursor = "";
    if (a.layer && a.moved) {
      post({ type: "store-shots-drag-end", key: key, dx: dx, dy: dy, mode: "layer", layerId: a.layer.getAttribute("data-layer") });
    } else if (a.onDevice && a.moved) {
      post({ type: "store-shots-drag-end", key: key, dx: dx, dy: dy, mode: a.alt ? "tilt" : a.shift ? "scale" : "move", dTilt: dx / 8, dScale: Math.max(0.2, 1 + dx / 600) });
    } else if (a.stack && a.moved) {
      post({ type: "store-shots-drag-end", key: key, dx: dx, dy: dy, mode: "text" });
    } else {
      if (!a.moved) { var h = hitOf(a); highlight(h); post({ type: "store-shots-click", key: key, hit: h }); }
      post({ type: "store-shots-pan", key: key, phase: "end", dx: dx, dy: dy, click: !a.moved });
    }
  }
  document.addEventListener("pointerup", end);
  document.addEventListener("pointercancel", end);
  if (device) device.style.cursor = "move";
  document.querySelectorAll("[data-text-stack],[data-layer]").forEach(function (el) { el.style.cursor = "move"; });
})();
</script>`;
