import type { ReactElement } from "react";
import { Artwork, COMMON_OVERRIDE_KEYS, commonOverridesSchema, DeviceShell, TextBlock, textAlignOf } from "./shared";
import type { TemplateModule, TemplateRenderInput } from "./types";

/**
 * Hero Top (plan §10.2): eyebrow + headline (+ caption) at the top, device
 * shell centered below running off the bottom edge. Works for iPhone (0.46)
 * and iPad (0.75) aspect ratios: all metrics scale with canvas width, and the
 * text region has a fixed height so the device always starts at the same
 * relative position.
 */
export const overridesSchema = commonOverridesSchema;

type Overrides = (typeof overridesSchema)["_output"];

export const descriptor = {
  id: "hero-top",
  name: "Hero Top",
  requiredFields: ["headline"],
  optionalFields: ["eyebrow", "caption"],
  families: ["iphone", "ipad"] as ("iphone" | "ipad")[],
  orientations: ["portrait"] as "portrait"[],
  overrideKeys: COMMON_OVERRIDE_KEYS,
};

export function render(input: TemplateRenderInput<Overrides>): ReactElement {
  const { target, fields } = input;
  const W = target.width;
  const isTablet = target.family === "ipad";
  const pad = Math.round(W * 0.07);
  const align = textAlignOf(input, "center");

  // Text metrics (fractions of width). iPad canvases are wider, so type is a bit smaller relative to W.
  const k = isTablet ? 0.78 : 1;
  const eyebrowSize = Math.round(W * 0.03 * k);
  const headlineSize = Math.round(W * 0.082 * k);
  const captionSize = Math.round(W * 0.04 * k);
  const eyebrowH = fields.eyebrow ? Math.round(eyebrowSize * 1.3) + Math.round(W * 0.02) : 0;
  const headlineMaxLines = 3;
  const headlineH = Math.round(headlineSize * 1.08 * headlineMaxLines);
  const captionH = fields.caption ? Math.round(W * 0.02) + Math.round(captionSize * 1.3 * 2) : 0;
  const textTop = Math.round(W * 0.09);
  const textBottom = textTop + eyebrowH + headlineH + captionH;

  // Device: centred, below the text block, running off the bottom.
  const scale = input.overrides.screenshotScale ?? (isTablet ? 0.72 : 0.8);
  const devW = Math.round(W * scale);
  const devH = Math.round(devW / (target.width / target.height));
  const devTop = textBottom + Math.round(W * 0.06) + Math.round(W * (input.overrides.screenshotOffsetY ?? 0));
  const devLeft = Math.round((W - devW) / 2);

  return (
    <Artwork input={input}>
      <div
        style={{
          position: "absolute",
          left: pad,
          right: pad,
          top: textTop,
          height: textBottom - textTop,
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
          style={{ letterSpacing: -Math.round(headlineSize * 0.02) }}
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
          style={{ opacity: 0.88, marginTop: Math.round(W * 0.02) }}
        />
      </div>
      <DeviceShell input={input} width={devW} height={devH} left={devLeft} top={devTop} />
    </Artwork>
  );
}

const heroTop: TemplateModule<typeof overridesSchema> = { descriptor, overridesSchema, render };
export default heroTop;
