import type { ReactElement } from "react";
import { renderTextAndDevice } from "./hero-top";
import { COMMON_OVERRIDE_KEYS, commonOverridesSchema, type CommonOverrides } from "./shared";
import type { TemplateModule, TemplateRenderInput } from "./types";

/**
 * Split Caption (plan §10.2): a text column on one side (start by default,
 * mirrored for RTL), the device beside it, large and tilted, running off the
 * opposite edge and the bottom — the "hand-made store art" look. Same
 * overrides as hero-top; only the defaults differ.
 */
export const overridesSchema = commonOverridesSchema;

export const descriptor = {
  id: "split-caption",
  name: "Split Caption",
  requiredFields: ["headline"],
  optionalFields: ["eyebrow", "caption"],
  families: ["iphone", "ipad"] as ("iphone" | "ipad")[],
  orientations: ["portrait"] as "portrait"[],
  overrideKeys: COMMON_OVERRIDE_KEYS,
};

export function render(input: TemplateRenderInput<CommonOverrides>): ReactElement {
  const isTablet = input.target.family === "ipad";
  const withDefaults: TemplateRenderInput<CommonOverrides> = {
    ...input,
    overrides: { deviceTilt: -8, ...input.overrides },
  };
  return renderTextAndDevice(
    withDefaults,
    { textWidth: 0.5, textSide: "start", scale: isTablet ? 0.7 : 0.8, gap: 0.06, sideDeviceLeft: 0.4 },
    "start",
  );
}

const splitCaption: TemplateModule<typeof overridesSchema> = { descriptor, overridesSchema, render };
export default splitCaption;
