/**
 * In-page checks (plan §13.2). Runs inside the artwork page (export worker or
 * preview iframe) after the fitter. Plain JavaScript string for the same reason
 * as fit.ts: it must survive being evaluated in the page untouched.
 */
export interface OverflowFinding {
  id: string;
  scrollWidth: number;
  clientWidth: number;
  scrollHeight: number;
  clientHeight: number;
}

export interface InPageResult {
  artworkFound: boolean;
  artworkSize: { width: number; height: number } | null;
  fontsStatus: string;
  fontsFailed: string[];
  missingImages: string[];
  overflow: OverflowFinding[];
  /** Text blocks that extend below the top edge of the device shell. */
  textOverlapsDevice: string[];
}

/** Pixel tolerance: sub-pixel rounding must not count as overflow. */
export const OVERFLOW_TOLERANCE_PX = 1;

export const IN_PAGE_CHECKS_SOURCE = `(function (tolerance) {
  var doc = document;
  var artwork = doc.querySelector("[data-artwork]");
  var result = {
    artworkFound: !!artwork,
    artworkSize: artwork ? { width: artwork.offsetWidth, height: artwork.offsetHeight } : null,
    fontsStatus: doc.fonts ? doc.fonts.status : "unknown",
    fontsFailed: [],
    missingImages: [],
    overflow: [],
    textOverlapsDevice: []
  };
  if (doc.fonts && doc.fonts.forEach) {
    doc.fonts.forEach(function (face) {
      if (face.status === "error") result.fontsFailed.push(face.family + " " + face.weight + " " + face.style);
    });
  }
  var imgs = doc.querySelectorAll("img");
  for (var i = 0; i < imgs.length; i++) {
    if (!imgs[i].complete || imgs[i].naturalWidth === 0) result.missingImages.push(imgs[i].getAttribute("src") || "(no src)");
  }
  var device = doc.querySelector("[data-device]");
  var dr = device ? device.getBoundingClientRect() : null;
  function intersects(a, b) {
    return a.left < b.right - tolerance && a.right > b.left + tolerance && a.top < b.bottom - tolerance && a.bottom > b.top + tolerance;
  }
  var nodes = doc.querySelectorAll("[data-check]");
  for (var n = 0; n < nodes.length; n++) {
    var e = nodes[n];
    var id = e.getAttribute("data-check") || "?";
    // Line-based vertical check: glyph ascenders/descenders legitimately poke a
    // few px past tight line boxes, so compare against the declared line budget
    // (maxLines x lineHeight) with half a line of slack; a real overflow adds a
    // whole extra line. Elements without the attributes fall back to a pixel check.
    var lh = Number(e.getAttribute("data-line-height") || 0);
    var maxLines = Number(e.getAttribute("data-max-lines") || 0);
    var vLimit = lh && maxLines ? lh * maxLines + lh * 0.5 : e.clientHeight + tolerance;
    if (e.scrollWidth > e.clientWidth + tolerance || e.scrollHeight > vLimit) {
      result.overflow.push({ id: id, scrollWidth: e.scrollWidth, clientWidth: e.clientWidth, scrollHeight: e.scrollHeight, clientHeight: e.clientHeight });
    }
    if (dr && intersects(e.getBoundingClientRect(), dr)) result.textOverlapsDevice.push(id);
  }
  return result;
})(${OVERFLOW_TOLERANCE_PX})`;
