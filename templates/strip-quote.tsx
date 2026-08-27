import type { ReactElement } from "react";
import { z } from "zod";
import {
  Artwork,
  COMMON_OVERRIDE_KEYS,
  commonOverridesSchema,
  DeviceShell,
  sliceCount,
  sliceImage,
  TextBlock,
  textAlignOf,
  withAlpha,
} from "./shared";
import type { TemplateModule, TemplateRenderInput } from "./types";

/**
 * Strip Quote: social proof across the whole set — a review set large enough to
 * span every screenshot, a star rating above it and the attribution below, with
 * the devices small along the bottom edge. Use it as the opening or closing pair
 * of a listing, where the reason to trust the app does more work than a feature.
 *
 * `headline` is the quote, `caption` the attribution ("— Sarah, teacher").
 */
export const overridesSchema = commonOverridesSchema.extend({
  /** Stars to draw above the quote; 0 hides the row. */
  stars: z.number().min(0).max(5).optional(),
  /** Star colour; default the text colour. */
  starColor: z.string().min(1).optional(),
  /** Oversized quotation mark behind the quote. */
  quoteMark: z.boolean().optional(),
  /** Quote size as a fraction of one screen's width. */
  headlineScale: z.number().min(0.04).max(0.2).optional(),
});

type Overrides = z.infer<typeof overridesSchema>;

/** Five-pointed star as an inline SVG data URI (no assets, no icon font). */
function starUri(color: string): string {
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'><path d='M12 2.6 15 9.2 22.2 10 16.8 14.8 18.3 21.9 12 18.2 5.7 21.9 7.2 14.8 1.8 10 9 9.2Z' fill='${color}'/></svg>`;
  return `url("data:image/svg+xml;utf8,${svg.replace(/#/g, "%23").replace(/"/g, "'")}")`;
}

export const descriptor = {
  id: "strip-quote",
  name: "Strip Quote",
  summary: "Full strip: a review spanning every screenshot, stars above it, the devices small along the bottom.",
  requiredFields: ["headline"],
  optionalFields: ["eyebrow", "caption"],
  families: ["iphone", "ipad", "phone"] as ("iphone" | "ipad" | "phone")[],
  orientations: ["portrait"] as "portrait"[],
  strip: true,
  overrideKeys: [...COMMON_OVERRIDE_KEYS, "stars", "starColor", "quoteMark", "headlineScale"],
  fieldBudget: (field: string, target: { width: number; family: string }, overrides: Record<string, unknown>) => {
    const W = target.width;
    const k = target.family === "ipad" ? 0.78 : 1;
    const scale = typeof overrides.headlineScale === "number" ? overrides.headlineScale : 0.075;
    if (field === "headline") return Math.floor((W * 2.4) / (W * scale * k * 0.5)) * 3;
    if (field === "caption") return Math.floor((W * 1.6) / (Math.round(W * 0.034 * k) * 0.5));
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
  const pad = Math.round(W * 0.08);
  const textColor = overrides.textColor ?? brand.onPrimary;

  const eyebrowSize = Math.round(W * 0.03 * k);
  const quoteSize = Math.round(W * (overrides.headlineScale ?? (slices > 1 ? 0.075 : 0.06)) * k);
  const captionSize = Math.round(W * 0.034 * k);

  const stars = Math.round(overrides.stars ?? 5);
  const starSize = Math.round(W * 0.045);
  const starColor = overrides.starColor ?? textColor;

  const top = Math.round(H * 0.1) + Math.round(W * (overrides.textOffsetY ?? 0));

  const devW = Math.round(W * (overrides.screenshotScale ?? 0.58));
  const devAspect = target.family === "ipad" || target.family === "tablet" ? W / H : 1320 / 2868;
  const devH = Math.round(devW / devAspect);
  // The devices hang off the bottom edge: the quote is the subject, they are the evidence.
  const devTop = Math.round(H * 0.57) + Math.round(W * (overrides.screenshotOffsetY ?? 0));

  return (
    <Artwork input={input}>
      {overrides.quoteMark === false ? null : (
        <div
          aria-hidden
          data-quote-mark=""
          style={{
            position: "absolute",
            left: Math.round(CW / 2 - W * 0.5),
            top: Math.round(top - W * 0.24),
            width: W,
            fontSize: Math.round(W * 0.42),
            lineHeight: 0.8,
            fontWeight: 800,
            textAlign: "center",
            color: withAlpha(textColor, 0.14),
            fontFamily: brand.headlineFontStack,
            pointerEvents: "none",
          }}
        >
          &ldquo;
        </div>
      )}

      <div
        style={{
          position: "absolute",
          left: pad + Math.round(W * (overrides.textOffsetX ?? 0) * (rtl ? -1 : 1)),
          top,
          width: CW - 2 * pad,
          display: "flex",
          flexDirection: "column",
          alignItems: align === "center" ? "center" : align === "end" ? "flex-end" : "flex-start",
        }}
      >
        {stars > 0 ? (
          <div
            aria-hidden
            data-stars={stars}
            style={{ display: "flex", gap: Math.round(starSize * 0.22), marginBottom: Math.round(W * 0.03) }}
          >
            {Array.from({ length: stars }, (_, i) => (
              <span
                key={i}
                style={{
                  width: starSize,
                  height: starSize,
                  backgroundImage: starUri(starColor),
                  backgroundSize: "100% 100%",
                }}
              />
            ))}
          </div>
        ) : null}
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
            opacity: 0.75,
            marginBottom: Math.round(W * 0.025),
            width: "100%",
          }}
        />
        <TextBlock
          id="headline"
          text={fields.headline}
          fontSize={quoteSize}
          lineHeight={1.25}
          maxLines={3}
          weight={600}
          align={align}
          fitMinScale={0.65}
          fontFamily={brand.headlineFontStack}
          style={{ width: "100%" }}
        />
        <TextBlock
          id="caption"
          text={fields.caption}
          fontSize={captionSize}
          lineHeight={1.35}
          maxLines={1}
          weight={500}
          align={align}
          fitMinScale={0.8}
          style={{ opacity: 0.72, marginTop: Math.round(W * 0.03), width: "100%" }}
        />
      </div>

      {Array.from({ length: slices }, (_, i) => (
        <DeviceShell
          key={i}
          input={input}
          width={devW}
          height={devH}
          left={
            i * W + Math.round((W - devW) / 2) + Math.round(W * (overrides.screenshotOffsetX ?? 0) * (rtl ? -1 : 1))
          }
          top={devTop}
          imageUrl={sliceImage(input, i)}
        />
      ))}
    </Artwork>
  );
}

const stripQuote: TemplateModule<typeof overridesSchema> = { descriptor, overridesSchema, render };
export default stripQuote;
