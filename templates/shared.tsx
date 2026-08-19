import type { CSSProperties, ReactElement } from "react";
import { z } from "zod";
import { ARTWORK_ATTR, type TemplateRenderInput } from "./types";

/**
 * Overrides every template accepts. Semantic controls plus enough positional
 * freedom to recreate hand-made store art: the device can be scaled, nudged in
 * X/Y (fractions of the canvas width, so values carry across iPhone/iPad) and
 * tilted; the text block can be narrowed and anchored to either side.
 */
export const commonOverridesSchema = z.strictObject({
  /** CSS background colour/gradient; default derives from brand.primary. */
  background: z.string().min(1).optional(),
  /**
   * Background image layered over `background`: "asset:<path under store/assets>"
   * (e.g. "asset:backgrounds/waves.png", cover-fitted) or a built-in pattern:
   * "pattern:waves" | "pattern:dots" | "pattern:grid".
   */
  backgroundImage: z
    .string()
    .regex(/^(asset:[^\s]+|pattern:(waves|dots|grid))$/, 'use "asset:<path>" or "pattern:waves|dots|grid"')
    .optional(),
  /** Line colour for built-in patterns (any CSS colour). */
  patternColor: z.string().min(1).optional(),
  /** Device width as a fraction of the canvas width. */
  screenshotScale: z.number().min(0.3).max(1.8).optional(),
  /** Horizontal nudge of the device, fraction of canvas width (negative = towards the start side). */
  screenshotOffsetX: z.number().min(-1).max(1).optional(),
  /** Vertical nudge of the device, fraction of canvas width (positive = down). */
  screenshotOffsetY: z.number().min(-1.2).max(1.2).optional(),
  /** Rotation in degrees. */
  deviceTilt: z.number().min(-30).max(30).optional(),
  /** Text column width as a fraction of the usable width (1 = full width). */
  textWidth: z.number().min(0.25).max(1).optional(),
  /** Which side the text column hugs when narrower than full width (logical: start = left in LTR). */
  textSide: z.enum(["start", "end"]).optional(),
  /** Vertical nudge of the text block, fraction of canvas width (positive = down). */
  textOffsetY: z.number().min(-0.3).max(1).optional(),
  textAlign: z.enum(["start", "center", "end"]).optional(),
  /** Text colour override (any CSS colour); default brand.onPrimary. */
  textColor: z.string().min(1).optional(),
  /** Neutral shell around the capture. */
  shell: z.enum(["dark", "light", "none"]).optional(),
});

export type CommonOverrides = z.infer<typeof commonOverridesSchema>;

export const COMMON_OVERRIDE_KEYS = Object.keys(commonOverridesSchema.shape);

/** Darken a #rrggbb colour by a factor (0..1). */
export function darken(hex: string, factor: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const r = Math.round(((n >> 16) & 255) * (1 - factor));
  const g = Math.round(((n >> 8) & 255) * (1 - factor));
  const b = Math.round((n & 255) * (1 - factor));
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

export function defaultBackground(primary: string): string {
  return `linear-gradient(165deg, ${primary} 0%, ${darken(primary, 0.45)} 100%)`;
}

/** Built-in repeating patterns as SVG data URIs; `size` is the tile width in px. */
export function patternDataUri(kind: "waves" | "dots" | "grid", color: string, size: number): string {
  const c = encodeURIComponent(color);
  const sw = Math.max(1, Math.round(size * 0.02));
  let svg: string;
  if (kind === "waves") {
    const h = Math.round(size * 0.5);
    svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${size}' height='${h}' viewBox='0 0 ${size} ${h}'><path d='M0 ${h / 2} Q ${size / 4} 0 ${size / 2} ${h / 2} T ${size} ${h / 2}' fill='none' stroke='${c}' stroke-width='${sw}'/></svg>`;
  } else if (kind === "dots") {
    svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${size}' height='${size}'><circle cx='${size / 2}' cy='${size / 2}' r='${Math.max(1, size * 0.06)}' fill='${c}'/></svg>`;
  } else {
    svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${size}' height='${size}'><path d='M ${size} 0 L 0 0 0 ${size}' fill='none' stroke='${c}' stroke-width='${sw}'/></svg>`;
  }
  return `url("data:image/svg+xml;utf8,${svg.replace(/#/g, "%23")}")`;
}

/** Resolve the background layers for an artwork from overrides + brand. */
export function backgroundCss(input: TemplateRenderInput<CommonOverrides>): string {
  const { overrides, brand, target } = input;
  const base = overrides.background ?? defaultBackground(brand.primary);
  const img = overrides.backgroundImage;
  if (!img) return base;
  if (img.startsWith("asset:")) {
    return `url("${input.assetUrl(img.slice("asset:".length))}") center / cover no-repeat, ${base}`;
  }
  const kind = img.slice("pattern:".length) as "waves" | "dots" | "grid";
  const color = overrides.patternColor ?? "rgba(0,0,0,0.08)";
  const tile = Math.round(target.width * (kind === "waves" ? 0.12 : 0.05));
  return `${patternDataUri(kind, color, tile)} 0 0 / ${tile}px auto repeat, ${base}`;
}

/** Root artwork element: exact canvas size, clips everything, sets font and direction. */
export function Artwork({
  input,
  children,
  style,
}: {
  input: TemplateRenderInput<CommonOverrides>;
  children: React.ReactNode;
  style?: CSSProperties;
}): ReactElement {
  const { target, brand, direction } = input;
  return (
    <div
      {...{ [ARTWORK_ATTR]: "" }}
      dir={direction}
      style={{
        position: "relative",
        width: target.width,
        height: target.height,
        overflow: "hidden",
        background: backgroundCss(input),
        color: input.overrides.textColor ?? brand.onPrimary,
        fontFamily: brand.fontStack,
        direction,
        boxSizing: "border-box",
        ...style,
      }}
    >
      {children}
    </div>
  );
}

export interface DeviceShellProps {
  input: TemplateRenderInput<CommonOverrides>;
  /** Device width in px. */
  width: number;
  /** Device height in px (usually width / target aspect). */
  height: number;
  /** Absolute position inside the artwork (before tilt). */
  left: number;
  top: number;
}

/**
 * Neutral device shell (plan §10.3): rounded rectangle with a thin bezel, the
 * capture inside with object-fit cover anchored to the top. Tilt rotates
 * around the shell centre.
 */
export function DeviceShell({ input, width, height, left, top }: DeviceShellProps): ReactElement {
  const shell = input.overrides.shell ?? "dark";
  const radius = Math.round(width * 0.11);
  const bezel = shell === "none" ? 0 : Math.round(width * 0.018);
  const shellColor = shell === "light" ? "#f3f4f6" : "#0b0c0f";
  const tilt = input.overrides.deviceTilt ?? 0;
  return (
    <div
      data-device=""
      style={{
        position: "absolute",
        left,
        top,
        width,
        height,
        borderRadius: radius,
        background: shellColor,
        padding: bezel,
        boxSizing: "border-box",
        boxShadow:
          shell === "none" ? "none" : `0 ${Math.round(width * 0.04)}px ${Math.round(width * 0.1)}px rgba(0,0,0,0.35)`,
        transform: tilt ? `rotate(${tilt}deg)` : undefined,
        transformOrigin: "50% 50%",
      }}
    >
      <div
        style={{
          width: "100%",
          height: "100%",
          borderRadius: Math.max(0, radius - bezel),
          overflow: "hidden",
          background: "#000",
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={input.sourceImageUrl}
          alt=""
          data-source=""
          style={{ display: "block", width: "100%", height: "100%", objectFit: "cover", objectPosition: "top center" }}
        />
      </div>
    </div>
  );
}

/**
 * Text container that the in-page checker validates: fixed max height, no
 * visible overflow. `maxLines` x line-height defines the box.
 */
export function TextBlock({
  id,
  text,
  fontSize,
  lineHeight,
  maxLines,
  weight,
  style,
  align,
  fitMinScale = 1,
  fontFamily,
}: {
  id: string;
  text: string | null | undefined;
  fontSize: number;
  lineHeight: number;
  maxLines: number;
  weight: number;
  style?: CSSProperties;
  align: "start" | "center" | "end";
  /**
   * Lowest font-size scale the in-page fitter may shrink to (plan §12.2:
   * "only within a template-defined range"). 1 = no shrinking allowed.
   */
  fitMinScale?: number;
  /** Font stack for this block (headline font); inherits the artwork stack when omitted. */
  fontFamily?: string;
}): ReactElement | null {
  if (!text) return null;
  const lh = Math.round(fontSize * lineHeight);
  return (
    <div
      {...{
        "data-check": id,
        "data-line-height": lh,
        "data-max-lines": maxLines,
        "data-font-size": fontSize,
        "data-line-ratio": lineHeight,
        "data-fit-min": fitMinScale,
      }}
      style={{
        fontSize,
        lineHeight: `${lh}px`,
        fontWeight: weight,
        maxHeight: lh * maxLines,
        overflow: "hidden",
        textAlign: align,
        overflowWrap: "break-word",
        fontFamily,
        ...style,
      }}
    >
      {text}
    </div>
  );
}

export function textAlignOf(
  input: TemplateRenderInput<CommonOverrides>,
  fallback: "start" | "center" | "end" = "center",
) {
  return input.overrides.textAlign ?? fallback;
}

/**
 * Shared layout maths for "text block + device" templates. Returns absolute
 * boxes (px) for the text column and the device, honouring every positional
 * override. Templates pass their defaults; overrides win.
 */
export interface StackLayoutDefaults {
  textWidth: number;
  textSide: "start" | "end";
  scale: number;
  /** Gap below the text block before the device in the stacked layout (fraction of W). */
  gap: number;
  /** In the side layout: device left edge as a fraction of W (mirrored for textSide end / RTL). */
  sideDeviceLeft: number;
}

export interface StackLayout {
  pad: number;
  text: { left: number; top: number; width: number; height: number };
  device: { left: number; top: number; width: number; height: number };
  /** True when the text column is narrower than full width (device sits beside it). */
  narrow: boolean;
}

export function stackLayout(
  input: TemplateRenderInput<CommonOverrides>,
  textHeight: number,
  defaults: StackLayoutDefaults,
): StackLayout {
  const { target, overrides, direction } = input;
  const W = target.width;
  const pad = Math.round(W * 0.07);
  const usable = W - 2 * pad;
  const textWidth = overrides.textWidth ?? defaults.textWidth;
  const narrow = textWidth < 0.999;
  const textW = Math.round(usable * textWidth);
  const side = overrides.textSide ?? defaults.textSide;
  const hugsLeft = (side === "start") !== (direction === "rtl"); // visual left
  const textLeft = hugsLeft ? pad : W - pad - textW;
  const textTop = Math.round(W * 0.09) + Math.round(W * (overrides.textOffsetY ?? 0));

  const scale = overrides.screenshotScale ?? defaults.scale;
  const devW = Math.round(W * scale);
  // Phone shells keep a phone aspect even on a 9:16 Play canvas; tablets use the canvas aspect.
  const devAspect = target.family === "ipad" || target.family === "tablet" ? target.width / target.height : 1320 / 2868;
  const devH = Math.round(devW / devAspect);
  let devLeft: number;
  let devTop: number;
  if (narrow) {
    devLeft = hugsLeft ? Math.round(W * defaults.sideDeviceLeft) : Math.round(W - W * defaults.sideDeviceLeft - devW);
    devTop = textTop;
  } else {
    devLeft = Math.round((W - devW) / 2);
    devTop = textTop + textHeight + Math.round(W * defaults.gap);
  }
  devLeft += Math.round(W * (overrides.screenshotOffsetX ?? 0) * (direction === "rtl" ? -1 : 1));
  devTop += Math.round(W * (overrides.screenshotOffsetY ?? 0));
  return {
    pad,
    text: { left: textLeft, top: textTop, width: textW, height: textHeight },
    device: { left: devLeft, top: devTop, width: devW, height: devH },
    narrow,
  };
}
