import type { ReactElement } from "react";
import {
  Artwork,
  COMMON_OVERRIDE_KEYS,
  commonOverridesSchema,
  DeviceShell,
  stackLayout,
  TextBlock,
  textAlignOf,
  type CommonOverrides,
  type StackLayoutDefaults,
} from "./shared";
import type { TemplateModule, TemplateRenderInput } from "./types";

/**
 * Hero Top (plan §10.2): eyebrow + headline (+ caption) at the top, device
 * centred below running off the bottom edge. With textWidth < 1 the text
 * becomes a side column and the device moves beside it; every positional
 * override (scale, X/Y offset, tilt) applies on top.
 */
export const overridesSchema = commonOverridesSchema;

/**
 * Rough budget: usable text width / average glyph width x max lines. Average
 * glyph width ~= 0.52 em for Inter-like faces at 700, 0.5 at 400. Used only
 * for editor hints, never for validation.
 */
export function stackFieldBudget(
  field: string,
  target: { width: number; family: string },
  overrides: Record<string, unknown>,
  defaults: { textWidth: number },
): number | undefined {
  const W = target.width;
  const k = target.family === "ipad" ? 0.78 : 1;
  const textWidth = typeof overrides.textWidth === "number" ? overrides.textWidth : defaults.textWidth;
  const narrow = textWidth < 0.999;
  const usable = (W - 2 * Math.round(W * 0.07)) * textWidth;
  if (field === "headline") {
    const size = Math.round(W * 0.082 * k * (narrow ? 0.85 : 1));
    return Math.floor((usable / (size * 0.52)) * (narrow ? 4 : 3));
  }
  if (field === "caption") {
    const size = Math.round(W * 0.04 * k);
    return Math.floor((usable / (size * 0.5)) * 3);
  }
  if (field === "eyebrow") {
    const size = Math.round(W * 0.03 * k);
    return Math.floor(usable / (size * 0.62)); // uppercase + letterspacing
  }
  return undefined;
}

export const descriptor = {
  id: "hero-top",
  name: "Hero Top",
  requiredFields: ["headline"],
  optionalFields: ["eyebrow", "caption"],
  families: ["iphone", "ipad", "phone"] as ("iphone" | "ipad" | "phone")[],
  orientations: ["portrait"] as "portrait"[],
  overrideKeys: COMMON_OVERRIDE_KEYS,
  fieldBudget: (field: string, target: { width: number; family: string }, overrides: Record<string, unknown>) =>
    stackFieldBudget(field, target, overrides, { textWidth: 1 }),
};

/** Shared by hero-top and split-caption: the text stack (eyebrow / headline / caption) + device. */
/** Field name for slice i (0-based): headline, headline2, headline3 ... */
export function sliceField(base: string, slice: number): string {
  return slice === 0 ? base : `${base}${slice + 1}`;
}

export function renderTextAndDevice(
  input: TemplateRenderInput<CommonOverrides>,
  defaults: StackLayoutDefaults,
  fallbackAlign: "start" | "center" | "end",
): ReactElement {
  const { target, fields, brand } = input;
  const W = target.width;
  const slices = Math.max(1, Math.round(input.canvasWidth / W));
  const isTablet = target.family === "ipad";
  const align = textAlignOf(input, fallbackAlign);

  // Type metrics scale with canvas width; iPad canvases are wider, so type is a bit smaller relative to W.
  const k = isTablet ? 0.78 : 1;
  const textWidth = input.overrides.textWidth ?? defaults.textWidth;
  const narrow = textWidth < 0.999;
  // Narrow columns get slightly smaller type so a few lines still carry a real sentence.
  const narrowK = narrow ? 0.85 : 1;
  const eyebrowSize = Math.round(W * 0.03 * k);
  const headlineSize = Math.round(W * 0.082 * k * narrowK);
  const captionSize = Math.round(W * 0.04 * k);
  const eyebrowH = fields.eyebrow ? Math.round(eyebrowSize * 1.3) + Math.round(W * 0.02) : 0;
  const headlineMaxLines = narrow ? 4 : 3;
  const headlineH = Math.round(headlineSize * 1.08 * headlineMaxLines);
  const captionH = fields.caption ? Math.round(W * 0.02) + Math.round(captionSize * 1.3 * 3) : 0;
  const textHeight = eyebrowH + headlineH + captionH;

  const layout = stackLayout(input, textHeight, defaults);

  // Panoramas get one text stack per slice (fields headline2, caption2, ...):
  // each slide reads as its own screenshot while the artwork stays continuous.
  // Slide 1 uses textOffsetX/Y; later slides have independent textOffsetX2/Y2 keys.
  const ov = input.overrides as Record<string, unknown>;
  const stacks = Array.from({ length: slices }, (_, i) => {
    const sliceOverrides =
      i === 0
        ? input.overrides
        : {
            ...input.overrides,
            textOffsetX: (ov[`textOffsetX${i + 1}`] as number | undefined) ?? 0,
            textOffsetY: (ov[`textOffsetY${i + 1}`] as number | undefined) ?? 0,
          };
    const sl =
      slices > 1 ? stackLayout({ ...input, canvasWidth: W, overrides: sliceOverrides }, textHeight, defaults) : layout;
    return {
      slice: i,
      left: sl.text.left + i * W,
      top: sl.text.top,
      width: sl.text.width,
      eyebrow: fields[sliceField("eyebrow", i)],
      headline: fields[sliceField("headline", i)],
      caption: fields[sliceField("caption", i)],
    };
  }).filter((st) => st.headline || st.eyebrow || st.caption);

  return (
    <Artwork input={input}>
      {stacks.map((st) => (
        <div
          key={st.slice}
          data-text-stack={st.slice}
          style={{
            position: "absolute",
            left: st.left,
            top: st.top,
            width: st.width,
            height: layout.text.height,
            display: "flex",
            flexDirection: "column",
            justifyContent: "flex-start",
            alignItems: align === "center" ? "center" : align === "end" ? "flex-end" : "flex-start",
          }}
        >
          <TextBlock
            id={sliceField("eyebrow", st.slice)}
            text={st.eyebrow}
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
            id={sliceField("headline", st.slice)}
            text={st.headline}
            fontSize={headlineSize}
            lineHeight={1.08}
            maxLines={headlineMaxLines}
            weight={700}
            align={align}
            fitMinScale={0.7}
            fontFamily={brand.headlineFontStack}
            style={{ letterSpacing: brand.headlineFontStack ? 0 : -Math.round(headlineSize * 0.02), width: "100%" }}
          />
          <TextBlock
            id={sliceField("caption", st.slice)}
            text={st.caption}
            fontSize={captionSize}
            lineHeight={1.3}
            maxLines={3}
            weight={400}
            align={align}
            fitMinScale={0.8}
            style={{ opacity: 0.88, marginTop: Math.round(W * 0.02), width: "100%" }}
          />
        </div>
      ))}
      <DeviceShell
        input={input}
        width={layout.device.width}
        height={layout.device.height}
        left={layout.device.left}
        top={layout.device.top}
      />
    </Artwork>
  );
}

export function render(input: TemplateRenderInput<CommonOverrides>): ReactElement {
  const isTablet = input.target.family === "ipad";
  return renderTextAndDevice(
    input,
    { textWidth: 1, textSide: "start", scale: isTablet ? 0.72 : 0.8, gap: 0.06, sideDeviceLeft: 0.45 },
    "center",
  );
}

const heroTop: TemplateModule<typeof overridesSchema> = { descriptor, overridesSchema, render };
export default heroTop;
