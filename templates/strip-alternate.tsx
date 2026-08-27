import type { ReactElement } from "react";
import { z } from "zod";
import {
  Artwork,
  COMMON_OVERRIDE_KEYS,
  commonOverridesSchema,
  darken,
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
 * Strip Alternate: a zig-zag rhythm across the set — copy above the device on
 * one screenshot, below it on the next — over one diagonal band that runs the
 * length of the strip. Each screenshot still reads on its own (its own headline
 * and caption), while the band and the alternating beat tie the set together.
 */
export const overridesSchema = commonOverridesSchema.extend({
  /** Diagonal band behind the devices; "none" leaves just the background. */
  band: z.enum(["solid", "soft", "none"]).optional(),
  /** Band colour; default the brand colour darkened. */
  bandColor: z.string().min(1).optional(),
  /** Tilt of the band in degrees across the whole strip (mirrored in RTL). */
  bandAngle: z.number().min(-25).max(25).optional(),
  /** Band thickness, fraction of the canvas height. */
  bandWidth: z.number().min(0.1).max(1).optional(),
  /** Start with the copy below the device instead of above it. */
  flip: z.boolean().optional(),
});

type Overrides = z.infer<typeof overridesSchema>;

export const descriptor = {
  id: "strip-alternate",
  name: "Strip Alternate",
  summary: "Full strip: copy above the device, then below it, over one diagonal band running the length of the set.",
  requiredFields: ["headline"],
  optionalFields: ["eyebrow", "caption", "headline2", "caption2", "headline3", "caption3"],
  families: ["iphone", "ipad", "phone"] as ("iphone" | "ipad" | "phone")[],
  orientations: ["portrait"] as "portrait"[],
  strip: true,
  overrideKeys: [...COMMON_OVERRIDE_KEYS, "band", "bandColor", "bandAngle", "bandWidth", "flip"],
  fieldBudget: (field: string, target: { width: number; family: string }) => {
    const W = target.width;
    const k = target.family === "ipad" ? 0.78 : 1;
    const usable = W - 2 * Math.round(W * 0.08);
    if (field.startsWith("headline")) return Math.floor((usable / (Math.round(W * 0.066 * k) * 0.52)) * 2);
    if (field.startsWith("caption")) return Math.floor((usable / (Math.round(W * 0.034 * k) * 0.5)) * 2);
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

  const eyebrowSize = Math.round(W * 0.03 * k);
  const headlineSize = Math.round(W * 0.066 * k);
  const captionSize = Math.round(W * 0.034 * k);

  const band = overrides.band ?? "soft";
  const bandColor = overrides.bandColor ?? darken(brand.primary, 0.55);
  const bandAngle = (overrides.bandAngle ?? -7) * (rtl ? -1 : 1);
  const bandH = Math.round(H * (overrides.bandWidth ?? 0.46));

  const devW = Math.round(W * (overrides.screenshotScale ?? 0.6));
  const devAspect = target.family === "ipad" || target.family === "tablet" ? W / H : 1320 / 2868;
  const devH = Math.round(devW / devAspect);

  // Two slots, and the device is anchored differently in each: with the copy on
  // top the phone rises from the bottom edge; with the copy below it hangs from
  // the top edge, cropped, so the lower third of the canvas stays free for type.
  const copyH = Math.round(eyebrowSize * 1.3) + Math.round(headlineSize * 1.1 * 2) + Math.round(captionSize * 1.35 * 2);
  const topCopy = Math.round(H * 0.07);
  const topDevice = topCopy + copyH + Math.round(W * 0.06);
  const lowDevice = -Math.round(devH * 0.2);
  const lowCopy = Math.round(H * 0.62);

  return (
    <Artwork input={input}>
      {band === "none" ? null : (
        <div
          aria-hidden
          data-band={band}
          style={{
            position: "absolute",
            left: -Math.round(CW * 0.1),
            top: Math.round(H * 0.5 - bandH / 2),
            width: Math.round(CW * 1.2),
            height: bandH,
            background:
              band === "soft"
                ? `linear-gradient(180deg, ${withAlpha(bandColor, 0)} 0%, ${withAlpha(bandColor, 0.9)} 35%, ${withAlpha(bandColor, 0.9)} 65%, ${withAlpha(bandColor, 0)} 100%)`
                : bandColor,
            transform: `rotate(${bandAngle}deg)`,
            transformOrigin: "50% 50%",
          }}
        />
      )}

      {Array.from({ length: slices }, (_, i) => {
        const copyOnTop = (i % 2 === 0) !== (overrides.flip === true);
        const devTop = (copyOnTop ? topDevice : lowDevice) + Math.round(W * (overrides.screenshotOffsetY ?? 0));
        const copyTop = (copyOnTop ? topCopy : lowCopy) + Math.round(W * (overrides.textOffsetY ?? 0));
        const left =
          i * W + Math.round((W - devW) / 2) + Math.round(W * (overrides.screenshotOffsetX ?? 0) * (rtl ? -1 : 1));
        const headline = fields[sliceField("headline", i)];
        const caption = fields[sliceField("caption", i)];
        const eyebrow = i === 0 ? fields.eyebrow : undefined;
        return (
          <div key={i}>
            <DeviceShell
              input={input}
              width={devW}
              height={devH}
              left={left}
              top={devTop}
              imageUrl={sliceImage(input, i)}
            />
            {headline || caption || eyebrow ? (
              <div
                data-text-stack={i}
                style={{
                  position: "absolute",
                  left: i * W + pad + Math.round(W * (overrides.textOffsetX ?? 0) * (rtl ? -1 : 1)),
                  top: copyTop,
                  width: W - 2 * pad,
                  height: copyH,
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: copyOnTop ? "flex-end" : "flex-start",
                  alignItems: align === "center" ? "center" : align === "end" ? "flex-end" : "flex-start",
                }}
              >
                <TextBlock
                  id="eyebrow"
                  text={eyebrow}
                  fontSize={eyebrowSize}
                  lineHeight={1.3}
                  maxLines={1}
                  weight={600}
                  align={align}
                  style={{
                    textTransform: "uppercase",
                    letterSpacing: Math.round(eyebrowSize * 0.14),
                    opacity: 0.8,
                    marginBottom: Math.round(W * 0.018),
                    width: "100%",
                  }}
                />
                <TextBlock
                  id={sliceField("headline", i)}
                  text={headline}
                  fontSize={headlineSize}
                  lineHeight={1.1}
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
                  style={{ opacity: 0.85, marginTop: Math.round(W * 0.016), width: "100%" }}
                />
              </div>
            ) : null}
          </div>
        );
      })}
    </Artwork>
  );
}

const stripAlternate: TemplateModule<typeof overridesSchema> = { descriptor, overridesSchema, render };
export default stripAlternate;
