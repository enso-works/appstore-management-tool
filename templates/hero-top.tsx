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

export const descriptor = {
  id: "hero-top",
  name: "Hero Top",
  requiredFields: ["headline"],
  optionalFields: ["eyebrow", "caption"],
  families: ["iphone", "ipad", "phone"] as ("iphone" | "ipad" | "phone")[],
  orientations: ["portrait"] as "portrait"[],
  overrideKeys: COMMON_OVERRIDE_KEYS,
};

/** Shared by hero-top and split-caption: the text stack (eyebrow / headline / caption) + device. */
export function renderTextAndDevice(
  input: TemplateRenderInput<CommonOverrides>,
  defaults: StackLayoutDefaults,
  fallbackAlign: "start" | "center" | "end",
): ReactElement {
  const { target, fields, brand } = input;
  const W = target.width;
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

  return (
    <Artwork input={input}>
      <div
        style={{
          position: "absolute",
          left: layout.text.left,
          top: layout.text.top,
          width: layout.text.width,
          height: layout.text.height,
          display: "flex",
          flexDirection: "column",
          justifyContent: "flex-start",
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
          maxLines={headlineMaxLines}
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
          maxLines={3}
          weight={400}
          align={align}
          fitMinScale={0.8}
          style={{ opacity: 0.88, marginTop: Math.round(W * 0.02), width: "100%" }}
        />
      </div>
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
