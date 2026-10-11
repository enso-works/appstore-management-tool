import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { appFacts, NATIVE_SKIP, nativeDir, readExpoSafely, str } from "./app-facts";
import { FALLBACK_ACCENT, hexToOklch, hexToRgb, isHexColor, rgbToHex, rgbToOklch, type Rgb } from "./color";
import { fileExists } from "./paths";

/**
 * The colour an app is drawn in, for themes: what the app says its colour is,
 * else the most vivid colour in its icon, else a neutral blue. Returned with
 * where it came from, so a wrong guess is easy to spot and change.
 */
export interface AccentGuess {
  hex: string;
  source: string;
}

export async function accentOf(root: string): Promise<AccentGuess> {
  const stated = statedAccent(root);
  if (stated) return stated;
  const icon = appFacts(root).icon?.value.abs;
  if (icon && fileExists(icon)) {
    const hex = await iconAccent(icon).catch(() => undefined);
    if (hex) return { hex, source: "app icon" };
  }
  return { hex: FALLBACK_ACCENT, source: "default" };
}

/** A colour the app states: Expo's primaryColor, splash or adaptive icon background, the asset catalog's AccentColor. */
export function statedAccent(root: string): AccentGuess | undefined {
  const expo = readExpoSafely(root);
  const android = expo?.android as { adaptiveIcon?: { backgroundColor?: unknown } } | undefined;
  const candidates: [unknown, string][] = [
    [expo?.primaryColor, "app.json primaryColor"],
    [(expo?.splash as { backgroundColor?: unknown } | undefined)?.backgroundColor, "app.json splash.backgroundColor"],
    [android?.adaptiveIcon?.backgroundColor, "app.json android.adaptiveIcon.backgroundColor"],
  ];
  for (const [value, source] of candidates) {
    const hex = str(value);
    if (hex && isHexColor(hex) && colourful(hex)) return { hex: normalise(hex), source };
  }
  const catalog = catalogAccent(root);
  if (catalog && colourful(catalog)) return { hex: catalog, source: "asset catalog AccentColor" };
  return undefined;
}

/**
 * The icon's most vivid colour: pixels grouped by hue, each group weighed by how
 * many pixels it has and how colourful they are (vivid counts more than many);
 * near-white, near-black and grey
 * pixels do not count. Undefined for an icon with no colour in it.
 */
export async function iconAccent(file: string): Promise<string | undefined> {
  const { data, info } = await sharp(file)
    .resize(48, 48, { fit: "cover" })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const bins = Array.from({ length: 24 }, () => ({ weight: 0, r: 0, g: 0, b: 0, n: 0 }));
  for (let i = 0; i < data.length; i += info.channels) {
    const rgb: Rgb = [data[i], data[i + 1], data[i + 2]];
    const { l, c, h } = rgbToOklch(rgb);
    if (l > 0.93 || l < 0.15 || c < 0.05) continue;
    const bin = bins[Math.floor(h / 15) % 24];
    // Squared, so a small vivid detail (a lime corner on a dark icon) outweighs a large dull area.
    bin.weight += c * c;
    bin.r += rgb[0];
    bin.g += rgb[1];
    bin.b += rgb[2];
    bin.n += 1;
  }
  // Neighbouring hues count together, so a gradient icon is one colour, not two half-colours.
  const scored = bins.map((b, i) => ({
    b,
    score: b.weight + 0.5 * (bins[(i + 23) % 24].weight + bins[(i + 1) % 24].weight),
  }));
  const best = scored.sort((x, y) => y.score - x.score)[0];
  const pixels = info.width * info.height;
  if (!best || best.b.n < pixels * 0.005) return undefined;
  return rgbToHex([best.b.r / best.b.n, best.b.g / best.b.n, best.b.b / best.b.n]);
}

/** `AccentColor.colorset` in the app's asset catalog, as hex. */
function catalogAccent(root: string): string | undefined {
  const ios = nativeDir(root);
  if (!ios) return undefined;
  const found: string[] = [];
  const walk = (dir: string, depth: number) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!e.isDirectory() || NATIVE_SKIP.has(e.name) || e.name.startsWith(".")) continue;
      const full = path.join(dir, e.name);
      if (e.name === "AccentColor.colorset") found.push(full);
      else if (depth < 5) walk(full, depth + 1);
    }
  };
  walk(ios, 1);
  for (const set of found) {
    try {
      const json = JSON.parse(fs.readFileSync(path.join(set, "Contents.json"), "utf8")) as {
        colors?: { appearances?: unknown; color?: { components?: Record<string, string> } }[];
      };
      const comp = json.colors?.find((c) => !c.appearances)?.color?.components;
      if (!comp) continue;
      const channel = (v: string | undefined) => {
        if (!v) return NaN;
        return v.startsWith("0x") ? parseInt(v, 16) : Number(v) <= 1 ? Number(v) * 255 : Number(v);
      };
      const rgb = [channel(comp.red), channel(comp.green), channel(comp.blue)] as Rgb;
      if (rgb.every((v) => Number.isFinite(v))) return rgbToHex(rgb);
    } catch {
      // an unreadable colour set is no colour
    }
  }
  return undefined;
}

/** White, black and greys say nothing about an app's colour. */
function colourful(hex: string): boolean {
  const { l, c } = hexToOklch(hex);
  return c >= 0.04 && l > 0.15 && l < 0.95;
}

function normalise(hex: string): string {
  return rgbToHex(hexToRgb(hex));
}
