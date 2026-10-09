import type { ReactElement } from "react";
import {
  accentOf,
  COMMON_OVERRIDE_KEYS,
  commonOverridesSchema,
  LayerElements,
  TextBlock,
  textAlignOf,
  backgroundStyle,
  type CommonOverrides,
} from "./shared";
import { safeAreaOf, showsIphoneCapture } from "../lib/targets";
import { ARTWORK_ATTR } from "./types";
import type { TemplateModule, TemplateRenderInput } from "./types";

/**
 * Google Play feature graphic (1024x500, landscape): headline (+ caption) on
 * the start side, the capture in a rounded card running off the end side.
 * The same banner serves the in-app event card and the App Store creative
 * assets (header, search results, universal); a universal image keeps its
 * text and device inside the part both of its crops show. One screen
 * restricted to the target drives each.
 */
export const overridesSchema = commonOverridesSchema;

export const descriptor = {
  id: "feature-graphic",
  name: "Feature Graphic",
  requiredFields: ["headline"],
  optionalFields: ["caption"],
  families: ["feature-graphic", "event", "creative"] as ("feature-graphic" | "event" | "creative")[],
  orientations: ["landscape"] as "landscape"[],
  overrideKeys: COMMON_OVERRIDE_KEYS,
  fieldBudget: (field: string) => (field === "headline" ? 30 : field === "caption" ? 60 : undefined),
};

export function render(input: TemplateRenderInput<CommonOverrides>): ReactElement {
  const { target, fields, brand, direction } = input;
  // Text and device are laid out in the safe area; the background fills the canvas.
  const box = safeAreaOf(target);
  const W = box.width;
  const H = box.height;
  const pad = Math.round(H * 0.12);
  const align = textAlignOf(input, "start");
  const headlineSize = Math.round(H * 0.16);
  const captionSize = Math.round(H * 0.08);
  // Event and creative media show the app's own capture: a landscape game gets a sideways phone.
  const aspect = showsIphoneCapture(target) ? (input.sourceAspect ?? 1320 / 2868) : 1320 / 2868;
  const wide = aspect > 1;
  const scale = input.overrides.screenshotScale ?? (wide ? 0.6 : 0.34);
  const devW = Math.round(W * scale);
  const devH = Math.round(devW / aspect);
  const short = Math.min(devW, devH);
  const tilt = input.overrides.deviceTilt ?? (wide ? -4 : -8);
  // Offsets are fractions of the canvas width, the unit the editor's drag uses.
  const offX = Math.round(target.width * (input.overrides.screenshotOffsetX ?? 0) * (direction === "rtl" ? -1 : 1));
  const offY = Math.round(target.width * (input.overrides.screenshotOffsetY ?? 0));
  const devLeft =
    box.left +
    (direction === "rtl" ? Math.round(W * (wide ? -0.06 : 0.06)) : Math.round(W * (wide ? 0.46 : 0.62))) +
    offX;
  const devTop = box.top + (wide ? Math.round((H - devH) / 2) : Math.round(H * 0.12)) + offY;

  return (
    <div
      {...{ [ARTWORK_ATTR]: "" }}
      dir={direction}
      style={{
        position: "relative",
        width: input.canvasWidth,
        height: target.height,
        overflow: "hidden",
        ...backgroundStyle(input),
        color: input.overrides.textColor ?? brand.onPrimary,
        fontFamily: brand.fontStack,
        direction,
        boxSizing: "border-box",
      }}
    >
      <div
        style={{
          position: "absolute",
          insetInlineStart: box.left + pad,
          top: box.top,
          height: H,
          // A sideways phone starts at 46% of the width; the text keeps clear of it.
          width: Math.round(W * (wide ? 0.4 : 0.52)),
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          gap: Math.round(H * 0.05),
          alignItems: align === "center" ? "center" : align === "end" ? "flex-end" : "flex-start",
        }}
      >
        <TextBlock
          id="headline"
          text={fields.headline}
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
          id="caption"
          text={fields.caption}
          fontSize={captionSize}
          lineHeight={1.3}
          maxLines={2}
          weight={400}
          align={align}
          fitMinScale={0.8}
          style={{ opacity: accentOf(input) ? 1 : 0.9, color: accentOf(input), width: "100%" }}
        />
      </div>
      <div
        data-device=""
        style={{
          position: "absolute",
          left: devLeft,
          top: devTop,
          width: devW,
          height: devH,
          borderRadius: Math.round(short * 0.11),
          background: "#0b0c0f",
          padding: Math.round(short * 0.018),
          boxSizing: "border-box",
          boxShadow: `0 ${Math.round(short * 0.04)}px ${Math.round(short * 0.1)}px rgba(0,0,0,0.35)`,
          transform: tilt ? `rotate(${tilt}deg)` : undefined,
          transformOrigin: "50% 50%",
        }}
      >
        <div
          style={{
            width: "100%",
            height: "100%",
            borderRadius: Math.round(short * 0.09),
            overflow: "hidden",
            background: "#000",
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={input.sourceImageUrl}
            alt=""
            data-source=""
            style={{
              display: "block",
              width: "100%",
              height: "100%",
              objectFit: "cover",
              objectPosition: "top center",
            }}
          />
        </div>
      </div>
      <LayerElements input={input} />
    </div>
  );
}

const featureGraphic: TemplateModule<typeof overridesSchema> = { descriptor, overridesSchema, render };
export default featureGraphic;
