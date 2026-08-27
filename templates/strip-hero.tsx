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
 * Strip Hero: one screenshot in the set carries the pitch and the others
 * support it. The hero slice gets a large device and the big headline; its
 * neighbours get smaller devices, their own short copy and a dimmed ground, so
 * the eye lands on the hero first even though all three are the same size on
 * the store page.
 *
 * Put the hero first (the default) — on the App Store the first screenshot is
 * the one everybody sees.
 */
export const overridesSchema = commonOverridesSchema.extend({
  /** Which screenshot is the hero, 1-based. */
  heroSlice: z.number().int().min(1).max(3).optional(),
  /** Hero device width as a fraction of one screen's width. */
  heroScale: z.number().min(0.3).max(1.2).optional(),
  /** Supporting device width as a fraction of one screen's width. */
  supportScale: z.number().min(0.2).max(1).optional(),
  /** How much the supporting slices are knocked back (0 = not at all). */
  supportDim: z.number().min(0).max(0.6).optional(),
  /** Hero headline size as a fraction of one screen's width. */
  headlineScale: z.number().min(0.05).max(0.25).optional(),
});

type Overrides = z.infer<typeof overridesSchema>;

export const descriptor = {
  id: "strip-hero",
  name: "Strip Hero",
  summary:
    "Full strip: one screenshot carries the pitch with a large device, the others support it, smaller and dimmed.",
  requiredFields: ["headline"],
  optionalFields: ["eyebrow", "caption", "headline2", "caption2", "headline3", "caption3"],
  families: ["iphone", "ipad", "phone"] as ("iphone" | "ipad" | "phone")[],
  orientations: ["portrait"] as "portrait"[],
  strip: true,
  overrideKeys: [...COMMON_OVERRIDE_KEYS, "heroSlice", "heroScale", "supportScale", "supportDim", "headlineScale"],
  fieldBudget: (field: string, target: { width: number; family: string }, overrides: Record<string, unknown>) => {
    const W = target.width;
    const k = target.family === "ipad" ? 0.78 : 1;
    const usable = W - 2 * Math.round(W * 0.08);
    const scale = typeof overrides.headlineScale === "number" ? overrides.headlineScale : 0.1;
    if (field === "headline") return Math.floor((usable / (Math.round(W * scale * k) * 0.52)) * 3);
    if (field.startsWith("headline")) return Math.floor((usable / (Math.round(W * 0.055 * k) * 0.52)) * 2);
    if (field === "caption") return Math.floor((usable / (Math.round(W * 0.036 * k) * 0.5)) * 2);
    if (field.startsWith("caption")) return Math.floor((usable / (Math.round(W * 0.032 * k) * 0.5)) * 2);
    if (field === "eyebrow") return Math.floor(usable / (Math.round(W * 0.03 * k) * 0.62));
    return undefined;
  },
};

export function render(input: TemplateRenderInput<Overrides>): ReactElement {
  const { target, fields, brand, overrides, direction } = input;
  const W = target.width;
  const H = target.height;
  const slices = sliceCount(input);
  const k = target.family === "ipad" ? 0.78 : 1;
  const rtl = direction === "rtl";
  const align = textAlignOf(input, "center");
  const pad = Math.round(W * 0.08);
  const textColor = overrides.textColor ?? brand.onPrimary;

  const hero = Math.min(slices, overrides.heroSlice ?? 1) - 1;
  const eyebrowSize = Math.round(W * 0.03 * k);
  const heroSize = Math.round(W * (overrides.headlineScale ?? 0.1) * k);
  const supportSize = Math.round(W * 0.055 * k);
  const heroCaptionSize = Math.round(W * 0.036 * k);
  const supportCaptionSize = Math.round(W * 0.032 * k);
  const dim = overrides.supportDim ?? 0.25;

  const devAspect = target.family === "ipad" || target.family === "tablet" ? W / H : 1320 / 2868;
  const heroW = Math.round(W * (overrides.heroScale ?? 0.76));
  const supportW = Math.round(W * (overrides.supportScale ?? 0.52));

  const textTop = Math.round(H * 0.07) + Math.round(W * (overrides.textOffsetY ?? 0));
  // One copy box height for every slice, so the devices below line up whatever
  // the copy does — the hero simply fills more of it.
  const copyH = Math.round(eyebrowSize * 1.3 + heroSize * 1.12 * 3 + heroCaptionSize * 1.35 * 2);
  const devTop = textTop + copyH + Math.round(W * 0.05) + Math.round(W * (overrides.screenshotOffsetY ?? 0));

  return (
    <Artwork input={input}>
      {Array.from({ length: slices }, (_, i) => {
        const isHero = i === hero;
        const devW = isHero ? heroW : supportW;
        const devH = Math.round(devW / devAspect);
        const left =
          i * W + Math.round((W - devW) / 2) + Math.round(W * (overrides.screenshotOffsetX ?? 0) * (rtl ? -1 : 1));
        // Supporting slices sit slightly lower, which reads as "further back".
        const top = devTop + (isHero ? 0 : Math.round(W * 0.05));
        const headline = fields[sliceField("headline", i)];
        const caption = fields[sliceField("caption", i)];
        return (
          <div key={i}>
            {!isHero && dim > 0 ? (
              <div
                aria-hidden
                style={{
                  position: "absolute",
                  left: i * W,
                  top: 0,
                  width: W,
                  height: H,
                  background: withAlpha("#000000", dim),
                }}
              />
            ) : null}
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
                text={isHero ? fields.eyebrow : undefined}
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
                fontSize={isHero ? heroSize : supportSize}
                lineHeight={1.12}
                maxLines={isHero ? 3 : 2}
                weight={isHero ? 800 : 600}
                align={align}
                fitMinScale={0.65}
                fontFamily={brand.headlineFontStack}
                style={{ width: "100%", opacity: isHero ? 1 : 0.92 }}
              />
              <TextBlock
                id={sliceField("caption", i)}
                text={caption}
                fontSize={isHero ? heroCaptionSize : supportCaptionSize}
                lineHeight={1.35}
                maxLines={2}
                weight={400}
                align={align}
                fitMinScale={0.8}
                style={{ opacity: 0.85, marginTop: Math.round(W * 0.02), width: "100%", color: textColor }}
              />
            </div>
            <DeviceShell
              input={input}
              width={devW}
              height={devH}
              left={left}
              top={top}
              imageUrl={sliceImage(input, i)}
            />
          </div>
        );
      })}
    </Artwork>
  );
}

const stripHero: TemplateModule<typeof overridesSchema> = { descriptor, overridesSchema, render };
export default stripHero;
