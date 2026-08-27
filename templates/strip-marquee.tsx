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
 * Strip Marquee: one word or short phrase set enormous and repeated in a band
 * that runs the length of the strip, with the devices standing in front of it.
 * The band is cut by the screenshot seams, so the set only spells the phrase out
 * when the store shows the shots side by side — the strongest signal that these
 * screenshots belong together.
 *
 * `marquee` is the repeated phrase; the per-slice `headline`s carry the meaning.
 */
export const overridesSchema = commonOverridesSchema.extend({
  /** Marquee size as a fraction of one screen's width. */
  marqueeScale: z.number().min(0.06).max(0.4).optional(),
  /** Marquee opacity. */
  marqueeOpacity: z.number().min(0.02).max(1).optional(),
  /** Marquee colour; default the text colour. */
  marqueeColor: z.string().min(1).optional(),
  /** Where the band sits, fraction of the canvas height. */
  marqueeY: z.number().min(0).max(0.9).optional(),
  /** Tilt of the band in degrees (mirrored in RTL). */
  marqueeAngle: z.number().min(-20).max(20).optional(),
  /** Draw the phrase as outlines instead of solid type. */
  outline: z.boolean().optional(),
});

type Overrides = z.infer<typeof overridesSchema>;

export const descriptor = {
  id: "strip-marquee",
  name: "Strip Marquee",
  summary: "Full strip: one phrase set enormous and repeated behind the devices, cut by the screenshot seams.",
  requiredFields: ["headline"],
  optionalFields: ["marquee", "eyebrow", "caption", "headline2", "caption2", "headline3", "caption3"],
  families: ["iphone", "ipad", "phone"] as ("iphone" | "ipad" | "phone")[],
  orientations: ["portrait"] as "portrait"[],
  strip: true,
  overrideKeys: [
    ...COMMON_OVERRIDE_KEYS,
    "marqueeScale",
    "marqueeOpacity",
    "marqueeColor",
    "marqueeY",
    "marqueeAngle",
    "outline",
  ],
  fieldBudget: (field: string, target: { width: number; family: string }) => {
    const W = target.width;
    const k = target.family === "ipad" ? 0.78 : 1;
    const usable = W - 2 * Math.round(W * 0.08);
    if (field === "marquee") return 18;
    if (field.startsWith("headline")) return Math.floor((usable / (Math.round(W * 0.06 * k) * 0.52)) * 2);
    if (field.startsWith("caption")) return Math.floor((usable / (Math.round(W * 0.033 * k) * 0.5)) * 2);
    if (field === "eyebrow") return Math.floor(usable / (Math.round(W * 0.03 * k) * 0.62));
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
  const headlineSize = Math.round(W * 0.06 * k);
  const captionSize = Math.round(W * 0.033 * k);

  const phrase = (fields.marquee ?? "").trim();
  const marqueeSize = Math.round(W * (overrides.marqueeScale ?? 0.17));
  const marqueeColor = overrides.marqueeColor ?? textColor;
  const marqueeAngle = (overrides.marqueeAngle ?? -3) * (rtl ? -1 : 1);
  // Repeat enough times to cross the whole strip at any slice count; the row is
  // wider than the canvas and clipped by it, so the phrase never ends mid-canvas.
  const repeats = Math.max(3, Math.ceil((CW * 1.6) / (marqueeSize * Math.max(3, phrase.length) * 0.62)) + 2);

  const textTop = Math.round(H * 0.07) + Math.round(W * (overrides.textOffsetY ?? 0));
  const copyH = Math.round(eyebrowSize * 1.3 + headlineSize * 1.12 * 2 + captionSize * 1.35 * 2);

  const devW = Math.round(W * (overrides.screenshotScale ?? 0.62));
  const devAspect = target.family === "ipad" || target.family === "tablet" ? W / H : 1320 / 2868;
  const devH = Math.round(devW / devAspect);
  const devTop = textTop + copyH + Math.round(W * 0.06) + Math.round(W * (overrides.screenshotOffsetY ?? 0));

  return (
    <Artwork input={input}>
      {phrase ? (
        <div
          aria-hidden
          data-marquee=""
          style={{
            position: "absolute",
            left: -Math.round(CW * 0.3),
            top: Math.round(H * (overrides.marqueeY ?? 0.42)),
            width: Math.round(CW * 1.6),
            display: "flex",
            gap: Math.round(marqueeSize * 0.5),
            fontSize: marqueeSize,
            lineHeight: 1,
            fontWeight: 800,
            fontFamily: brand.headlineFontStack,
            whiteSpace: "nowrap",
            textTransform: "uppercase",
            letterSpacing: -Math.round(marqueeSize * 0.03),
            opacity: overrides.marqueeOpacity ?? 0.16,
            color: overrides.outline ? "transparent" : marqueeColor,
            WebkitTextStrokeWidth: overrides.outline ? Math.max(2, Math.round(W * 0.004)) : 0,
            WebkitTextStrokeColor: marqueeColor,
            transform: `rotate(${marqueeAngle}deg)`,
            transformOrigin: "50% 50%",
            pointerEvents: "none",
          }}
        >
          {Array.from({ length: repeats }, (_, i) => (
            <span key={i}>{phrase}</span>
          ))}
        </div>
      ) : null}

      {Array.from({ length: slices }, (_, i) => {
        const headline = fields[sliceField("headline", i)];
        const caption = fields[sliceField("caption", i)];
        const left =
          i * W + Math.round((W - devW) / 2) + Math.round(W * (overrides.screenshotOffsetX ?? 0) * (rtl ? -1 : 1));
        return (
          <div key={i}>
            <div
              data-text-stack={i}
              style={{
                position: "absolute",
                left: i * W + pad + Math.round(W * (overrides.textOffsetX ?? 0) * (rtl ? -1 : 1)),
                top: textTop,
                width: W - 2 * pad,
                height: copyH,
                display: "flex",
                flexDirection: "column",
                justifyContent: "flex-end",
                alignItems: align === "center" ? "center" : align === "end" ? "flex-end" : "flex-start",
              }}
            >
              <TextBlock
                id="eyebrow"
                text={i === 0 ? fields.eyebrow : undefined}
                fontSize={eyebrowSize}
                lineHeight={1.3}
                maxLines={1}
                weight={600}
                align={align}
                style={{
                  textTransform: "uppercase",
                  letterSpacing: Math.round(eyebrowSize * 0.14),
                  opacity: 0.8,
                  marginBottom: Math.round(W * 0.02),
                  width: "100%",
                }}
              />
              <TextBlock
                id={sliceField("headline", i)}
                text={headline}
                fontSize={headlineSize}
                lineHeight={1.12}
                maxLines={2}
                weight={700}
                align={align}
                fitMinScale={0.7}
                fontFamily={brand.headlineFontStack}
                style={{ width: "100%" }}
              />
              <TextBlock
                id={sliceField("caption", i)}
                text={caption}
                fontSize={captionSize}
                lineHeight={1.35}
                maxLines={2}
                weight={400}
                align={align}
                fitMinScale={0.8}
                style={{ opacity: 0.85, marginTop: Math.round(W * 0.018), width: "100%" }}
              />
            </div>
            <DeviceShell
              input={input}
              width={devW}
              height={devH}
              left={left}
              top={devTop}
              imageUrl={sliceImage(input, i)}
            />
          </div>
        );
      })}
      {/* A hairline under the marquee keeps it reading as a band, not stray type. */}
      {phrase ? (
        <div
          aria-hidden
          style={{
            position: "absolute",
            left: 0,
            top: Math.round(H * (overrides.marqueeY ?? 0.42)) + marqueeSize + Math.round(W * 0.02),
            width: CW,
            height: Math.max(1, Math.round(W * 0.0015)),
            background: withAlpha(marqueeColor, 0.18),
          }}
        />
      ) : null}
    </Artwork>
  );
}

const stripMarquee: TemplateModule<typeof overridesSchema> = { descriptor, overridesSchema, render };
export default stripMarquee;
