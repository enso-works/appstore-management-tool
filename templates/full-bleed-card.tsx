import type { ReactElement } from "react";
import { z } from "zod";
import { Artwork, COMMON_OVERRIDE_KEYS, commonOverridesSchema, TextBlock, textAlignOf, withAlpha } from "./shared";
import type { TemplateModule, TemplateRenderInput } from "./types";

/**
 * Full Bleed Card (plan §10.2): the capture fills the canvas (no shell); the
 * headline sits on a high-contrast card at the top or bottom. Good for visually
 * dense screens where the UI itself is the hero.
 */
export const overridesSchema = commonOverridesSchema.extend({
  cardPosition: z.enum(["top", "bottom"]).optional(),
  /** Card background (any CSS colour); default semi-opaque brand.primary. */
  cardColor: z.string().min(1).optional(),
});

type Overrides = z.infer<typeof overridesSchema>;

export const descriptor = {
  id: "full-bleed-card",
  name: "Full Bleed Card",
  requiredFields: ["headline"],
  optionalFields: ["caption"],
  families: ["iphone", "ipad", "phone"] as ("iphone" | "ipad" | "phone")[],
  orientations: ["portrait"] as "portrait"[],
  overrideKeys: [...COMMON_OVERRIDE_KEYS, "cardPosition", "cardColor"],
};

export function render(input: TemplateRenderInput<Overrides>): ReactElement {
  const { target, fields, brand, overrides } = input;
  const W = target.width;
  const isTablet = target.family === "ipad";
  const k = isTablet ? 0.78 : 1;
  const align = textAlignOf(input, "start");
  const pad = Math.round(W * 0.07);
  const headlineSize = Math.round(W * 0.07 * k);
  const captionSize = Math.round(W * 0.036 * k);
  const position = overrides.cardPosition ?? "bottom";
  const scale = overrides.screenshotScale ?? 1;
  const tilt = overrides.deviceTilt ?? 0;
  const offX = Math.round(W * (overrides.screenshotOffsetX ?? 0));
  const offY = Math.round(W * (overrides.screenshotOffsetY ?? 0));

  return (
    <Artwork input={input}>
      <div
        data-device=""
        data-device-overlap="allowed"
        style={{
          position: "absolute",
          left: offX + Math.round((W - W * scale) / 2),
          top: offY + (scale === 1 ? 0 : Math.round((target.height - target.height * scale) / 2)),
          width: Math.round(W * scale),
          height: Math.round(target.height * scale),
          transform: tilt ? `rotate(${tilt}deg)` : undefined,
          transformOrigin: "50% 50%",
          overflow: "hidden",
          borderRadius: scale < 1 ? Math.round(W * 0.06) : 0,
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={input.sourceImageUrl}
          alt=""
          data-source=""
          style={{ display: "block", width: "100%", height: "100%", objectFit: "cover", objectPosition: "top center" }}
        />
      </div>
      <div
        style={{
          position: "absolute",
          left: pad,
          right: pad,
          [position === "top" ? "top" : "bottom"]: pad,
          padding: Math.round(W * 0.05),
          borderRadius: Math.round(W * 0.04),
          background: overrides.cardColor ?? withAlpha(brand.primary, 0.93),
          boxShadow: `0 ${Math.round(W * 0.02)}px ${Math.round(W * 0.06)}px rgba(0,0,0,0.3)`,
          display: "flex",
          flexDirection: "column",
          gap: Math.round(W * 0.015),
          alignItems: align === "center" ? "center" : align === "end" ? "flex-end" : "flex-start",
        }}
      >
        <TextBlock
          id="headline"
          text={fields.headline}
          fontSize={headlineSize}
          lineHeight={1.1}
          maxLines={3}
          weight={700}
          align={align}
          fitMinScale={0.7}
          fontFamily={brand.headlineFontStack}
          style={{ width: "100%" }}
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
          style={{ opacity: 0.9, width: "100%" }}
        />
      </div>
    </Artwork>
  );
}

const fullBleedCard: TemplateModule<typeof overridesSchema> = { descriptor, overridesSchema, render };
export default fullBleedCard;
