/**
 * Colour maths for themes: one accent colour in, every tone a theme needs out.
 * Tones are made in OKLCH, where lightness is perceptual, so "a dark base in the
 * accent's hue" looks equally dark for a yellow and a blue. Pure functions, no
 * dependencies, safe for client and server.
 */

export interface Oklch {
  /** Lightness, 0 to 1. */
  l: number;
  /** Chroma, 0 to about 0.37. */
  c: number;
  /** Hue in degrees. */
  h: number;
}

export type Rgb = [number, number, number];

const HEX = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;

export function isHexColor(value: string): boolean {
  return HEX.test(value.trim());
}

/** "#3fa69f" or "#3FA" to 0..255 channels. */
export function hexToRgb(hex: string): Rgb {
  const m = HEX.exec(hex.trim());
  if (!m) throw new Error(`Not a hex colour: ${hex}`);
  const v = m[1].length === 3 ? [...m[1]].map((c) => c + c).join("") : m[1];
  return [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16)) as Rgb;
}

export function rgbToHex([r, g, b]: Rgb): string {
  return `#${[r, g, b]
    .map((v) =>
      Math.round(clamp(v, 0, 255))
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`.toUpperCase();
}

/** `rgba(r,g,b,a)` for gradients that fade a tone out. */
export function rgba(hex: string, alpha: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},${round(alpha, 3)})`;
}

const toLinear = (v: number) => {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
const fromLinear = (c: number) => 255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

export function rgbToOklch(rgb: Rgb): Oklch {
  const [r, g, b] = rgb.map(toLinear);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  const c = Math.hypot(A, B);
  const h = c < 1e-4 ? 0 : (Math.atan2(B, A) * 180) / Math.PI;
  return { l: L, c, h: (h + 360) % 360 };
}

/** Linear sRGB for a colour; channels outside 0..1 mean it is out of gamut. */
function oklchToLinear({ l, c, h }: Oklch): Rgb {
  const a = c * Math.cos((h * Math.PI) / 180);
  const b = c * Math.sin((h * Math.PI) / 180);
  const L = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const M = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const S = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * L - 3.3077115913 * M + 0.2309699292 * S,
    -1.2684380046 * L + 2.6097574011 * M - 0.3413193965 * S,
    -0.0041960863 * L - 0.7034186147 * M + 1.707614701 * S,
  ];
}

const inGamut = (rgb: Rgb) => rgb.every((v) => v >= -1e-4 && v <= 1 + 1e-4);

/** The colour, with chroma reduced until it fits sRGB (hue and lightness kept). */
export function oklchToHex(color: Oklch): string {
  const l = clamp(color.l, 0, 1);
  let lo = 0;
  let hi = Math.max(0, color.c);
  if (!inGamut(oklchToLinear({ l, c: hi, h: color.h }))) {
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      if (inGamut(oklchToLinear({ l, c: mid, h: color.h }))) lo = mid;
      else hi = mid;
    }
    hi = lo;
  }
  return rgbToHex(oklchToLinear({ l, c: hi, h: color.h }).map((v) => fromLinear(clamp(v, 0, 1))) as Rgb);
}

export function hexToOklch(hex: string): Oklch {
  return rgbToOklch(hexToRgb(hex));
}

/** WCAG relative luminance. */
export function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map(toLinear);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio, 1 to 21. */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Every tone a theme draws with, all in the accent's hue. */
export interface Palette {
  /** The accent, brought to a lightness and chroma that read as a brand colour. */
  accent: string;
  /** White or ink, whichever reads better on the accent. */
  onAccent: string;
  /** The accent made light, for eyebrows and captions on dark grounds. */
  accentLight: string;
  /** The accent made dark, for eyebrows and captions on light grounds. */
  accentDark: string;
  /** A second glow colour, the accent's hue turned by 50 degrees. */
  glow: string;
  /** Near-black with a trace of the hue: dark backgrounds. */
  night: string;
  /** A deep shade of the accent: rich dark backgrounds. */
  deep: string;
  /** A deeper shade still, for gradients that end darker than `deep`. */
  deeper: string;
  /** Near-white with a trace of the hue: light backgrounds. */
  tint: string;
  /** Warm off-white, the same for every accent: paper. */
  paper: string;
  /** Near-black text for light backgrounds. */
  ink: string;
}

export const FALLBACK_ACCENT = "#2F6FEB";

/** Accents the theme pickers offer beside the app's own colours: one click instead of a colour wheel. */
export const SUGGESTED_ACCENTS = [
  "#2F6FEB",
  "#6D4DF2",
  "#D9408C",
  "#E5484D",
  "#F07A2A",
  "#E2A512",
  "#2E9E5B",
  "#12999C",
] as const;

export function paletteFrom(accentHex: string): Palette {
  const base = hexToOklch(isHexColor(accentHex) ? accentHex : FALLBACK_ACCENT);
  // A grey accent keeps its greyness; anything with colour gets enough chroma to read as a brand colour.
  const grey = base.c < 0.03;
  const h = base.h;
  const c = grey ? base.c : clamp(base.c, 0.1, 0.22);
  const accent = oklchToHex({ l: clamp(base.l, 0.5, 0.72), c, h });
  const ink = oklchToHex({ l: 0.22, c: Math.min(c, 0.025), h });
  const onAccent = contrast("#FFFFFF", accent) >= 3 ? "#FFFFFF" : ink;
  return {
    accent,
    onAccent,
    accentLight: oklchToHex({ l: 0.86, c: Math.min(c, 0.12), h }),
    accentDark: oklchToHex({ l: 0.45, c: Math.min(c, 0.16), h }),
    glow: oklchToHex({ l: 0.62, c, h: (h + 50) % 360 }),
    night: oklchToHex({ l: 0.17, c: Math.min(c * 0.3, 0.035), h }),
    deep: oklchToHex({ l: 0.34, c: Math.min(c * 0.75, 0.13), h }),
    deeper: oklchToHex({ l: 0.22, c: Math.min(c * 0.6, 0.09), h }),
    tint: oklchToHex({ l: 0.965, c: Math.min(c * 0.15, 0.022), h }),
    paper: "#F5F1E8",
    ink,
  };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

function round(v: number, digits: number): number {
  const k = 10 ** digits;
  return Math.round(v * k) / k;
}
