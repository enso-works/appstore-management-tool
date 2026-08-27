import type { CSSProperties, ReactElement } from "react";
import { z } from "zod";
import { Decor, decorSchema, Glow, Halo } from "./decor";
import {
  Artwork,
  COMMON_OVERRIDE_KEYS,
  commonOverridesSchema,
  DeviceShell,
  TextBlock,
  textAlignOf,
  withAlpha,
} from "./shared";
import type { TemplateModule, TemplateRenderInput } from "./types";

/**
 * Spotlight: headline, a row of feature chips, and the device centred in a pool
 * of light. The chips (`chip1`..`chip3`) carry the three things a reviewer
 * scans for, so the headline can stay a single idea instead of a feature list.
 */
export const overridesSchema = commonOverridesSchema.extend({
  /** Chip treatment. */
  chipStyle: z.enum(["glass", "solid", "outline"]).optional(),
  /** Chip colour; glass/solid fill, outline border. Default derives from the text colour. */
  chipColor: z.string().min(1).optional(),
  /** Radial light behind the device. */
  glow: z.boolean().optional(),
  /** Glow colour; default the brand colour lightened by the background. */
  glowColor: z.string().min(1).optional(),
  /** Concentric rings around the device. */
  halo: z.boolean().optional(),
  /** Decorative shape behind the light. */
  decor: decorSchema.optional(),
  decorOpacity: z.number().min(0).max(1).optional(),
});

type Overrides = z.infer<typeof overridesSchema>;

const CHIP_FIELDS = ["chip1", "chip2", "chip3"];

export const descriptor = {
  id: "spotlight",
  name: "Spotlight",
  summary: "The device centred in a pool of light under a row of feature chips.",
  requiredFields: ["headline"],
  optionalFields: ["eyebrow", "caption", ...CHIP_FIELDS],
  families: ["iphone", "ipad", "phone"] as ("iphone" | "ipad" | "phone")[],
  orientations: ["portrait"] as "portrait"[],
  overrideKeys: [
    ...COMMON_OVERRIDE_KEYS,
    "chipStyle",
    "chipColor",
    "glow",
    "glowColor",
    "halo",
    "decor",
    "decorOpacity",
  ],
  fieldBudget: (field: string, target: { width: number; family: string }) => {
    const W = target.width;
    const k = target.family === "ipad" ? 0.78 : 1;
    const usable = W - 2 * Math.round(W * 0.08);
    if (field === "headline") return Math.floor((usable / (Math.round(W * 0.078 * k) * 0.52)) * 2);
    if (field === "caption") return Math.floor((usable / (Math.round(W * 0.036 * k) * 0.5)) * 2);
    if (field === "eyebrow") return Math.floor(usable / (Math.round(W * 0.03 * k) * 0.62));
    // Three chips share one row: a third of the width each, minus the padding.
    if (CHIP_FIELDS.includes(field)) return Math.floor(usable / 3 / (Math.round(W * 0.028 * k) * 0.55));
    return undefined;
  },
};

export function render(input: TemplateRenderInput<Overrides>): ReactElement {
  const { target, fields, brand, overrides, direction } = input;
  const W = target.width;
  const H = target.height;
  const CW = input.canvasWidth;
  const k = target.family === "ipad" ? 0.78 : 1;
  const align = textAlignOf(input, "center");
  const pad = Math.round(W * 0.08);
  const rtl = direction === "rtl";
  const textColor = overrides.textColor ?? brand.onPrimary;

  const eyebrowSize = Math.round(W * 0.03 * k);
  const headlineSize = Math.round(W * 0.078 * k);
  const captionSize = Math.round(W * 0.036 * k);
  const chipSize = Math.round(W * 0.028 * k);

  const chips = CHIP_FIELDS.map((id) => ({ id, text: fields[id] })).filter((c) => c.text);
  const chipStyle = overrides.chipStyle ?? "glass";
  const chipColor = overrides.chipColor ?? textColor;
  const chipPadX = Math.round(W * 0.026);
  const chipPadY = Math.round(W * 0.014);
  const chipBox: CSSProperties =
    chipStyle === "solid"
      ? { background: chipColor, color: brand.primary }
      : chipStyle === "outline"
        ? { border: `${Math.max(2, Math.round(W * 0.0025))}px solid ${withAlpha(chipColor, 0.5)}` }
        : {
            background: withAlpha(chipColor, 0.14),
            border: `${Math.max(1, Math.round(W * 0.0015))}px solid ${withAlpha(chipColor, 0.25)}`,
          };

  // Fixed block heights keep the chips (and therefore the device) at the same Y
  // whatever the copy does, so a long headline can never push them into the phone.
  const textTop = Math.round(H * 0.07) + Math.round(W * (overrides.textOffsetY ?? 0));
  const eyebrowH = fields.eyebrow ? Math.round(eyebrowSize * 1.3) + Math.round(W * 0.018) : 0;
  const headlineH = Math.round(headlineSize * 1.1 * 2);
  const captionH = fields.caption ? Math.round(captionSize * 1.3 * 2) + Math.round(W * 0.018) : 0;
  const chipsTop = textTop + eyebrowH + headlineH + captionH + Math.round(W * 0.035);
  const chipsH = chips.length ? Math.round(chipSize * 1.3) + 2 * chipPadY : 0;

  const devW = Math.round(W * (overrides.screenshotScale ?? 0.72));
  const devAspect = target.family === "ipad" || target.family === "tablet" ? W / H : 1320 / 2868;
  const devH = Math.round(devW / devAspect);
  const devLeft = Math.round((CW - devW) / 2) + Math.round(W * (overrides.screenshotOffsetX ?? 0) * (rtl ? -1 : 1));
  const devTop = chipsTop + chipsH + Math.round(W * 0.07) + Math.round(W * (overrides.screenshotOffsetY ?? 0));

  const glowColor = overrides.glowColor ?? textColor;
  const cx = Math.round(devLeft + devW / 2);
  const cy = Math.round(devTop + devW * 0.45);

  return (
    <Artwork input={input}>
      <Decor
        kind={overrides.decor ?? "none"}
        color={glowColor}
        opacity={overrides.decorOpacity ?? 0.12}
        left={Math.round(cx - W * 0.75)}
        top={Math.round(cy - W * 0.75)}
        size={Math.round(W * 1.5)}
      />
      {overrides.halo ? (
        <>
          <Halo
            color={glowColor}
            cx={cx}
            cy={cy}
            diameter={Math.round(W * 1.02)}
            width={Math.max(2, Math.round(W * 0.0025))}
            opacity={0.28}
          />
          <Halo
            color={glowColor}
            cx={cx}
            cy={cy}
            diameter={Math.round(W * 1.36)}
            width={Math.max(2, Math.round(W * 0.002))}
            opacity={0.18}
          />
        </>
      ) : null}
      {overrides.glow === false ? null : (
        <Glow color={glowColor} cx={cx} cy={cy} spread={Math.round(W * 1.9)} strength={0.38} />
      )}

      <div
        style={{
          position: "absolute",
          left: pad + Math.round(W * (overrides.textOffsetX ?? 0) * (rtl ? -1 : 1)),
          top: textTop,
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
            marginBottom: Math.round(W * 0.018),
            width: "100%",
          }}
        />
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
          style={{ opacity: 0.88, marginTop: Math.round(W * 0.018), width: "100%" }}
        />
      </div>

      {chips.length ? (
        <div
          style={{
            position: "absolute",
            left: pad,
            top: chipsTop,
            width: CW - 2 * pad,
            display: "flex",
            flexWrap: "wrap",
            justifyContent: "center",
            gap: Math.round(W * 0.02),
          }}
        >
          {chips.map((chip) => (
            <div
              key={chip.id}
              style={{
                ...chipBox,
                padding: `${chipPadY}px ${chipPadX}px`,
                borderRadius: 999,
                maxWidth: Math.round((CW - 2 * pad) / 3),
              }}
            >
              <TextBlock
                id={chip.id}
                text={chip.text}
                fontSize={chipSize}
                lineHeight={1.3}
                maxLines={1}
                weight={600}
                align="center"
                fitMinScale={0.75}
                style={{ whiteSpace: "nowrap" }}
              />
            </div>
          ))}
        </div>
      ) : null}

      <DeviceShell input={input} width={devW} height={devH} left={devLeft} top={devTop} />
    </Artwork>
  );
}

const spotlight: TemplateModule<typeof overridesSchema> = { descriptor, overridesSchema, render };
export default spotlight;
