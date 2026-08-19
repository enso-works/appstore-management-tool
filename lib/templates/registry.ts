import type { DeviceFamily, Orientation } from "../targets";

/**
 * Template descriptors (plan §10.1). Phase 1 ships the metadata only so
 * validation can check fields and target support; the React components
 * arrive in Phases 2 and 6.
 */
export interface TemplateDescriptor {
  id: string;
  name: string;
  requiredFields: string[];
  optionalFields: string[];
  families: DeviceFamily[];
  orientations: Orientation[];
  /** Allowed keys in screen.overrides; values validated by each template's Zod schema in Phase 2+. */
  overrideKeys: string[];
}

const COMMON_OVERRIDES = ["background", "screenshotScale", "screenshotOffsetY", "deviceTilt", "textAlign", "shell"];

export const templates: Record<string, TemplateDescriptor> = {
  "hero-top": {
    id: "hero-top",
    name: "Hero Top",
    requiredFields: ["headline"],
    optionalFields: ["eyebrow", "caption"],
    families: ["iphone", "ipad"],
    orientations: ["portrait"],
    overrideKeys: COMMON_OVERRIDES,
  },
  "split-caption": {
    id: "split-caption",
    name: "Split Caption",
    requiredFields: ["headline"],
    optionalFields: ["caption"],
    families: ["iphone", "ipad"],
    orientations: ["portrait"],
    overrideKeys: [...COMMON_OVERRIDES, "textSide"],
  },
  "full-bleed-card": {
    id: "full-bleed-card",
    name: "Full Bleed Card",
    requiredFields: ["headline"],
    optionalFields: ["caption"],
    families: ["iphone", "ipad"],
    orientations: ["portrait"],
    overrideKeys: [...COMMON_OVERRIDES, "cardPosition"],
  },
};

export const templateIds = Object.keys(templates);

export function getTemplate(id: string): TemplateDescriptor | undefined {
  return templates[id];
}

export function templateFields(t: TemplateDescriptor): string[] {
  return [...t.requiredFields, ...t.optionalFields];
}
