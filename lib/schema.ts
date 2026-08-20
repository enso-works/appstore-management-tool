import { z } from "zod";
import { targetIds } from "./targets";

/**
 * Zod schemas for every file the tool reads or writes (plan §8).
 * JSON Schemas under ../schema/*.schema.json are generated from these by
 * `npm run schemas`; the `$schema` fields in app files point at them.
 */

const localeCode = z.string().regex(/^[a-z]{2,3}(-[A-Za-z]{2,4})?$/, "locale must look like en-US, de-DE, da, zh-Hans");

const relativePath = z
  .string()
  .min(1)
  .refine((p) => !p.startsWith("/") && !/^[A-Za-z]:[\\/]/.test(p), "path must be relative to the app root")
  .refine((p) => !p.split(/[\\/]/).includes(".."), "path must not contain '..'");

/** A file or folder name fragment that cannot climb out of its directory. */
const safePathFragment = z
  .string()
  .min(1)
  .refine((p) => !p.startsWith("/") && !/^[A-Za-z]:[\\/]/.test(p), "must be relative")
  .refine(
    (p) => !p.split(/[\\/]/).some((seg) => seg === ".." || seg === ""),
    "must not contain '..' or empty segments",
  );

const hexColor = z.string().regex(/^#([0-9a-fA-F]{6}|[0-9a-fA-F]{8}|[0-9a-fA-F]{3})$/, "hex color");

export const METADATA_FIELDS = [
  "name",
  "subtitle",
  "keywords",
  "promotional_text",
  "description",
  "release_notes",
  "support_url",
  "marketing_url",
  "privacy_url",
] as const;
export type MetadataField = (typeof METADATA_FIELDS)[number];

/** "asset:<path under store/assets>", "pattern:<kind>", or "none" (cancels an inherited texture). */
export const BACKGROUND_IMAGE_RE =
  /^(asset:[^\s]+|pattern:(waves|dots|grid|lines|zigzag|rings|crosses|checker|noise)|none)$/;

/** Background values shared by the project default (brand.background) and per-screen overrides. */
export const backgroundValuesSchema = z.strictObject({
  background: z.string().min(1).optional(),
  backgroundImage: z.string().regex(BACKGROUND_IMAGE_RE, 'use "asset:<path>", "pattern:<kind>" or "none"').optional(),
  patternColor: z.string().min(1).optional(),
  patternScale: z.number().min(0.25).max(4).optional(),
});

export type BackgroundValues = z.infer<typeof backgroundValuesSchema>;

export const fontConfigSchema = z.strictObject({
  family: z.string().min(1).default("Inter"),
  source: z.enum(["google", "local"]).default("google"),
  weights: z.array(z.number().int().min(100).max(900)).min(1).default([400, 600, 700]),
  /** Extra families tried after `family`, in order (must be local: `fonts add`). Bundled fallbacks are appended automatically. */
  fallbacks: z.array(z.string().min(1)).default([]),
});

export const projectConfigSchema = z.strictObject({
  $schema: z.string().optional(),
  projectName: z.string().min(1),
  bundleId: z.string().min(1).optional(),
  defaultLocale: localeCode,
  locales: z.array(localeCode).min(1),
  paths: z
    .strictObject({
      manifest: relativePath.default("store/manifest.json"),
      content: relativePath.default("store/content"),
      raw: relativePath.default("store/raw"),
      assets: relativePath.default("store/assets"),
      outputScreenshots: relativePath.default("fastlane/screenshots"),
      /** Google Play (`supply`) metadata root; screenshots go under <locale>/images/phoneScreenshots/. */
      outputPlay: relativePath.default("fastlane/metadata/android"),
      metadata: relativePath.default("fastlane/metadata"),
      generated: relativePath.default("store/generated"),
    })
    .prefault({}),
  targets: z.array(z.enum(targetIds as [string, ...string[]])).min(1),
  /** target id -> raw capture device folder name under paths.raw */
  sourceDevices: z.record(z.string(), safePathFragment).prefault({}),
  brand: z
    .strictObject({
      font: fontConfigSchema.prefault({}),
      /** Optional display face for headlines (e.g. a serif); body copy keeps `font`. */
      headlineFont: fontConfigSchema.optional(),
      /** Project-wide default background; screens inherit it unless they override (backgroundImage "none" opts out of a texture). */
      background: backgroundValuesSchema.optional(),
      primary: hexColor.default("#111111"),
      onPrimary: hexColor.default("#FFFFFF"),
    })
    .prefault({}),
  output: z
    .strictObject({
      // JPEG output (Apple accepts it) needs a JPEG header reader for readiness; add with Phase 2 if wanted.
      format: z.enum(["png"]).default("png"),
      backgroundColor: hexColor.default("#FFFFFF"),
      cleanBeforeRender: z.boolean().default(true),
    })
    .prefault({}),
  validation: z
    .strictObject({
      strictTranslations: z.boolean().default(true),
      failOnOverflow: z.boolean().default(true),
      failOnAlpha: z.boolean().default(true),
      /** Text overlapping the device shell is a warning by default (designers do it on purpose); true makes it an error. */
      failOnTextOverlap: z.boolean().default(false),
      screensPerTarget: z
        .strictObject({
          min: z.number().int().min(1).max(10).default(3),
          max: z.number().int().min(1).max(10).default(10),
        })
        .prefault({}),
    })
    .prefault({}),
  metadata: z
    .strictObject({
      manage: z.boolean().default(true),
      fields: z.array(z.enum(METADATA_FIELDS)).default([...METADATA_FIELDS]),
    })
    .prefault({}),
  /** Named override presets applied to screens from the editor ("apply preset"). */
  presets: z.record(z.string().min(1), z.record(z.string(), z.unknown())).prefault({}),
  fastlane: z
    .strictObject({
      enabled: z.boolean().default(true),
      lanes: z
        .strictObject({
          validate: z.string().default("ios validate_metadata"),
          metadata: z.string().default("ios metadata"),
          screenshots: z.string().default("ios screenshots"),
        })
        .prefault({}),
    })
    .prefault({}),
});

export type ProjectConfig = z.infer<typeof projectConfigSchema>;
export type ProjectConfigInput = z.input<typeof projectConfigSchema>;

const screenId = z.string().regex(/^[a-z0-9][a-z0-9-]*$/, "screen id: lowercase letters, digits, dashes");

/** Extra freely-positioned elements on a screen (asset library images, badges, extra text). */
export const layerSchema = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("image"),
    /** Unique per screen; also the drag/selection handle name. */
    id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
    /** Path under store/assets, e.g. "logos/badge.png". */
    asset: safePathFragment,
    /** Centre position as fractions of the target width (y > 1 is below the first square). */
    x: z.number().min(-0.5).max(3.5),
    y: z.number().min(-0.5).max(3.5),
    /** Width as a fraction of the target width; height follows the image aspect. */
    width: z.number().min(0.02).max(2).default(0.3),
    rotate: z.number().min(-180).max(180).optional(),
    opacity: z.number().min(0.05).max(1).optional(),
  }),
  z.strictObject({
    type: z.literal("text"),
    id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
    x: z.number().min(-0.5).max(3.5),
    y: z.number().min(-0.5).max(3.5),
    width: z.number().min(0.05).max(2).default(0.5),
    /** Font size as a fraction of the target width. */
    size: z.number().min(0.01).max(0.3).default(0.045),
    weight: z.number().int().min(100).max(900).default(600),
    color: z.string().min(1).optional(),
    align: z.enum(["start", "center", "end"]).default("center"),
    /** "headline" uses brand.headlineFont when configured. */
    font: z.enum(["body", "headline"]).default("body"),
    rotate: z.number().min(-180).max(180).optional(),
    opacity: z.number().min(0.05).max(1).optional(),
  }),
]);

export type Layer = z.infer<typeof layerSchema>;

export const screenSchema = z.strictObject({
  id: screenId,
  order: z.number().int().min(1),
  enabled: z.boolean().default(true),
  template: z.string().min(1),
  source: z
    .strictObject({
      /** Interpolates {order} {id} {locale} {device} {target}. Relative to raw/<device>/<locale>/. */
      filePattern: safePathFragment.default("{order}-{id}.png"),
      /** false: use the default-locale capture for every locale. */
      localized: z.boolean().default(true),
      /** Deep link the capture helper opens before screenshotting (capture --all), e.g. "braele://session/478". */
      deepLink: z.string().min(1).optional(),
    })
    .prefault({}),
  /** Only for targets listed here; default: all configured targets. */
  targets: z.array(z.string()).optional(),
  /**
   * Panorama: render one artwork `slices` screenshots wide and cut it into
   * consecutive files (order, order+1, ...). The following order numbers are
   * reserved for the slices.
   */
  panorama: z.strictObject({ slices: z.number().int().min(2).max(3) }).optional(),
  overrides: z.record(z.string(), z.unknown()).prefault({}),
  /** Extra image/text elements composited over the template. Text layers read content field <layer id>. */
  layers: z.array(layerSchema).prefault([]),
});

export const manifestSchema = z.strictObject({
  $schema: z.string().optional(),
  screens: z.array(screenSchema),
});

export type Manifest = z.infer<typeof manifestSchema>;
export type ScreenDefinition = z.infer<typeof screenSchema>;

const fieldValue = z.union([z.string(), z.null()]);

export const localeContentSchema = z.strictObject({
  $schema: z.string().optional(),
  locale: localeCode,
  direction: z.enum(["ltr", "rtl"]).optional(),
  /** screen id -> field -> text (null = intentionally empty) */
  screens: z.record(screenId, z.record(z.string(), fieldValue)).prefault({}),
});

export type LocaleContent = z.infer<typeof localeContentSchema>;

/** Written next to generated screenshots; cleanup may only delete files listed here. */
export const generatedManifestSchema = z.strictObject({
  version: z.literal(1),
  generatedAt: z.string(),
  appVersion: z.string().optional(),
  files: z.array(
    z.strictObject({
      path: z.string(),
      target: z.string(),
      locale: z.string(),
      screen: z.string(),
      /** Slice index for panorama screens (0-based); absent for single files. */
      slice: z.number().int().min(0).optional(),
      sha256: z.string(),
      inputsSha256: z.string(),
    }),
  ),
});

export type GeneratedManifest = z.infer<typeof generatedManifestSchema>;

export const fontsLockSchema = z.strictObject({
  version: z.literal(1),
  fonts: z.array(
    z.strictObject({
      family: z.string(),
      source: z.enum(["google", "local"]),
      files: z.array(z.strictObject({ path: z.string(), weight: z.number(), style: z.string(), sha256: z.string() })),
      license: z.string().optional(),
    }),
  ),
});

export type FontsLock = z.infer<typeof fontsLockSchema>;

export const allSchemas = {
  project: projectConfigSchema,
  manifest: manifestSchema,
  content: localeContentSchema,
  "generated-manifest": generatedManifestSchema,
  "fonts-lock": fontsLockSchema,
} as const;

export function formatZodError(error: z.ZodError): string[] {
  return error.issues.map((i) => `${i.path.length ? i.path.join(".") + ": " : ""}${i.message}`);
}
