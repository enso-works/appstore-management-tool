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
 * Strip Story: the set as a numbered sequence. Each slice gets its own headline
 * and caption, a numbered marker sits on a path that runs unbroken across every
 * screenshot, and the devices cascade below it. Copy comes from the per-slice
 * fields (`headline`/`headline2`/`headline3`, same for `caption`), so slice 2
 * and 3 read as their own screen while the artwork stays continuous.
 */
export const overridesSchema = commonOverridesSchema.extend({
  /** The line running across the strip. */
  path: z.enum(["line", "dashed", "none"]).optional(),
  /** Path and marker colour; default the text colour. */
  pathColor: z.string().min(1).optional(),
  /** Where the path sits, fraction of the canvas height. */
  pathY: z.number().min(0.1).max(0.9).optional(),
  /** Numbered markers on the path. */
  markers: z.boolean().optional(),
  /** Extra downward step per slice, fraction of a screen's width. */
  cascade: z.number().min(-0.2).max(0.2).optional(),
});

type Overrides = z.infer<typeof overridesSchema>;

export const descriptor = {
  id: "strip-story",
  name: "Strip Story",
  summary: "Full strip: a numbered path running unbroken across the set, devices cascading below it.",
  requiredFields: ["headline"],
  optionalFields: ["eyebrow", "caption", "headline2", "caption2", "headline3", "caption3"],
  families: ["iphone", "ipad", "phone"] as ("iphone" | "ipad" | "phone")[],
  orientations: ["portrait"] as "portrait"[],
  strip: true,
  overrideKeys: [...COMMON_OVERRIDE_KEYS, "path", "pathColor", "pathY", "markers", "cascade"],
  fieldBudget: (field: string, target: { width: number; family: string }) => {
    const W = target.width;
    const k = target.family === "ipad" ? 0.78 : 1;
    const usable = W - 2 * Math.round(W * 0.09);
    if (field.startsWith("headline")) return Math.floor((usable / (Math.round(W * 0.062 * k) * 0.52)) * 2);
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
  const pad = Math.round(W * 0.09);
  const textColor = overrides.textColor ?? brand.onPrimary;
  const pathColor = overrides.pathColor ?? textColor;

  const eyebrowSize = Math.round(W * 0.03 * k);
  const headlineSize = Math.round(W * 0.062 * k);
  const captionSize = Math.round(W * 0.034 * k);

  const eyebrowTop = Math.round(H * 0.05);
  const eyebrowH = fields.eyebrow ? Math.round(eyebrowSize * 1.3) + Math.round(W * 0.02) : 0;
  const textTop = eyebrowTop + eyebrowH + Math.round(W * (overrides.textOffsetY ?? 0));
  const headlineH = Math.round(headlineSize * 1.1 * 2);
  const captionH = Math.round(captionSize * 1.35 * 2) + Math.round(W * 0.018);

  const pathStyle = overrides.path ?? "line";
  const pathY = Math.round(H * (overrides.pathY ?? 0.26));
  const stroke = Math.max(2, Math.round(W * 0.004));
  const markerSize = Math.round(W * 0.085);
  const showMarkers = overrides.markers !== false;

  const devW = Math.round(W * (overrides.screenshotScale ?? 0.6));
  const devAspect = target.family === "ipad" || target.family === "tablet" ? W / H : 1320 / 2868;
  const devH = Math.round(devW / devAspect);
  const cascade = Math.round(W * (overrides.cascade ?? 0.035));
  const devTop = pathY + Math.round(W * 0.09) + Math.round(W * (overrides.screenshotOffsetY ?? 0));

  return (
    <Artwork input={input}>
      {pathStyle === "none" ? null : (
        <div
          aria-hidden
          data-path=""
          style={{
            position: "absolute",
            left: 0,
            top: pathY,
            width: CW,
            height: stroke,
            opacity: 0.4,
            // A dashed rule is a repeating gradient, so it stays crisp at any width.
            background:
              pathStyle === "dashed"
                ? `repeating-linear-gradient(90deg, ${pathColor} 0 ${Math.round(W * 0.03)}px, transparent ${Math.round(W * 0.03)}px ${Math.round(W * 0.055)}px)`
                : pathColor,
          }}
        />
      )}

      {Array.from({ length: slices }, (_, i) => {
        const headline = fields[sliceField("headline", i)];
        const caption = fields[sliceField("caption", i)];
        const cx = i * W + Math.round(W / 2);
        const step = i * cascade;
        const left =
          i * W + Math.round((W - devW) / 2) + Math.round(W * (overrides.screenshotOffsetX ?? 0) * (rtl ? -1 : 1));
        return (
          <div key={i}>
            {headline || caption ? (
              <div
                data-text-stack={i}
                style={{
                  position: "absolute",
                  left: i * W + pad + Math.round(W * (overrides.textOffsetX ?? 0) * (rtl ? -1 : 1)),
                  top: textTop,
                  width: W - 2 * pad,
                  height: headlineH + captionH,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: align === "center" ? "center" : align === "end" ? "flex-end" : "flex-start",
                }}
              >
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
                  style={{ opacity: 0.85, marginTop: Math.round(W * 0.018), width: "100%" }}
                />
              </div>
            ) : null}

            {showMarkers ? (
              <div
                aria-hidden
                data-marker={i}
                style={{
                  position: "absolute",
                  left: cx - Math.round(markerSize / 2),
                  top: pathY - Math.round(markerSize / 2) + Math.round(stroke / 2),
                  width: markerSize,
                  height: markerSize,
                  borderRadius: "50%",
                  border: `${stroke}px solid ${pathColor}`,
                  background: withAlpha(pathColor, 0.16),
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: Math.round(markerSize * 0.42),
                  fontWeight: 700,
                  lineHeight: 1,
                  color: pathColor,
                }}
              >
                {String(i + 1).padStart(2, "0")}
              </div>
            ) : null}

            <DeviceShell
              input={input}
              width={devW}
              height={devH}
              left={left}
              top={devTop + step}
              imageUrl={sliceImage(input, i)}
            />
          </div>
        );
      })}

      {fields.eyebrow ? (
        <div style={{ position: "absolute", left: pad, top: eyebrowTop, width: W - 2 * pad }}>
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
              width: "100%",
            }}
          />
        </div>
      ) : null}
    </Artwork>
  );
}

const stripStory: TemplateModule<typeof overridesSchema> = { descriptor, overridesSchema, render };
export default stripStory;
