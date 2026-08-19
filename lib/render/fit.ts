/**
 * In-page text fitting (plan §12.2). For every text block that declares a
 * fit range, shrink the font size in small steps until the text fits its line
 * budget or the template's minimum scale is reached. Runs inside the artwork
 * page before the checks, in export (page.evaluate) and preview (iframe).
 *
 * Kept as a plain JavaScript string: TS/esbuild transforms inject helpers
 * (e.g. __name) into Function.prototype.toString output, which breaks when
 * evaluated in the page.
 */
export interface FitResult {
  id: string;
  fromPx: number;
  toPx: number;
  scale: number;
  fits: boolean;
}

export const FIT_SOURCE = `(function () {
  var results = [];
  var nodes = document.querySelectorAll("[data-check][data-fit-min]");
  for (var n = 0; n < nodes.length; n++) {
    var el = nodes[n];
    var id = el.getAttribute("data-check") || "?";
    var basePx = Number(el.getAttribute("data-font-size") || 0);
    var ratio = Number(el.getAttribute("data-line-ratio") || 1.2);
    var maxLines = Number(el.getAttribute("data-max-lines") || 1);
    var minScale = Number(el.getAttribute("data-fit-min") || 1);
    if (!basePx || minScale >= 1) continue;
    var apply = function (px) {
      var lh = Math.round(px * ratio);
      el.style.fontSize = px + "px";
      el.style.lineHeight = lh + "px";
      el.style.maxHeight = lh * maxLines + "px";
      el.setAttribute("data-line-height", String(lh));
    };
    var fits = function () {
      var lh = Number(el.getAttribute("data-line-height") || 0);
      return el.scrollHeight <= lh * maxLines + lh * 0.5 && el.scrollWidth <= el.clientWidth + 1;
    };
    var px = basePx;
    var ok = fits();
    var minPx = Math.ceil(basePx * minScale);
    while (!ok && px > minPx) {
      px = Math.max(minPx, Math.floor(px * 0.96));
      apply(px);
      ok = fits();
    }
    if (px !== basePx) el.setAttribute("data-fitted-scale", (px / basePx).toFixed(3));
    results.push({ id: id, fromPx: basePx, toPx: px, scale: px / basePx, fits: ok });
  }
  return results;
})()`;
