import type { ReactElement } from "react";
import type { z } from "zod";
import type { DeviceFamily, Orientation, TargetProfile } from "../lib/targets";
import type { TextDirection } from "../lib/locales";

/** Static description of a template (plan §10.1); used by validation and the UI. */
export interface TemplateDescriptor {
  id: string;
  name: string;
  requiredFields: string[];
  optionalFields: string[];
  families: DeviceFamily[];
  orientations: Orientation[];
  /** Allowed keys in screen.overrides; values validated by `overridesSchema`. */
  overrideKeys: string[];
}

export interface BrandTheme {
  /** Primary family name. */
  fontFamily: string;
  /** Full CSS font-family stack (brand + fallbacks), used by the artwork root. */
  fontStack: string;
  /** Stack for headlines when brand.headlineFont is set; otherwise undefined (inherit fontStack). */
  headlineFontStack?: string;
  primary: string;
  onPrimary: string;
}

/** Everything a template needs to render one artwork. Identical for preview and export. */
export interface TemplateRenderInput<O = Record<string, unknown>> {
  target: TargetProfile;
  /** Artwork width in px: target.width, or slices x target.width for panoramas. Type metrics still follow target.width. */
  canvasWidth: number;
  locale: string;
  direction: TextDirection;
  /** Copy for this screen; null = intentionally empty optional field. */
  fields: Record<string, string | null | undefined>;
  /** URL the page can load: file:// for export, /api/... for the UI. */
  sourceImageUrl: string;
  brand: BrandTheme;
  overrides: O;
  mode: "preview" | "export";
  /** Resolve a store/assets-relative path (e.g. "backgrounds/waves.png") to a URL the page can load. */
  assetUrl: (relPath: string) => string;
}

export interface TemplateModule<S extends z.ZodTypeAny = z.ZodTypeAny> {
  descriptor: TemplateDescriptor;
  overridesSchema: S;
  /** Must return a single root element carrying `data-artwork` sized exactly target.width x target.height. */
  render: (input: TemplateRenderInput<z.infer<S>>) => ReactElement;
}

/** Attribute the in-page checker looks for: text containers that must not overflow. */
export const CHECK_ATTR = "data-check";
export const ARTWORK_ATTR = "data-artwork";
