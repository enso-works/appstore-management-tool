import type { ReactElement } from "react";
import { z } from "zod";
import {
  Artwork,
  COMMON_OVERRIDE_KEYS,
  commonOverridesSchema,
  DeviceShell,
  sliceCount,
  sliceField,
  sliceImage,
  TextBlock,
  textAlignOf,
  withAlpha,
} from "./shared";
import type { TemplateModule, TemplateRenderInput } from "./types";

/**
 * Strip Arc: the devices sit on a curve that peaks in the middle of the set,
 * with one huge ring drawn across every screenshot behind them. The curve is
 * what makes the screenshots obviously belong together in the store's
 * side-by-side gallery — the eye follows it from the first shot to the last.
 */
export const overridesSchema = commonOverridesSchema.extend({
  /** Height of the curve, fraction of one screen's width (0 = a flat row). */
  arc: z.number().min(0).max(0.5).optional(),
  /** Draw the ring the devices sit on. */
  ring: z.boolean().optional(),
  /** Ring colour; default the text colour. */
  ringColor: z.string().min(1).optional(),
  /** Ring line thickness, fraction of one screen's width. */
  ringWidth: z.number().min(0.001).max(0.05).optional(),
  /** Turn the curve upside down (devices dip in the middle). */
  invert: z.boolean().optional(),
  /** Headline size as a fraction of one screen's width. */
  headlineScale: z.number().min(0.05).max(0.3).optional(),
});

type Overrides = z.infer<typeof overridesSchema>;

export const descriptor = {
  id: "strip-arc",
  name: "Strip Arc",
  summary: "Full strip: devices on a curve that peaks mid-set, with one ring drawn across every screenshot.",
  requiredFields: ["headline"],
  optionalFields: ["eyebrow", "caption", "label", "label2", "label3"],
  families: ["iphone", "ipad", "phone"] as ("iphone" | "ipad" | "phone")[],
  orientations: ["portrait"] as "portrait"[],
  strip: true,
  overrideKeys: [...COMMON_OVERRIDE_KEYS, "arc", "ring", "ringColor", "ringWidth", "invert", "headlineScale"],
  fieldBudget: (field: string, target: { width: number; family: string }, overrides: Record<string, unknown>) => {
    const W = target.width;
    const k = target.family === "ipad" ? 0.78 : 1;
    const scale = typeof overrides.headlineScale === "number" ? overrides.headlineScale : 0.115;
    if (field === "headline") return Math.floor((W * 2.6) / (W * scale * k * 0.5)) * 2;
    if (field === "caption") return Math.floor((W * 1.8) / (Math.round(W * 0.036 * k) * 0.5));
    if (field.startsWith("label")) return Math.floor((W * 0.7) / (Math.round(W * 0.03 * k) * 0.6));
    if (field === "eyebrow") return Math.floor((W * 2) / (Math.round(W * 0.03 * k) * 0.62));
    return undefined;
  },
};

export function render(input: TemplateRenderInput<Overrides>): ReactElement {
  const { target, fields, brand, overrides, direction } = input;
  const W = target.width;
  const H = target.height;
  const CW = input.canvasWidth;
  const slices = sliceCount(input);
  const k = target.family === "ipad" ? 0.78 : 1;
  const rtl = direction === "rtl";
  const align = textAlignOf(input, "center");
  const pad = Math.round(W * 0.07);
  const textColor = overrides.textColor ?? brand.onPrimary;

  const eyebrowSize = Math.round(W * 0.03 * k);
  const headlineSize = Math.round(W * (overrides.headlineScale ?? (slices > 1 ? 0.115 : 0.085)) * k);
  const captionSize = Math.round(W * 0.036 * k);
  const labelSize = Math.round(W * 0.03 * k);

  const textTop = Math.round(H * 0.06) + Math.round(W * (overrides.textOffsetY ?? 0));
  const eyebrowH = fields.eyebrow ? Math.round(eyebrowSize * 1.3) + Math.round(W * 0.022) : 0;
  const headlineH = Math.round(headlineSize * 1.05 * 2);
  const captionH = fields.caption ? Math.round(captionSize * 1.35) + Math.round(W * 0.022) : 0;

  const devW = Math.round(W * (overrides.screenshotScale ?? (slices > 1 ? 0.64 : 0.74)));
  const devAspect = target.family === "ipad" || target.family === "tablet" ? W / H : 1320 / 2868;
  const devH = Math.round(devW / devAspect);
  const arc = Math.round(W * (overrides.arc ?? 0.14));
  const baseTop = textTop + eyebrowH + headlineH + captionH + Math.round(W * 0.09);
  const labels = Array.from({ length: slices }, (_, i) => fields[sliceField("label", i)]);

  // The ring: one ellipse wider than the strip whose top edge runs just under the
  // devices, so a single curve is visible in every screenshot.
  const ringColor = overrides.ringColor ?? textColor;
  const ringW = Math.round(CW * 1.35);
  const ringH = Math.round(W * 2.6);
  const ringTop = baseTop + Math.round(devH * 0.42);
  const ringStroke = Math.max(2, Math.round(W * (overrides.ringWidth ?? 0.004)));

  /** Devices follow a half sine: highest in the middle of the strip (or lowest, inverted). */
  const lift = (i: number) => {
    if (slices === 1 || arc === 0) return 0;
    const t = (i + 0.5) / slices;
    const rise = Math.sin(Math.PI * t);
    return Math.round((overrides.invert ? rise : 1 - rise) * arc);
  };

  return (
    <Artwork input={input}>
      {overrides.ring === false ? null : (
        <div
          aria-hidden
          data-ring=""
          style={{
            position: "absolute",
            left: Math.round((CW - ringW) / 2),
            top: ringTop,
            width: ringW,
            height: ringH,
            borderRadius: "50%",
            border: `${ringStroke}px solid ${withAlpha(ringColor, 0.45)}`,
            pointerEvents: "none",
          }}
        />
      )}

      <div
        style={{
          position: "absolute",
          left: pad + Math.round(W * (overrides.textOffsetX ?? 0) * (rtl ? -1 : 1)),
          top: textTop,
          width: CW - 2 * pad,
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
            letterSpacing: Math.round(eyebrowSize * 0.14),
            opacity: 0.8,
            marginBottom: Math.round(W * 0.022),
            width: "100%",
          }}
        />
        <TextBlock
          id="headline"
          text={fields.headline}
          fontSize={headlineSize}
          lineHeight={1.05}
          maxLines={2}
          weight={800}
          align={align}
          fitMinScale={0.6}
          fontFamily={brand.headlineFontStack}
          style={{ letterSpacing: brand.headlineFontStack ? 0 : -Math.round(headlineSize * 0.03), width: "100%" }}
        />
        <TextBlock
          id="caption"
          text={fields.caption}
          fontSize={captionSize}
          lineHeight={1.35}
          maxLines={1}
          weight={400}
          align={align}
          fitMinScale={0.8}
          style={{ opacity: 0.85, marginTop: Math.round(W * 0.022), width: "100%" }}
        />
      </div>

      {Array.from({ length: slices }, (_, i) => {
        const top = baseTop + lift(i) + Math.round(W * (overrides.screenshotOffsetY ?? 0));
        const left =
          i * W + Math.round((W - devW) / 2) + Math.round(W * (overrides.screenshotOffsetX ?? 0) * (rtl ? -1 : 1));
        const label = labels[i];
        return (
          <div key={i}>
            <DeviceShell
              input={input}
              width={devW}
              height={devH}
              left={left}
              top={top}
              imageUrl={sliceImage(input, i)}
            />
            {label ? (
              <div
                style={{
                  position: "absolute",
                  left: i * W + pad,
                  top: top - Math.round(labelSize * 1.3) - Math.round(W * 0.028),
                  width: W - 2 * pad,
                }}
              >
                <TextBlock
                  id={sliceField("label", i)}
                  text={label}
                  fontSize={labelSize}
                  lineHeight={1.3}
                  maxLines={1}
                  weight={600}
                  align="center"
                  fitMinScale={0.75}
                  style={{
                    textTransform: "uppercase",
                    letterSpacing: Math.round(labelSize * 0.12),
                    opacity: 0.85,
                    width: "100%",
                  }}
                />
              </div>
            ) : null}
          </div>
        );
      })}
    </Artwork>
  );
}

const stripArc: TemplateModule<typeof overridesSchema> = { descriptor, overridesSchema, render };
export default stripArc;
