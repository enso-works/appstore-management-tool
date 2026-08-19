/**
 * In-page checks (plan §13.2). Runs inside the artwork page (export worker or
 * preview iframe). Kept dependency-free and serialisable so Playwright can
 * `page.evaluate` it and the UI can run it directly.
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

/** Pixel tolerance for overflow: sub-pixel rounding must not count as overflow. */
export const OVERFLOW_TOLERANCE_PX = 1;

export function runInPageChecks(tolerance: number = 1): InPageResult {
  const doc = document;
  const artwork = doc.querySelector("[data-artwork]") as HTMLElement | null;
  const result: InPageResult = {
    artworkFound: !!artwork,
    artworkSize: artwork ? { width: artwork.offsetWidth, height: artwork.offsetHeight } : null,
    fontsStatus: doc.fonts ? doc.fonts.status : "unknown",
    fontsFailed: [],
    missingImages: [],
    overflow: [],
    textOverlapsDevice: [],
  };
  if (doc.fonts) {
    doc.fonts.forEach((face) => {
      if (face.status === "error") result.fontsFailed.push(`${face.family} ${face.weight} ${face.style}`);
    });
  }
  doc.querySelectorAll("img").forEach((img) => {
    if (!img.complete || img.naturalWidth === 0) result.missingImages.push(img.getAttribute("src") ?? "(no src)");
  });
  const device = doc.querySelector("[data-device]") as HTMLElement | null;
  const deviceTop = device ? device.getBoundingClientRect().top : Infinity;
  doc.querySelectorAll("[data-check]").forEach((el) => {
    const e = el as HTMLElement;
    const id = e.getAttribute("data-check") ?? "?";
    // Line-based vertical check: glyph ascenders/descenders legitimately poke a
    // few px past tight line boxes, so compare against the declared line budget
    // (maxLines x lineHeight) with half a line of slack; a real overflow adds a
    // whole extra line. Elements without the attributes fall back to a pixel check.
    const lh = Number(e.getAttribute("data-line-height") || 0);
    const maxLines = Number(e.getAttribute("data-max-lines") || 0);
    const vLimit = lh && maxLines ? lh * maxLines + lh * 0.5 : e.clientHeight + tolerance;
    if (e.scrollWidth > e.clientWidth + tolerance || e.scrollHeight > vLimit) {
      result.overflow.push({
        id,
        scrollWidth: e.scrollWidth,
        clientWidth: e.clientWidth,
        scrollHeight: e.scrollHeight,
        clientHeight: e.clientHeight,
      });
    }
    if (e.getBoundingClientRect().bottom > deviceTop + tolerance) result.textOverlapsDevice.push(id);
  });
  return result;
}

/** Source of the checker as a string for page.evaluate / preview iframes. */
export const IN_PAGE_CHECKS_SOURCE = `(${runInPageChecks.toString()})(${OVERFLOW_TOLERANCE_PX})`;
