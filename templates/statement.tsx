import type { ReactElement } from "react";
import { z } from "zod";
import { Decor, decorSchema } from "./decor";
import { Artwork, COMMON_OVERRIDE_KEYS, commonOverridesSchema, TextBlock, textAlignOf, withAlpha } from "./shared";
import type { TemplateModule, TemplateRenderInput } from "./types";

/**
 * Statement: the typographic interstitial slide — no capture at all. A giant
 * headline, an optional index numeral watermark ("01"), an accent rule and one
 * decorative vector shape. Used between product screenshots to give a store
 * set rhythm, or as the closing "get started" slide.
 *
 * It is the only template with `usesCapture: false`: validate and generate skip
 * the raw-capture requirement for screens using it.
 */
export const overridesSchema = commonOverridesSchema.extend({
  /** Decorative shape drawn behind the copy. */
  decor: decorSchema.optional(),
  /** Colour of the decorative shape and the accent rule; default text colour. */
  accentColor: z.string().min(1).optional(),
  /** Opacity of the decorative shape. */
  decorOpacity: z.number().min(0).max(1).optional(),
  /** Where the shape sits; "cover" fills the canvas, the rest hug a corner. */
  decorPlacement: z.enum(["cover", "top-start", "top-end", "bottom-start", "bottom-end"]).optional(),
  /** Index numeral treatment: hairline outline (default) or filled. */
  indexStyle: z.enum(["outline", "solid"]).optional(),
  /** Hide the short rule above the headline. */
  rule: z.boolean().optional(),
  /** Vertical placement of the copy block. */
  anchor: z.enum(["top", "middle", "bottom"]).optional(),
});

type Overrides = z.infer<typeof overridesSchema>;

export const descriptor = {
  id: "statement",
  name: "Statement",
  summary:
    "A typographic breather between product shots - giant headline, optional index numeral, one vector shape, no capture at all.",
  requiredFields: ["headline"],
  optionalFields: ["eyebrow", "caption", "index"],
  families: ["iphone", "ipad", "phone"] as ("iphone" | "ipad" | "phone")[],
  orientations: ["portrait"] as "portrait"[],
  /** No screenshot: this slide is pure typography. */
  usesCapture: false,
  overrideKeys: [
    ...COMMON_OVERRIDE_KEYS,
    "decor",
    "accentColor",
    "decorOpacity",
    "decorPlacement",
    "indexStyle",
    "rule",
    "anchor",
  ],
  fieldBudget: (field: string, target: { width: number; family: string }) => {
    const W = target.width;
    const k = target.family === "ipad" ? 0.72 : 1;
    const usable = W - 2 * Math.round(W * 0.09);
    if (field === "headline") return Math.floor((usable / (Math.round(W * 0.125 * k) * 0.52)) * 5);
    if (field === "caption") return Math.floor((usable / (Math.round(W * 0.042 * k) * 0.5)) * 4);
    if (field === "eyebrow") return Math.floor(usable / (Math.round(W * 0.032 * k) * 0.62));
    if (field === "index") return 3;
    return undefined;
  },
};

export function render(input: TemplateRenderInput<Overrides>): ReactElement {
  const { target, fields, brand, overrides, direction } = input;
  const W = target.width;
  const H = target.height;
  const CW = input.canvasWidth;
  const k = target.family === "ipad" ? 0.72 : 1;
  const align = textAlignOf(input, "start");
  const pad = Math.round(W * 0.09);
  const textColor = overrides.textColor ?? brand.onPrimary;
  const accent = overrides.accentColor ?? textColor;

  const headlineSize = Math.round(W * 0.125 * k);
  const eyebrowSize = Math.round(W * 0.032 * k);
  const captionSize = Math.round(W * 0.042 * k);
  const indexSize = Math.round(W * 0.42 * k);

  const decorKind = overrides.decor ?? "none";
  const decorSize = Math.round(W * (overrides.decorPlacement === "cover" ? 1.15 : 0.72));
  const placement = overrides.decorPlacement ?? "bottom-end";
  const startIsLeft = direction !== "rtl";
  const hugsLeft = placement.endsWith("start") === startIsLeft;
  const decorLeft =
    placement === "cover"
      ? Math.round((CW - decorSize) / 2)
      : hugsLeft
        ? Math.round(-decorSize * 0.18)
        : Math.round(CW - decorSize * 0.82);
  const decorTop =
    placement === "cover"
      ? Math.round((H - decorSize) / 2)
      : placement.startsWith("top")
        ? Math.round(-decorSize * 0.2)
        : Math.round(H - decorSize * 0.8);

  const anchor = overrides.anchor ?? "middle";
  const offsetY = Math.round(W * (overrides.textOffsetY ?? 0));
  const offsetX = Math.round(W * (overrides.textOffsetX ?? 0) * (direction === "rtl" ? -1 : 1));
  const textWidth = overrides.textWidth ?? 1;

  return (
    <Artwork input={input}>
      <Decor
        kind={decorKind}
        color={accent}
        opacity={overrides.decorOpacity ?? 0.16}
        left={decorLeft}
        top={decorTop}
        size={decorSize}
        rotate={placement.endsWith("start") ? 180 : 0}
      />
      {fields.index ? (
        <div
          aria-hidden
          data-index=""
          style={{
            position: "absolute",
            insetInlineStart: pad - Math.round(indexSize * 0.06),
            top: Math.round(H * 0.06),
            fontSize: indexSize,
            lineHeight: 0.82,
            fontWeight: 800,
            fontFamily: brand.headlineFontStack,
            color: overrides.indexStyle === "solid" ? withAlpha(accent, 0.18) : "transparent",
            WebkitTextStrokeWidth: overrides.indexStyle === "solid" ? 0 : Math.max(2, Math.round(W * 0.004)),
            WebkitTextStrokeColor: withAlpha(accent, 0.35),
            pointerEvents: "none",
          }}
        >
          {fields.index}
        </div>
      ) : null}
      <div
        style={{
          position: "absolute",
          insetInlineStart: pad + offsetX,
          width: Math.round((CW - 2 * pad) * textWidth),
          top: anchor === "top" ? Math.round(H * 0.14) + offsetY : undefined,
          bottom: anchor === "bottom" ? Math.round(H * 0.14) - offsetY : undefined,
          ...(anchor === "middle" ? { top: "50%", transform: `translateY(calc(-50% + ${offsetY}px))` } : {}),
          display: "flex",
          flexDirection: "column",
          alignItems: align === "center" ? "center" : align === "end" ? "flex-end" : "flex-start",
        }}
      >
        {overrides.rule === false ? null : (
          <div
            aria-hidden
            style={{
              width: Math.round(W * 0.16),
              height: Math.max(3, Math.round(W * 0.008)),
              borderRadius: 999,
              background: accent,
              opacity: 0.9,
              marginBottom: Math.round(W * 0.045),
            }}
          />
        )}
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
            opacity: 0.8,
            marginBottom: Math.round(W * 0.03),
            width: "100%",
          }}
        />
        <TextBlock
          id="headline"
          text={fields.headline}
          fontSize={headlineSize}
          lineHeight={1.02}
          maxLines={5}
          weight={800}
          align={align}
          fitMinScale={0.6}
          fontFamily={brand.headlineFontStack}
          style={{
            letterSpacing: brand.headlineFontStack ? 0 : -Math.round(headlineSize * 0.03),
            width: "100%",
          }}
        />
        <TextBlock
          id="caption"
          text={fields.caption}
          fontSize={captionSize}
          lineHeight={1.35}
          maxLines={4}
          weight={400}
          align={align}
          fitMinScale={0.8}
          style={{ opacity: 0.85, marginTop: Math.round(W * 0.04), width: "100%" }}
        />
      </div>
    </Artwork>
  );
}

const statement: TemplateModule<typeof overridesSchema> = { descriptor, overridesSchema, render };
export default statement;
