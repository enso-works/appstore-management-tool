import type { ReactElement } from "react";
import { z } from "zod";
import { Decor, decorSchema, Glow } from "./decor";
import {
  Artwork,
  COMMON_OVERRIDE_KEYS,
  commonOverridesSchema,
  DeviceShell,
  TextBlock,
  textAlignOf,
  withAlpha,
} from "./shared";
import type { TemplateModule, TemplateRenderInput } from "./types";

/**
 * Stat Hero: one number does the selling — "4.9", "10k", "3 min". The figure is
 * set oversized behind the device, so the phone splits it and the artwork reads
 * as one composition rather than a caption stuck above a screenshot.
 *
 * Fields: `stat` (the figure), `statLabel` (what it counts), plus the usual
 * headline/caption. Text is allowed to sit over the device here by design.
 */
export const overridesSchema = commonOverridesSchema.extend({
  /** How the figure is drawn. */
  statStyle: z.enum(["solid", "outline", "gradient"]).optional(),
  /** Colour of the figure (and the gradient's bright end); default the text colour. */
  statColor: z.string().min(1).optional(),
  /** Figure size as a fraction of the canvas width. */
  statScale: z.number().min(0.15).max(0.8).optional(),
  /** Figure opacity. */
  statOpacity: z.number().min(0.05).max(1).optional(),
  /** Vertical placement of the figure, fraction of the canvas height. */
  statOffsetY: z.number().min(0).max(1).optional(),
  /** Soft radial light behind the device. */
  glow: z.boolean().optional(),
  /** Decorative shape behind everything. */
  decor: decorSchema.optional(),
  decorOpacity: z.number().min(0).max(1).optional(),
});

type Overrides = z.infer<typeof overridesSchema>;

export const descriptor = {
  id: "stat-hero",
  name: "Stat Hero",
  summary: "One number does the selling: the figure set oversized behind the device, so the phone splits it.",
  requiredFields: ["headline"],
  optionalFields: ["eyebrow", "caption", "stat", "statLabel"],
  families: ["iphone", "ipad", "phone"] as ("iphone" | "ipad" | "phone")[],
  orientations: ["portrait"] as "portrait"[],
  overrideKeys: [
    ...COMMON_OVERRIDE_KEYS,
    "statStyle",
    "statColor",
    "statScale",
    "statOpacity",
    "statOffsetY",
    "glow",
    "decor",
    "decorOpacity",
  ],
  fieldBudget: (field: string, target: { width: number; family: string }, overrides: Record<string, unknown>) => {
    const W = target.width;
    const k = target.family === "ipad" ? 0.78 : 1;
    const usable = W - 2 * Math.round(W * 0.08);
    if (field === "headline") return Math.floor((usable / (Math.round(W * 0.068 * k) * 0.52)) * 2);
    if (field === "caption") return Math.floor((usable / (Math.round(W * 0.036 * k) * 0.5)) * 2);
    if (field === "eyebrow") return Math.floor(usable / (Math.round(W * 0.03 * k) * 0.62));
    if (field === "stat") {
      const size = W * (typeof overrides.statScale === "number" ? overrides.statScale : 0.4);
      return Math.max(2, Math.floor(W / (size * 0.6)));
    }
    if (field === "statLabel") return Math.floor(usable / (Math.round(W * 0.032 * k) * 0.62));
    return undefined;
  },
};

export function render(input: TemplateRenderInput<Overrides>): ReactElement {
  const { target, fields, brand, overrides, direction } = input;
  const W = target.width;
  const H = target.height;
  const CW = input.canvasWidth;
  const k = target.family === "ipad" ? 0.78 : 1;
  const align = textAlignOf(input, "center");
  const pad = Math.round(W * 0.08);
  const rtl = direction === "rtl";
  const textColor = overrides.textColor ?? brand.onPrimary;
  const statColor = overrides.statColor ?? textColor;

  const eyebrowSize = Math.round(W * 0.03 * k);
  const headlineSize = Math.round(W * 0.068 * k);
  const captionSize = Math.round(W * 0.036 * k);
  // No iPad shrink factor here: the figure has to stay wider than the device or
  // the phone hides it completely on a 4:3 canvas.
  const statSize = Math.round(W * (overrides.statScale ?? 0.4));
  const labelSize = Math.round(W * 0.032 * k);

  const style = overrides.statStyle ?? "solid";
  const statOpacity = overrides.statOpacity ?? (style === "solid" ? 0.9 : 1);
  // The label sits above the figure: below it the device would cover it.
  const statTop = Math.round(H * (overrides.statOffsetY ?? 0.26));

  const devW = Math.round(W * (overrides.screenshotScale ?? 0.62));
  const devAspect = target.family === "ipad" || target.family === "tablet" ? W / H : 1320 / 2868;
  const devH = Math.round(devW / devAspect);
  const devLeft = Math.round((CW - devW) / 2) + Math.round(W * (overrides.screenshotOffsetX ?? 0) * (rtl ? -1 : 1));
  // Anchored to the bottom of the figure, not to a fixed fraction of the height:
  // the phone must split the last third of the digits on a 19.5:9 phone and on a
  // 4:3 tablet alike.
  const statBlockH = (fields.statLabel ? Math.round(labelSize * 1.3) + Math.round(W * 0.012) : 0) + statSize * 0.92;
  const devTop =
    Math.round(statTop + statBlockH - statSize * 0.35) + Math.round(W * (overrides.screenshotOffsetY ?? 0));

  // background-clip:text needs the paint on the element itself; the outline
  // variant paints nothing and strokes the glyphs instead.
  const statPaint =
    style === "gradient"
      ? {
          backgroundImage: `linear-gradient(180deg, ${statColor} 0%, ${withAlpha(statColor, 0.15)} 100%)`,
          WebkitBackgroundClip: "text" as const,
          backgroundClip: "text" as const,
          color: "transparent",
        }
      : style === "outline"
        ? {
            color: "transparent",
            WebkitTextStrokeWidth: Math.max(2, Math.round(W * 0.005)),
            WebkitTextStrokeColor: statColor,
          }
        : { color: statColor };

  return (
    <Artwork input={input}>
      <Decor
        kind={overrides.decor ?? "none"}
        color={statColor}
        opacity={overrides.decorOpacity ?? 0.14}
        left={Math.round((CW - W * 1.2) / 2)}
        top={Math.round(H * 0.28)}
        size={Math.round(W * 1.2)}
      />
      {overrides.glow === false ? null : (
        <Glow
          color={statColor}
          cx={Math.round(CW / 2)}
          cy={Math.round(devTop + devH * 0.25)}
          spread={Math.round(W * 1.5)}
          strength={0.28}
        />
      )}

      <div
        style={{
          position: "absolute",
          left: pad + Math.round(W * (overrides.textOffsetX ?? 0) * (rtl ? -1 : 1)),
          top: Math.round(H * 0.07) + Math.round(W * (overrides.textOffsetY ?? 0)),
          width: Math.round((CW - 2 * pad) * (overrides.textWidth ?? 1)),
          display: "flex",
          flexDirection: "column",
          alignItems: align === "center" ? "center" : align === "end" ? "flex-end" : "flex-start",
        }}
      >
        <TextBlock
          id="eyebrow"
          text={fields.eyebrow}
          fontSize={eyebrowSize}
          lineHeight={1.3}
          maxLines={1}
          weight={600}
          align={align}
          style={{
            textTransform: "uppercase",
            letterSpacing: Math.round(eyebrowSize * 0.12),
            opacity: 0.85,
            marginBottom: Math.round(W * 0.018),
            width: "100%",
          }}
        />
        <TextBlock
          id="headline"
          text={fields.headline}
          fontSize={headlineSize}
          lineHeight={1.1}
          maxLines={2}
          weight={700}
          align={align}
          fitMinScale={0.7}
          fontFamily={brand.headlineFontStack}
          style={{ letterSpacing: brand.headlineFontStack ? 0 : -Math.round(headlineSize * 0.02), width: "100%" }}
        />
        <TextBlock
          id="caption"
          text={fields.caption}
          fontSize={captionSize}
          lineHeight={1.3}
          maxLines={2}
          weight={400}
          align={align}
          fitMinScale={0.8}
          style={{ opacity: 0.88, marginTop: Math.round(W * 0.018), width: "100%" }}
        />
      </div>

      <div
        style={{
          position: "absolute",
          left: 0,
          top: statTop,
          width: CW,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
        }}
      >
        <TextBlock
          id="statLabel"
          text={fields.statLabel}
          fontSize={labelSize}
          lineHeight={1.3}
          maxLines={1}
          weight={600}
          align="center"
          style={{
            width: "100%",
            textTransform: "uppercase",
            letterSpacing: Math.round(labelSize * 0.16),
            opacity: 0.75,
            marginBottom: Math.round(W * 0.012),
          }}
        />
        <TextBlock
          id="stat"
          text={fields.stat}
          fontSize={statSize}
          lineHeight={0.92}
          maxLines={1}
          weight={800}
          align="center"
          fitMinScale={0.45}
          fontFamily={brand.headlineFontStack}
          style={{
            width: "100%",
            opacity: statOpacity,
            letterSpacing: -Math.round(statSize * 0.04),
            ...statPaint,
          }}
        />
      </div>

      {/* The figure is meant to sit behind the device, so the overlap check opts out. */}
      <DeviceShell input={input} width={devW} height={devH} left={devLeft} top={devTop} overlapAllowed />
    </Artwork>
  );
}

const statHero: TemplateModule<typeof overridesSchema> = { descriptor, overridesSchema, render };
export default statHero;
