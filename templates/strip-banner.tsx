import type { ReactElement } from "react";
import { z } from "zod";
import { Decor, decorSchema } from "./decor";
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
 * Strip Banner: one composition across the whole set. A single headline is set
 * across the full strip so each screenshot carries a fragment of it, and one
 * device per slice sits underneath, staggered. Meant for a panorama screen with
 * `perSliceSources` so every slice shows a different capture.
 *
 * At one slice it degrades to a centred banner over a single device.
 */
export const overridesSchema = commonOverridesSchema.extend({
  /** Headline size as a fraction of one screen's width. */
  headlineScale: z.number().min(0.05).max(0.3).optional(),
  /** Vertical stagger between neighbouring devices, fraction of a screen's width. */
  stagger: z.number().min(0).max(0.4).optional(),
  /** Alternate the device tilt left/right instead of using one angle for all. */
  alternateTilt: z.boolean().optional(),
  /** Decorative shape behind the devices, drawn once across the strip. */
  decor: decorSchema.optional(),
  decorOpacity: z.number().min(0).max(1).optional(),
  /** Colour of the per-slice label pill; "none" draws the label without a pill. */
  labelColor: z.string().min(1).optional(),
});

type Overrides = z.infer<typeof overridesSchema>;

export const descriptor = {
  id: "strip-banner",
  name: "Strip Banner",
  summary: "Full strip: one headline set across every screenshot, with a staggered device per slice.",
  requiredFields: ["headline"],
  // caption is one line of support under the strip-wide headline; label/label2/
  // label3 are the short pills over each slice's device.
  optionalFields: ["eyebrow", "caption", "label", "label2", "label3"],
  families: ["iphone", "ipad", "phone"] as ("iphone" | "ipad" | "phone")[],
  orientations: ["portrait"] as "portrait"[],
  strip: true,
  overrideKeys: [
    ...COMMON_OVERRIDE_KEYS,
    "headlineScale",
    "stagger",
    "alternateTilt",
    "decor",
    "decorOpacity",
    "labelColor",
  ],
  fieldBudget: (field: string, target: { width: number; family: string }, overrides: Record<string, unknown>) => {
    const W = target.width;
    const k = target.family === "ipad" ? 0.78 : 1;
    const scale = typeof overrides.headlineScale === "number" ? overrides.headlineScale : 0.13;
    // The headline spans the whole strip, so its budget grows with the slices.
    if (field === "headline") return Math.floor((W * 2.6) / (W * scale * k * 0.5)) * 2;
    if (field === "caption") return Math.floor((W * 1.8) / (Math.round(W * 0.036 * k) * 0.5));
    if (field.startsWith("label")) return Math.floor((W * 0.7) / (Math.round(W * 0.032 * k) * 0.6)) * 2;
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
  const headlineSize = Math.round(W * (overrides.headlineScale ?? (slices > 1 ? 0.13 : 0.09)) * k);
  const captionSize = Math.round(W * 0.036 * k);
  const labelSize = Math.round(W * 0.032 * k);

  const eyebrowTop = Math.round(H * 0.06) + Math.round(W * (overrides.textOffsetY ?? 0));
  const eyebrowH = fields.eyebrow ? Math.round(eyebrowSize * 1.3) + Math.round(W * 0.025) : 0;
  const headlineH = Math.round(headlineSize * 1.04 * 2);
  const captionH = fields.caption ? Math.round(captionSize * 1.35) + Math.round(W * 0.025) : 0;
  const labels = Array.from({ length: slices }, (_, i) => fields[sliceField("label", i)]);
  const hasLabels = labels.some(Boolean);
  const labelTop = eyebrowTop + eyebrowH + headlineH + captionH + Math.round(W * 0.03);
  const labelH = hasLabels ? Math.round(labelSize * 1.3 * 2) + Math.round(W * 0.028) : 0;

  const devW = Math.round(W * (overrides.screenshotScale ?? (slices > 1 ? 0.68 : 0.76)));
  const devAspect = target.family === "ipad" || target.family === "tablet" ? W / H : 1320 / 2868;
  const devH = Math.round(devW / devAspect);
  const stagger = Math.round(W * (overrides.stagger ?? 0.05));
  const devTop = labelTop + labelH + Math.round(W * 0.05) + Math.round(W * (overrides.screenshotOffsetY ?? 0));
  const tilt = overrides.deviceTilt ?? 0;

  return (
    <Artwork input={input}>
      <Decor
        kind={overrides.decor ?? "none"}
        color={textColor}
        opacity={overrides.decorOpacity ?? 0.12}
        left={Math.round((CW - CW * 0.8) / 2)}
        top={Math.round(devTop - W * 0.15)}
        size={Math.round(CW * 0.8)}
        style={{ height: Math.round(W * 0.8) }}
      />

      <div
        style={{
          position: "absolute",
          left: pad + Math.round(W * (overrides.textOffsetX ?? 0) * (rtl ? -1 : 1)),
          top: eyebrowTop,
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
            marginBottom: Math.round(W * 0.025),
            width: "100%",
          }}
        />
        {/* One headline laid out across the whole strip: each screenshot shows a
            fragment, and the set only reads as a sentence side by side. */}
        <TextBlock
          id="headline"
          text={fields.headline}
          fontSize={headlineSize}
          lineHeight={1.04}
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
          style={{ opacity: 0.85, marginTop: Math.round(W * 0.025), width: "100%" }}
        />
      </div>

      {hasLabels
        ? labels.map((text, i) =>
            text ? (
              <div
                key={i}
                style={{
                  position: "absolute",
                  left: i * W,
                  top: labelTop,
                  width: W,
                  display: "flex",
                  justifyContent: "center",
                }}
              >
                <div
                  style={{
                    maxWidth: Math.round(W * 0.8),
                    padding:
                      overrides.labelColor === "none" ? 0 : `${Math.round(W * 0.012)}px ${Math.round(W * 0.026)}px`,
                    borderRadius: 999,
                    background:
                      overrides.labelColor === "none"
                        ? undefined
                        : (overrides.labelColor ?? withAlpha(textColor, 0.14)),
                  }}
                >
                  <TextBlock
                    id={sliceField("label", i)}
                    text={text}
                    fontSize={labelSize}
                    lineHeight={1.3}
                    maxLines={2}
                    weight={600}
                    align="center"
                    fitMinScale={0.7}
                    style={{ textTransform: "uppercase", letterSpacing: Math.round(labelSize * 0.1) }}
                  />
                </div>
              </div>
            ) : null,
          )
        : null}

      {Array.from({ length: slices }, (_, i) => {
        // Devices step down and up again so the row has a rhythm instead of a ruler line.
        const step = i % 2 === 1 ? stagger : 0;
        const left =
          i * W + Math.round((W - devW) / 2) + Math.round(W * (overrides.screenshotOffsetX ?? 0) * (rtl ? -1 : 1));
        const angle = overrides.alternateTilt ? (i % 2 === 0 ? tilt - 5 : tilt + 5) : tilt;
        return (
          <DeviceShell
            key={i}
            input={{ ...input, overrides: { ...overrides, deviceTilt: angle } }}
            width={devW}
            height={devH}
            left={left}
            top={devTop + step}
            imageUrl={sliceImage(input, i)}
          />
        );
      })}
    </Artwork>
  );
}

const stripBanner: TemplateModule<typeof overridesSchema> = { descriptor, overridesSchema, render };
export default stripBanner;
