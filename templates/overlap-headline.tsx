import type { ReactElement } from "react";
import { z } from "zod";
import {
  Artwork,
  COMMON_OVERRIDE_KEYS,
  commonOverridesSchema,
  DeviceShell,
  isLightColor,
  TextBlock,
  textAlignOf,
  withAlpha,
} from "./shared";
import type { TemplateModule, TemplateRenderInput } from "./types";

/**
 * Overlap Headline: editorial layout where the headline is set far larger than
 * the copy usually allows and the device is placed in front of it, so the type
 * runs behind the phone and off the canvas. The caption sits along the bottom
 * edge. Text over the device is the point here, so the overlap check opts out.
 */
export const overridesSchema = commonOverridesSchema.extend({
  /** Headline size as a fraction of the canvas width. */
  headlineScale: z.number().min(0.06).max(0.3).optional(),
  /** Blend mode of the headline against the background and device. */
  blend: z.enum(["normal", "difference", "overlay", "exclusion", "soft-light"]).optional(),
  /** Where the device sits relative to the headline. */
  devicePlacement: z.enum(["front", "behind"]).optional(),
  /**
   * Scrim over the capture so type set on top of it stays readable (0 = none).
   * Only applies with `devicePlacement: "behind"` — in front the device covers
   * any scrim under it anyway.
   */
  deviceDim: z.number().min(0).max(0.8).optional(),
  /** Vertical start of the headline, fraction of the canvas height. */
  headlineTop: z.number().min(0).max(0.7).optional(),
  /** Caption placement. */
  captionPlacement: z.enum(["bottom", "top"]).optional(),
  /** Soft gradient behind the caption so it stays readable over the capture. */
  captionScrim: z.boolean().optional(),
});

type Overrides = z.infer<typeof overridesSchema>;

export const descriptor = {
  id: "overlap-headline",
  name: "Overlap Headline",
  summary:
    "Editorial: a headline far larger than usual, with the device standing in front of it so the type runs behind.",
  requiredFields: ["headline"],
  optionalFields: ["eyebrow", "caption"],
  families: ["iphone", "ipad", "phone"] as ("iphone" | "ipad" | "phone")[],
  orientations: ["portrait"] as "portrait"[],
  overrideKeys: [
    ...COMMON_OVERRIDE_KEYS,
    "headlineScale",
    "blend",
    "devicePlacement",
    "deviceDim",
    "headlineTop",
    "captionPlacement",
    "captionScrim",
  ],
  fieldBudget: (field: string, target: { width: number; family: string }, overrides: Record<string, unknown>) => {
    const W = target.width;
    const k = target.family === "ipad" ? 0.78 : 1;
    const usable = W - 2 * Math.round(W * 0.07);
    const scale = typeof overrides.headlineScale === "number" ? overrides.headlineScale : 0.155;
    if (field === "headline") return Math.floor((usable / (Math.round(W * scale * k) * 0.5)) * 3);
    if (field === "caption") return Math.floor((usable / (Math.round(W * 0.036 * k) * 0.5)) * 2);
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
  const pad = Math.round(W * 0.07);
  const rtl = direction === "rtl";

  const eyebrowSize = Math.round(W * 0.03 * k);
  const headlineSize = Math.round(W * (overrides.headlineScale ?? 0.155) * k);
  const captionSize = Math.round(W * 0.036 * k);

  const devW = Math.round(W * (overrides.screenshotScale ?? 0.74));
  const devAspect = target.family === "ipad" || target.family === "tablet" ? W / H : 1320 / 2868;
  const devH = Math.round(devW / devAspect);
  const devLeft = Math.round((CW - devW) / 2) + Math.round(W * (overrides.screenshotOffsetX ?? 0) * (rtl ? -1 : 1));
  const devTop = Math.round(H * 0.32) + Math.round(W * (overrides.screenshotOffsetY ?? 0));

  const headlineTop = Math.round(H * (overrides.headlineTop ?? 0.13)) + Math.round(W * (overrides.textOffsetY ?? 0));
  const captionAtTop = overrides.captionPlacement === "top";
  // The caption lies over the capture, which is usually a bright app UI: fade the
  // canvas edge behind it, in the direction the text colour asks for.
  const scrimColor = isLightColor(overrides.textColor ?? brand.onPrimary) ? "#000000" : "#ffffff";
  const scrim = fields.caption && overrides.captionScrim !== false;

  const device = <DeviceShell input={input} width={devW} height={devH} left={devLeft} top={devTop} overlapAllowed />;
  const behind = overrides.devicePlacement === "behind";
  // Type set over a bright app UI needs the capture knocked back. The scrim sits
  // between the device and the headline, which only exists when the device is
  // behind; in front the device paints over it, so it is skipped.
  const dim = behind ? (overrides.deviceDim ?? 0.45) : 0;

  return (
    <Artwork input={input}>
      {behind ? device : null}
      {dim > 0 ? (
        <div aria-hidden style={{ position: "absolute", inset: 0, background: withAlpha(scrimColor, dim) }} />
      ) : null}
      <div
        style={{
          position: "absolute",
          left: pad + Math.round(W * (overrides.textOffsetX ?? 0) * (rtl ? -1 : 1)),
          top: headlineTop,
          width: Math.round((CW - 2 * pad) * (overrides.textWidth ?? 1)),
          display: "flex",
          flexDirection: "column",
          alignItems: align === "center" ? "center" : align === "end" ? "flex-end" : "flex-start",
          mixBlendMode: overrides.blend ?? "normal",
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
            marginBottom: Math.round(W * 0.022),
            width: "100%",
          }}
        />
        <TextBlock
          id="headline"
          text={fields.headline}
          fontSize={headlineSize}
          lineHeight={0.98}
          maxLines={3}
          weight={800}
          align={align}
          fitMinScale={0.65}
          fontFamily={brand.headlineFontStack}
          style={{
            letterSpacing: brand.headlineFontStack ? 0 : -Math.round(headlineSize * 0.035),
            width: "100%",
          }}
        />
      </div>

      {behind ? null : device}

      {scrim ? (
        <div
          aria-hidden
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            [captionAtTop ? "top" : "bottom"]: 0,
            height: Math.round(H * 0.2),
            background: `linear-gradient(${captionAtTop ? "180deg" : "0deg"}, ${withAlpha(scrimColor, 0.62)} 0%, ${withAlpha(scrimColor, 0)} 100%)`,
          }}
        />
      ) : null}

      <div
        style={{
          position: "absolute",
          left: pad,
          right: pad,
          [captionAtTop ? "top" : "bottom"]: Math.round(H * 0.045),
          display: "flex",
          justifyContent: align === "center" ? "center" : align === "end" ? "flex-end" : "flex-start",
        }}
      >
        <TextBlock
          id="caption"
          text={fields.caption}
          fontSize={captionSize}
          lineHeight={1.3}
          maxLines={2}
          weight={500}
          align={align}
          fitMinScale={0.8}
          style={{
            width: "100%",
            opacity: 0.95,
            textShadow: `0 ${Math.round(W * 0.003)}px ${Math.round(W * 0.018)}px ${withAlpha("#000000", 0.35)}`,
          }}
        />
      </div>
    </Artwork>
  );
}

const overlapHeadline: TemplateModule<typeof overridesSchema> = { descriptor, overridesSchema, render };
export default overlapHeadline;
