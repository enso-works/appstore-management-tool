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
  /**
   * Rough character budget for a field at the given target/overrides: how many
   * characters fit before the in-page fitter starts shrinking. Optional.
   */
  fieldBudget?: (field: string, target: TargetProfile, overrides: Record<string, unknown>) => number | undefined;
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
  /** Project-wide default background (config brand.background); screens inherit unless overridden. */
  backgroundDefaults?: { background?: string; backgroundImage?: string; patternColor?: string; patternScale?: number };
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
  /** Resolved device frame when overrides.shell is "frame:<name>" (URL + screen cut-out geometry). */
  frame?: {
    url: string;
    frameWidth: number;
    frameHeight: number;
    screenX: number;
    screenY: number;
    screenWidth: number;
    /** Screen cut-out corner radius in frame pixels; clips the capture so it stays inside rounded screens. */
    screenRadius?: number;
  };
  /** Extra elements composited over the template (image URLs resolved, text pulled from the locale content). */
  layers?: ResolvedLayer[];
}

export type ResolvedLayer =
  | {
      type: "image";
      id: string;
      url: string;
      x: number;
      y: number;
      width: number;
      rotate?: number;
      opacity?: number;
    }
  | {
      type: "text";
      id: string;
      text: string;
      x: number;
      y: number;
      width: number;
      size: number;
      weight: number;
      color?: string;
      align: "start" | "center" | "end";
      font: "body" | "headline";
      rotate?: number;
      opacity?: number;
    };

export interface TemplateModule<S extends z.ZodTypeAny = z.ZodTypeAny> {
  descriptor: TemplateDescriptor;
  overridesSchema: S;
  /** Must return a single root element carrying `data-artwork` sized exactly target.width x target.height. */
  render: (input: TemplateRenderInput<z.infer<S>>) => ReactElement;
}

/** Attribute the in-page checker looks for: text containers that must not overflow. */
export const CHECK_ATTR = "data-check";
export const ARTWORK_ATTR = "data-artwork";
