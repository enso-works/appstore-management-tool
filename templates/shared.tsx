import type { CSSProperties, ReactElement } from "react";
import { z } from "zod";
import { ARTWORK_ATTR, type TemplateRenderInput } from "./types";

/** Overrides every template accepts (plan §9.2: semantic controls only, no x/y dragging). */
export const commonOverridesSchema = z.strictObject({
  /** Any CSS background value; default derives from brand.primary. */
  background: z.string().min(1).optional(),
  /** Device width as a fraction of the canvas width. */
  screenshotScale: z.number().min(0.4).max(1.2).optional(),
  /** Vertical nudge of the device, as a fraction of the canvas width (positive = down). */
  screenshotOffsetY: z.number().min(-0.5).max(0.8).optional(),
  /** Rotation in degrees. */
  deviceTilt: z.number().min(-15).max(15).optional(),
  textAlign: z.enum(["start", "center", "end"]).optional(),
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

/** Root artwork element: exact canvas size, clips everything, sets font and direction. */
export function Artwork({
  input,
  background,
  children,
  style,
}: {
  input: TemplateRenderInput<CommonOverrides>;
  background?: string;
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
        background: background ?? input.overrides.background ?? defaultBackground(brand.primary),
        color: brand.onPrimary,
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
  /** Absolute position inside the artwork. */
  left: number;
  top: number;
}

/**
 * Neutral device shell (plan §10.3 / §3.1): rounded rectangle with a thin
 * bezel, capture inside with object-fit cover anchored to the top. No Apple
 * hardware art.
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
