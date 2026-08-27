import type { ReactElement } from "react";
import { z } from "zod";
import { Decor, decorSchema } from "./decor";
import {
  Artwork,
  COMMON_OVERRIDE_KEYS,
  commonOverridesSchema,
  darken,
  DeviceShell,
  TextBlock,
  textAlignOf,
  withAlpha,
} from "./shared";
import type { TemplateModule, TemplateRenderInput } from "./types";

/**
 * Diagonal Band: an angled colour field cuts the canvas in two, the copy sits in
 * the upper field and the device crosses the edge. Two modes — "split" (the
 * lower half is filled) and "stripe" (a ribbon crosses the canvas) — with a
 * hairline along the cut so the edge stays crisp on flat brand colours.
 */
export const overridesSchema = commonOverridesSchema.extend({
  /** Filled lower field, or a ribbon across the canvas. */
  band: z.enum(["split", "stripe"]).optional(),
  /** Band colour; default the brand colour darkened. */
  bandColor: z.string().min(1).optional(),
  /** Tilt of the cut in degrees (mirrored in RTL). */
  bandAngle: z.number().min(-25).max(25).optional(),
  /** Where the cut crosses the middle of the canvas, fraction of the height. */
  bandPosition: z.number().min(0.1).max(0.95).optional(),
  /** Ribbon thickness, fraction of the canvas height ("stripe" only). */
  bandWidth: z.number().min(0.05).max(0.9).optional(),
  /** Hairline colour along the cut; "none" removes it. */
  bandEdgeColor: z.string().min(1).optional(),
  /** Decorative shape inside the band. */
  decor: decorSchema.optional(),
  decorOpacity: z.number().min(0).max(1).optional(),
});

type Overrides = z.infer<typeof overridesSchema>;

export const descriptor = {
  id: "diagonal-band",
  name: "Diagonal Band",
  summary: "An angled colour field or ribbon cuts the canvas and the device crosses the edge.",
  requiredFields: ["headline"],
  optionalFields: ["eyebrow", "caption"],
  families: ["iphone", "ipad", "phone"] as ("iphone" | "ipad" | "phone")[],
  orientations: ["portrait"] as "portrait"[],
  overrideKeys: [
    ...COMMON_OVERRIDE_KEYS,
    "band",
    "bandColor",
    "bandAngle",
    "bandPosition",
    "bandWidth",
    "bandEdgeColor",
    "decor",
    "decorOpacity",
  ],
  fieldBudget: (field: string, target: { width: number; family: string }) => {
    const W = target.width;
    const k = target.family === "ipad" ? 0.78 : 1;
    const usable = W - 2 * Math.round(W * 0.08);
    if (field === "headline") return Math.floor((usable / (Math.round(W * 0.085 * k) * 0.52)) * 3);
    if (field === "caption") return Math.floor((usable / (Math.round(W * 0.038 * k) * 0.5)) * 2);
    if (field === "eyebrow") return Math.floor(usable / (Math.round(W * 0.03 * k) * 0.62));
    return undefined;
  },
};

export function render(input: TemplateRenderInput<Overrides>): ReactElement {
  const { target, fields, brand, overrides, direction } = input;
  const W = target.width;
  const H = target.height;
  const CW = input.canvasWidth;
  const k = target.family === "ipad" ? 0.78 : 1;
  const align = textAlignOf(input, "start");
  const pad = Math.round(W * 0.08);
  const rtl = direction === "rtl";

  const eyebrowSize = Math.round(W * 0.03 * k);
  const headlineSize = Math.round(W * 0.085 * k);
  const captionSize = Math.round(W * 0.038 * k);

  const mode = overrides.band ?? "split";
  const bandColor = overrides.bandColor ?? darken(brand.primary, 0.68);
  // The cut mirrors with the reading direction so the composition stays the same shape.
  const angle = (overrides.bandAngle ?? -9) * (rtl ? -1 : 1);
  const position = Math.round(H * (overrides.bandPosition ?? 0.5));
  const bandH = mode === "stripe" ? Math.round(H * (overrides.bandWidth ?? 0.34)) : H * 2;
  const edge = overrides.bandEdgeColor ?? withAlpha("#ffffff", 0.22);

  const devW = Math.round(W * (overrides.screenshotScale ?? 0.62));
  const devAspect = target.family === "ipad" || target.family === "tablet" ? W / H : 1320 / 2868;
  const devH = Math.round(devW / devAspect);
  const devLeft = Math.round((CW - devW) / 2) + Math.round(W * (overrides.screenshotOffsetX ?? 0) * (rtl ? -1 : 1));
  const devTop = Math.round(H * 0.44) + Math.round(W * (overrides.screenshotOffsetY ?? 0));

  return (
    <Artwork input={input}>
      {/* A rotated rectangle rather than a clip-path: the edge can then carry a
          hairline, and the pivot keeps the cut crossing the canvas centre. */}
      <div
        aria-hidden
        data-band={mode}
        style={{
          position: "absolute",
          left: -Math.round(CW / 2),
          top: mode === "stripe" ? position - Math.round(bandH / 2) : position,
          width: CW * 2,
          height: bandH,
          background: bandColor,
          borderTop: edge === "none" ? undefined : `${Math.max(2, Math.round(W * 0.004))}px solid ${edge}`,
          borderBottom:
            mode === "stripe" && edge !== "none" ? `${Math.max(2, Math.round(W * 0.004))}px solid ${edge}` : undefined,
          transform: `rotate(${angle}deg)`,
          transformOrigin: mode === "stripe" ? "50% 50%" : "50% 0%",
          overflow: "hidden",
        }}
      >
        <Decor
          kind={overrides.decor ?? "none"}
          color={withAlpha("#ffffff", 1)}
          opacity={overrides.decorOpacity ?? 0.12}
          left={Math.round(CW * 0.5)}
          top={mode === "stripe" ? Math.round(-bandH * 0.2) : Math.round(H * 0.1)}
          size={Math.round(W * 0.9)}
        />
      </div>

      <div
        style={{
          position: "absolute",
          left: pad + Math.round(W * (overrides.textOffsetX ?? 0) * (rtl ? -1 : 1)),
          top: Math.round(H * 0.09) + Math.round(W * (overrides.textOffsetY ?? 0)),
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
            marginBottom: Math.round(W * 0.02),
            width: "100%",
          }}
        />
        <TextBlock
          id="headline"
          text={fields.headline}
          fontSize={headlineSize}
          lineHeight={1.08}
          maxLines={3}
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
          style={{ opacity: 0.88, marginTop: Math.round(W * 0.022), width: "100%" }}
        />
      </div>

      <DeviceShell input={input} width={devW} height={devH} left={devLeft} top={devTop} />
    </Artwork>
  );
}

const diagonalBand: TemplateModule<typeof overridesSchema> = { descriptor, overridesSchema, render };
export default diagonalBand;
