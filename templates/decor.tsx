import type { CSSProperties, ReactElement } from "react";
import { z } from "zod";
import { withAlpha } from "./shared";

/**
 * Decorative vector shapes shared by the graphic templates (statement,
 * spotlight, diagonal-band, stat-hero). Everything here is a deterministic,
 * self-contained SVG: no assets, no randomness, no remote URLs, and it scales
 * with the canvas because the shapes live in a 0..100 viewBox.
 */
export const DECOR_KINDS = ["none", "arc", "blob", "burst", "rings", "wave", "confetti", "grid"] as const;
export type DecorKind = (typeof DECOR_KINDS)[number];

export const decorSchema = z.enum(DECOR_KINDS);

/** Lighten a #rrggbb colour towards white by a factor (0..1). Mirror of `darken`. */
export function lighten(hex: string, factor: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const ch = (shift: number) => {
    const v = (n >> shift) & 255;
    return Math.round(v + (255 - v) * factor);
  };
  return `#${[ch(16), ch(8), ch(0)].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

/** Body of the decor SVG for one kind, drawn in a 0..100 square viewBox. */
function decorBody(kind: Exclude<DecorKind, "none">, color: string): string {
  const stroke = (w: number) => `fill="none" stroke="${color}" stroke-width="${w}" stroke-linecap="round"`;
  switch (kind) {
    case "arc":
      // Concentric quarter-arcs sweeping out of one corner.
      return [4, 18, 32, 46, 60]
        .map((r, i) => `<path d="M ${100 - r} 100 A ${r} ${r} 0 0 1 100 ${100 - r}" ${stroke(2 + i * 0.15)}/>`)
        .join("");
    case "blob":
      return `<path d="M 50 4 C 74 4 96 20 96 44 C 96 68 80 96 52 96 C 26 96 4 78 4 52 C 4 24 26 4 50 4 Z" fill="${color}"/>`;
    case "burst":
      // Rays fanning from the top-start corner.
      return Array.from({ length: 9 }, (_, i) => {
        const a = (Math.PI / 2) * (i / 8);
        return `<path d="M 0 0 L ${Math.cos(a) * 150} ${Math.sin(a) * 150}" ${stroke(1.6)}/>`;
      }).join("");
    case "rings":
      return [14, 26, 38, 50].map((r) => `<circle cx="50" cy="50" r="${r}" ${stroke(r === 26 ? 2.4 : 1.4)}/>`).join("");
    case "wave":
      return [0, 14, 28]
        .map(
          (dy) =>
            `<path d="M -5 ${40 + dy} Q 20 ${20 + dy} 45 ${40 + dy} T 105 ${40 + dy}" ${stroke(dy === 14 ? 2.6 : 1.6)}/>`,
        )
        .join("");
    case "confetti":
      // Fixed scatter of dots and ticks — hand-placed so it never looks gridded.
      return [
        [12, 18, 2.6],
        [30, 8, 1.6],
        [52, 22, 3.4],
        [76, 12, 2],
        [90, 34, 2.6],
        [18, 46, 1.8],
        [40, 62, 2.8],
        [66, 52, 1.8],
        [86, 70, 3],
        [24, 82, 2.2],
        [54, 90, 1.6],
        [72, 88, 2.6],
      ]
        .map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${color}"/>`)
        .concat(
          [
            [8, 62, -20],
            [60, 30, 30],
            [92, 54, -35],
          ].map(([x, y, rot]) => `<path d="M ${x} ${y} l 7 0" ${stroke(2)} transform="rotate(${rot} ${x} ${y})"/>`),
        )
        .join("");
    case "grid":
    default:
      return Array.from({ length: 9 }, (_, i) => {
        const p = 6 + i * 11;
        return `<path d="M ${p} 0 V 100" ${stroke(0.7)}/><path d="M 0 ${p} H 100" ${stroke(0.7)}/>`;
      }).join("");
  }
}

/** Shapes that reach the edge of their box; a soft radial mask hides the seam. */
const FADED: DecorKind[] = ["burst", "grid", "wave", "confetti"];

export interface DecorProps {
  kind: DecorKind;
  color: string;
  opacity?: number;
  /** Box the shape is drawn into (px, absolute inside the artwork). */
  left: number;
  top: number;
  size: number;
  rotate?: number;
  style?: CSSProperties;
}

/** One decorative shape as an inline SVG data URI (never a remote URL). */
export function Decor({
  kind,
  color,
  opacity = 0.16,
  left,
  top,
  size,
  rotate,
  style,
}: DecorProps): ReactElement | null {
  if (kind === "none") return null;
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100' width='${size}' height='${size}'>${decorBody(kind, color)}</svg>`;
  // Rays and grids run into the edge of their box; fade them out so the shape
  // reads as light falling off, not as a cropped square.
  const mask = FADED.includes(kind)
    ? `radial-gradient(circle at ${kind === "burst" ? "0% 0%" : "50% 50%"}, #000 25%, transparent ${kind === "burst" ? "85%" : "70%"})`
    : undefined;
  return (
    <div
      aria-hidden
      data-decor={kind}
      style={{
        position: "absolute",
        left,
        top,
        width: size,
        height: size,
        opacity,
        transform: rotate ? `rotate(${rotate}deg)` : undefined,
        transformOrigin: "50% 50%",
        backgroundImage: `url("data:image/svg+xml;utf8,${svg.replace(/#/g, "%23").replace(/"/g, "'")}")`,
        backgroundSize: "100% 100%",
        maskImage: mask,
        WebkitMaskImage: mask,
        pointerEvents: "none",
        ...style,
      }}
    />
  );
}

/**
 * Soft radial glow behind a device. Two stops of the same colour so it reads as
 * light rather than a flat disc; `spread` is the glow diameter in px.
 */
export function Glow({
  color,
  cx,
  cy,
  spread,
  strength = 0.55,
}: {
  color: string;
  cx: number;
  cy: number;
  spread: number;
  strength?: number;
}): ReactElement {
  return (
    <div
      aria-hidden
      data-glow=""
      style={{
        position: "absolute",
        left: Math.round(cx - spread / 2),
        top: Math.round(cy - spread / 2),
        width: spread,
        height: spread,
        borderRadius: "50%",
        background: `radial-gradient(circle, ${withAlpha(color, strength)} 0%, ${withAlpha(color, strength * 0.45)} 38%, ${withAlpha(color, 0)} 70%)`,
        pointerEvents: "none",
      }}
    />
  );
}

/** Thin halo ring, used with `Glow` to give a centred device a target-like frame. */
export function Halo({
  color,
  cx,
  cy,
  diameter,
  width,
  opacity = 0.35,
}: {
  color: string;
  cx: number;
  cy: number;
  diameter: number;
  width: number;
  opacity?: number;
}): ReactElement {
  return (
    <div
      aria-hidden
      data-halo=""
      style={{
        position: "absolute",
        left: Math.round(cx - diameter / 2),
        top: Math.round(cy - diameter / 2),
        width: diameter,
        height: diameter,
        borderRadius: "50%",
        border: `${width}px solid ${color}`,
        opacity,
        pointerEvents: "none",
      }}
    />
  );
}
