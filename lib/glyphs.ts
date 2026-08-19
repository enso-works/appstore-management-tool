import fs from "node:fs";
import path from "node:path";
import * as opentype from "opentype.js";
import type { ResolvedFont } from "./fonts";

/**
 * Glyph coverage (plan §12.3): every character of every rendered string must
 * exist in at least one font of the stack. Checked at validate time from the
 * font files themselves, so it is deterministic and needs no browser.
 */

const cache = new Map<string, opentype.Font>();

function loadFont(file: string): opentype.Font {
  const cached = cache.get(file);
  if (cached) return cached;
  const buf = fs.readFileSync(file);
  const font = opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  cache.set(file, font);
  return font;
}

/** Characters every font is allowed to lack: whitespace, controls, joiners, variation selectors. */
function ignorable(ch: string): boolean {
  const cp = ch.codePointAt(0) ?? 0;
  if (/\s/.test(ch)) return true;
  if (cp < 0x20 || (cp >= 0x7f && cp < 0xa0)) return true;
  if (cp === 0x200b || cp === 0x200c || cp === 0x200d || cp === 0x2060 || cp === 0xfeff) return true; // ZW space/joiners, BOM
  if (cp >= 0x200e && cp <= 0x200f) return true; // LRM/RLM
  if (cp >= 0x202a && cp <= 0x202e) return true; // bidi embeddings
  if (cp >= 0x2066 && cp <= 0x2069) return true; // bidi isolates
  if (cp >= 0xfe00 && cp <= 0xfe0f) return true; // variation selectors
  if (cp >= 0xe0100 && cp <= 0xe01ef) return true;
  return false;
}

export class GlyphChecker {
  private readonly fonts: opentype.Font[];

  constructor(stack: ResolvedFont[]) {
    this.fonts = [];
    for (const f of stack) {
      // One file per family is enough for coverage; weights share a cmap.
      const first = f.files[0];
      if (first) this.fonts.push(loadFont(path.join(f.dir, first.path)));
    }
  }

  get fontCount(): number {
    return this.fonts.length;
  }

  covers(ch: string): boolean {
    if (ignorable(ch)) return true;
    for (const font of this.fonts) {
      if (font.charToGlyphIndex(ch) !== 0) return true;
    }
    return false;
  }

  /** Distinct characters in `text` that no font in the stack can render. */
  missing(text: string): string[] {
    const out = new Set<string>();
    for (const ch of Array.from(text)) if (!this.covers(ch)) out.add(ch);
    return [...out];
  }
}

/** Human hint for a missing character: which Google Fonts family would likely cover it. */
export function suggestFamilyFor(ch: string): string {
  const cp = ch.codePointAt(0) ?? 0;
  if (cp >= 0x0600 && cp <= 0x06ff) return "Noto Sans Arabic";
  if (cp >= 0x0590 && cp <= 0x05ff) return "Noto Sans Hebrew";
  if (cp >= 0x0400 && cp <= 0x04ff) return "Noto Sans";
  if (cp >= 0x0370 && cp <= 0x03ff) return "Noto Sans";
  if (cp >= 0x0900 && cp <= 0x097f) return "Noto Sans Devanagari";
  if (cp >= 0x0e00 && cp <= 0x0e7f) return "Noto Sans Thai";
  if (cp >= 0x3040 && cp <= 0x30ff) return "Noto Sans JP";
  if (cp >= 0xac00 && cp <= 0xd7af) return "Noto Sans KR";
  if (cp >= 0x4e00 && cp <= 0x9fff) return "Noto Sans SC (or JP/TC for that market)";
  if (cp >= 0x1f300 && cp <= 0x1faff) return "an emoji font (avoid emoji in store copy)";
  return "a font that covers this script";
}
