import type { ReactElement } from "react";
import { z } from "zod";
import { Artwork, COMMON_OVERRIDE_KEYS, commonOverridesSchema, TextBlock, textAlignOf, withAlpha } from "./shared";
import type { TemplateModule, TemplateRenderInput } from "./types";

/**
 * Zoom Detail: instead of the whole screen, one part of it. The capture is
 * scaled up and cropped around a focus point into a floating card (or circle),
 * optionally over a blurred copy of the same capture with a locator ring on the
 * area that was magnified. Use it for the one interaction a screen is about —
 * a row, a chart, a control — which is illegible at full-screen scale.
 */
export const overridesSchema = commonOverridesSchema.extend({
  /** Magnification of the capture inside the card (1 = full app width, cropped to a slice). */
  zoom: z.number().min(1).max(6).optional(),
  /** Focus point in the capture, 0..1 from its top-left; the card centres on it. */
  focusX: z.number().min(0).max(1).optional(),
  focusY: z.number().min(0).max(1).optional(),
  /** Card shape. */
  detailShape: z.enum(["card", "circle"]).optional(),
  /** Card width / height. Ignored for "circle". */
  detailAspect: z.number().min(0.4).max(2.5).optional(),
  /** What fills the canvas behind the card. */
  backdrop: z.enum(["blur", "dim", "none"]).optional(),
  /** Ring on the backdrop marking the magnified area (needs a backdrop). */
  locator: z.boolean().optional(),
  /** Card border colour; default a translucent white hairline. */
  detailBorderColor: z.string().min(1).optional(),
});

type Overrides = z.infer<typeof overridesSchema>;

export const descriptor = {
  id: "zoom-detail",
  name: "Zoom Detail",
  summary:
    "One part of a screen instead of the whole thing: a cropped or magnified slice in a floating card, over a blurred copy of itself.",
  requiredFields: ["headline"],
  optionalFields: ["eyebrow", "caption"],
  families: ["iphone", "ipad", "phone"] as ("iphone" | "ipad" | "phone")[],
  orientations: ["portrait"] as "portrait"[],
  overrideKeys: [
    ...COMMON_OVERRIDE_KEYS,
    "zoom",
    "focusX",
    "focusY",
    "detailShape",
    "detailAspect",
    "backdrop",
    "locator",
    "detailBorderColor",
  ],
  fieldBudget: (field: string, target: { width: number; family: string }) => {
    const W = target.width;
    const k = target.family === "ipad" ? 0.78 : 1;
    const usable = W - 2 * Math.round(W * 0.08);
    if (field === "headline") return Math.floor((usable / (Math.round(W * 0.075 * k) * 0.52)) * 3);
    if (field === "caption") return Math.floor((usable / (Math.round(W * 0.038 * k) * 0.5)) * 3);
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
  const headlineSize = Math.round(W * 0.075 * k);
  const captionSize = Math.round(W * 0.038 * k);

  const shape = overrides.detailShape ?? "card";
  const aspect = shape === "circle" ? 1 : (overrides.detailAspect ?? 1.25);
  const cardW = Math.round(W * (overrides.screenshotScale ?? 0.88));
  const cardH = Math.round(cardW / aspect);
  // 1 keeps the app's full width and crops a horizontal slice — never through a
  // word. Higher values magnify around the focus point.
  const zoom = overrides.zoom ?? 1;
  const focusX = overrides.focusX ?? 0.5;
  const focusY = overrides.focusY ?? 0.32;

  const textTop = Math.round(H * 0.08) + Math.round(W * (overrides.textOffsetY ?? 0));
  const textLeft = pad + Math.round(W * (overrides.textOffsetX ?? 0) * (rtl ? -1 : 1));
  const textW = Math.round((CW - 2 * pad) * (overrides.textWidth ?? 1));

  const cardLeft = Math.round((CW - cardW) / 2) + Math.round(W * (overrides.screenshotOffsetX ?? 0) * (rtl ? -1 : 1));
  // Centred in the space under the copy, so short (wide) and tall cards both sit right.
  const cardTop = Math.round(H * 0.35 + (H * 0.65 - cardH) / 2) + Math.round(W * (overrides.screenshotOffsetY ?? 0));
  const tilt = overrides.deviceTilt ?? 0;
  const radius = shape === "circle" ? cardH : Math.round(cardW * 0.075);

  // The capture inside the card: scaled to `zoom` x the card width, then shifted
  // so the focus point lands in the middle of the card.
  const imgW = Math.round(cardW * zoom);
  const imgH = Math.round(imgW * (H / W));
  const imgLeft = Math.round(cardW / 2 - focusX * imgW);
  const imgTop = Math.round(cardH / 2 - focusY * imgH);

  const backdrop = overrides.backdrop ?? "blur";
  const border = overrides.detailBorderColor ?? withAlpha("#ffffff", 0.35);

  // Backdrop: a copy of the capture, blown up a little when blurred so the blur
  // has no soft edge. The locator is measured against that same box, so the ring
  // always frames exactly what the card shows.
  const inflate = backdrop === "blur" ? 1.12 : 1;
  const backW = Math.round(CW * inflate);
  const backH = Math.round(backW * (H / W));
  const backLeft = Math.round((CW - backW) / 2);
  const backTop = Math.round((H - backH) / 2);
  const locator = overrides.locator ?? false;
  const locatorW = Math.round(backW / zoom);
  const locatorH = Math.round(locatorW / aspect);

  return (
    <Artwork input={input}>
      {backdrop === "none" ? null : (
        <div aria-hidden style={{ position: "absolute", left: 0, top: 0, width: CW, height: H, overflow: "hidden" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={input.sourceImageUrl}
            alt=""
            style={{
              position: "absolute",
              left: backLeft,
              top: backTop,
              width: backW,
              height: backH,
              objectFit: "cover",
              filter: backdrop === "blur" ? `blur(${Math.round(W * 0.03)}px) saturate(1.1)` : undefined,
              opacity: 0.6,
            }}
          />
          <div
            style={{
              position: "absolute",
              inset: 0,
              background: `linear-gradient(180deg, ${withAlpha("#000000", 0.45)} 0%, ${withAlpha("#000000", 0.2)} 45%, ${withAlpha("#000000", 0.6)} 100%)`,
            }}
          />
          {locator ? (
            <div
              style={{
                position: "absolute",
                left: Math.round(backLeft + focusX * backW - locatorW / 2),
                top: Math.round(backTop + focusY * backH - locatorH / 2),
                width: locatorW,
                height: locatorH,
                borderRadius: shape === "circle" ? "50%" : Math.round(Math.min(locatorW, locatorH) * 0.12),
                border: `${Math.max(2, Math.round(W * 0.005))}px solid ${border}`,
                boxShadow: `0 0 0 ${Math.round(W * 0.6)}px ${withAlpha("#000000", 0.28)}`,
              }}
            />
          ) : null}
        </div>
      )}

      <div
        data-device=""
        style={{
          position: "absolute",
          left: cardLeft,
          top: cardTop,
          width: cardW,
          height: cardH,
          borderRadius: radius,
          overflow: "hidden",
          background: "#000",
          border: `${Math.max(1, Math.round(W * 0.003))}px solid ${border}`,
          boxShadow: `0 ${Math.round(W * 0.03)}px ${Math.round(W * 0.09)}px ${withAlpha("#000000", 0.45)}`,
          transform: tilt ? `rotate(${tilt}deg)` : undefined,
          transformOrigin: "50% 50%",
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={input.sourceImageUrl}
          alt=""
          data-source=""
          style={{ position: "absolute", left: imgLeft, top: imgTop, width: imgW, height: imgH, maxWidth: "none" }}
        />
      </div>

      <div
        style={{
          position: "absolute",
          left: textLeft,
          top: textTop,
          width: textW,
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
          lineHeight={1.1}
          maxLines={3}
          weight={700}
          align={align}
          fitMinScale={0.7}
          fontFamily={brand.headlineFontStack}
          style={{
            letterSpacing: brand.headlineFontStack ? 0 : -Math.round(headlineSize * 0.02),
            width: "100%",
            textShadow:
              backdrop === "none"
                ? undefined
                : `0 ${Math.round(W * 0.004)}px ${Math.round(W * 0.02)}px rgba(0,0,0,0.45)`,
          }}
        />
        <TextBlock
          id="caption"
          text={fields.caption}
          fontSize={captionSize}
          lineHeight={1.35}
          maxLines={3}
          weight={400}
          align={align}
          fitMinScale={0.8}
          style={{ opacity: 0.9, marginTop: Math.round(W * 0.022), width: "100%" }}
        />
      </div>
    </Artwork>
  );
}

const zoomDetail: TemplateModule<typeof overridesSchema> = { descriptor, overridesSchema, render };
export default zoomDetail;
