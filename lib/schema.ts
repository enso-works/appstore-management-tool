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
  /** Any CSS background: a colour, a gradient, several layered. */
  background: z.string().min(1).optional(),
  /** Over the background: "asset:<file in store/assets>", "pattern:<waves, dots, grid, lines, zigzag, rings, crosses, checker or noise>", or "none". */
  backgroundImage: z.string().regex(BACKGROUND_IMAGE_RE, 'use "asset:<path>", "pattern:<kind>" or "none"').optional(),
  /** Line colour of a pattern (any CSS colour; noise ignores it). */
  patternColor: z.string().min(1).optional(),
  /** Size of a pattern's tiles, 0.25 to 4 times the default. */
  patternScale: z.number().min(0.25).max(4).optional(),
  /** Stretch the project-default background across the whole screenshot strip (each screen shows its slice). */
  span: z.boolean().optional(),
});

export type BackgroundValues = z.infer<typeof backgroundValuesSchema>;

export const fontConfigSchema = z.strictObject({
  /** The font family, as Google Fonts names it, or a family added locally. */
  family: z.string().min(1).default("Inter"),
  /** Where `store-shots fonts add` gets it from. */
  source: z.enum(["google", "local"]).default("google"),
  /** The weights downloaded; headlines use the heaviest a headline font lists. */
  weights: z.array(z.number().int().min(100).max(900)).min(1).default([400, 600, 700]),
  /** Extra families tried after `family`, in order (must be local: `fonts add`). Bundled fallbacks are appended automatically. */
  fallbacks: z.array(z.string().min(1)).default([]),
});

/**
 * One step of the app's art pipeline (`store-shots scenes render`): a Blender
 * script run headless, or a Python script for the post-processing.
 */
export const sceneStepSchema = z
  .strictObject({
    /** The step's name, for `scenes render <step>` and `needs`. */
    id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/, "step id: lowercase letters, digits, dashes"),
    /** Run as `blender -b --factory-startup` with this script; its arguments follow `--`. */
    blender: relativePath.optional(),
    /** Run with `python3 -I`; its arguments are the usual sys.argv[1:]. */
    python: relativePath.optional(),
    /** `{root}`, `{work}` and `{assets}` are replaced with absolute paths. */
    args: z.array(z.string()).default([]),
    /** Files or folders that re-run the step when they change (the script's folder always does). */
    inputs: z.array(relativePath).default([]),
    /** Files the step writes; a missing one re-runs it. */
    outputs: z.array(relativePath).default([]),
    /** Earlier steps whose output it reads: when one runs, so does this. Default: every earlier step. */
    needs: z.array(z.string()).optional(),
  })
  .refine((s) => Boolean(s.blender) !== Boolean(s.python), "a step has either `blender` or `python`");

export type SceneStep = z.infer<typeof sceneStepSchema>;

export const projectConfigSchema = z.strictObject({
  $schema: z.string().optional(),
  /** The app's name in the editors and in contact sheets. */
  projectName: z.string().min(1),
  /** The iOS bundle id, for App Store Connect. */
  bundleId: z.string().min(1).optional(),
  /** The language other languages start from, and whose copy and captures fill gaps. */
  defaultLocale: localeCode,
  /** Every App Store language the app's screenshots and listing are made in (e.g. en-US, de-DE). */
  locales: z.array(localeCode).min(1),
  /** Where the tool reads and writes, relative to the app; the defaults suit nearly every app. */
  paths: z
    .strictObject({
      /** The screens and pages. */
      manifest: relativePath.default("store/manifest.json"),
      /** The copy, one file per language. */
      content: relativePath.default("store/content"),
      /** The captures, by device family and language. */
      raw: relativePath.default("store/raw"),
      /** Fonts, logos, backgrounds and layer art. */
      assets: relativePath.default("store/assets"),
      /** Where the App Store screenshots go, for fastlane `deliver`. */
      outputScreenshots: relativePath.default("fastlane/screenshots"),
      /** Google Play (`supply`) metadata root; screenshots go under <locale>/images/phoneScreenshots/. */
      outputPlay: relativePath.default("fastlane/metadata/android"),
      /** The store text, one folder per language, for fastlane `deliver`. */
      metadata: relativePath.default("fastlane/metadata"),
      /** Pages, iPhone Duo, header and search images, events, contact sheets; not committed. */
      generated: relativePath.default("store/generated"),
      /** App Preview videos, <previews>/<locale>/*.mp4|m4v|mov; readiness checks them and `asc push default` uploads them. */
      previews: relativePath.default("store/previews"),
    })
    .prefault({}),
  /** The devices to render for, by id (`iphone-6.9-1320x2868`, `header-3840x1646`, ...). */
  targets: z.array(z.enum(targetIds as [string, ...string[]])).min(1),
  /** target id -> raw capture device folder name under paths.raw */
  sourceDevices: z.record(z.string(), safePathFragment).prefault({}),
  /** The app's look: fonts, colours and the default background. A theme sets these. */
  brand: z
    .strictObject({
      /** The body font. */
      font: fontConfigSchema.prefault({}),
      /** Optional display face for headlines (e.g. a serif); body copy keeps `font`. */
      headlineFont: fontConfigSchema.optional(),
      /** Project-wide default background; screens inherit it unless they override (backgroundImage "none" opts out of a texture). */
      background: backgroundValuesSchema.optional(),
      /** The brand colour: the default background, and Full Bleed Card's card. */
      primary: hexColor.default("#111111"),
      /** The text colour on `primary`. */
      onPrimary: hexColor.default("#FFFFFF"),
      /** Colour for the eyebrow and caption (a sub-line in a second colour); default: the text colour. */
      accent: hexColor.optional(),
    })
    .prefault({}),
  /** How the files are written. */
  output: z
    .strictObject({
      // JPEG output (Apple accepts it) needs a JPEG header reader for readiness; add with Phase 2 if wanted.
      /** The file format; PNG only for now. */
      format: z.enum(["png"]).default("png"),
      /** The colour transparency is flattened onto, since the stores refuse alpha. */
      backgroundColor: hexColor.default("#FFFFFF"),
      /** A full run deletes the files of the last run that are no longer planned. */
      cleanBeforeRender: z.boolean().default(true),
    })
    .prefault({}),
  /** How strict the checks are. */
  validation: z
    .strictObject({
      /** A missing translation is an error (true) or a warning (false). */
      strictTranslations: z.boolean().default(true),
      /** Text that overflows at its smallest allowed size is an error (true) or a warning. */
      failOnOverflow: z.boolean().default(true),
      /** A rendered file with transparency is an error (true) or a warning. */
      failOnAlpha: z.boolean().default(true),
      /** Text overlapping the device shell is a warning by default (designers do it on purpose); true makes it an error. */
      failOnTextOverlap: z.boolean().default(false),
      /** How many screenshots each device and language should have (Apple takes 1 to 10). */
      screensPerTarget: z
        .strictObject({
          /** Fewer is reported. */
          min: z.number().int().min(1).max(10).default(3),
          /** More is reported. */
          max: z.number().int().min(1).max(10).default(10),
        })
        .prefault({}),
    })
    .prefault({}),
  /** The store text in fastlane/metadata. */
  metadata: z
    .strictObject({
      /** The tool edits and checks the store text; false leaves it to you. */
      manage: z.boolean().default(true),
      /** The fields Listing shows and readiness requires. */
      fields: z.array(z.enum(METADATA_FIELDS)).default([...METADATA_FIELDS]),
    })
    .prefault({}),
  /** Named override presets applied to screens from the editor ("apply preset"). */
  presets: z.record(z.string().min(1), z.record(z.string(), z.unknown())).prefault({}),
  /** Automated capture: how to put the simulator into a known state (plan section 7.5). */
  capture: z
    .strictObject({
      /**
       * AsyncStorage entries written into the simulator's app container before
       * each capture run, so screens never show an empty streak or onboarding.
       * Values are stored as JSON; strings are written through unchanged.
       * `{today}` and `{today-N}` in any string resolve to YYYY-MM-DD at run
       * time, which keeps a seeded streak from going stale between runs.
       */
      state: z.record(z.string().min(1), z.unknown()).prefault({}),
      /** Folder under Library/Application Support/<bundleId> that holds AsyncStorage. */
      storageDir: safePathFragment.default("RCTAsyncLocalStorage_V1"),
      /** App Store locale -> iOS AppleLanguages value, when the two differ. */
      appleLanguages: z.record(localeCode, z.string().min(1)).prefault({}),
      /** Seconds to wait after opening a deep link before the screenshot. */
      settleSeconds: z.number().min(0).max(60).default(2),
      /** Seconds to wait for SpringBoard after switching the simulator language. */
      languageSettleSeconds: z.number().min(0).max(120).default(8),
    })
    .prefault({}),
  /** The art pipeline behind store/assets: Blender renders and their post-processing, in order. */
  scenes: z
    .strictObject({
      /** Path to the Blender binary (default: $BLENDER, /Applications/Blender.app, or `blender` on PATH). */
      blender: z.string().min(1).optional(),
      /** The steps, in order. */
      steps: z.array(sceneStepSchema).min(1),
    })
    .optional(),
  /** The app's own fastlane lanes the tool may run. It never runs one that builds or submits. */
  fastlane: z
    .strictObject({
      /** False turns off the lanes and the credentials check. */
      enabled: z.boolean().default(true),
      /** The lane names, as `<platform> <lane>`. */
      lanes: z
        .strictObject({
          /** Checks the store text against the limits. */
          validate: z.string().default("ios validate_metadata"),
          /** Uploads the store text. */
          metadata: z.string().default("ios metadata"),
          /** Uploads the screenshots. */
          screenshots: z.string().default("ios screenshots"),
        })
        .prefault({}),
    })
    .prefault({}),
});

export type ProjectConfig = z.infer<typeof projectConfigSchema>;
export type ProjectConfigInput = z.input<typeof projectConfigSchema>;

const screenId = z.string().regex(/^[a-z0-9][a-z0-9-]*$/, "screen id: lowercase letters, digits, dashes");

/**
 * Only on these targets (default: all). Positions are fractions of the width,
 * so wide and square canvases often need their own copy of a layer.
 */
const layerTargets = z
  .array(z.enum(targetIds as [string, ...string[]]))
  .min(1)
  .optional();

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
    targets: layerTargets,
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
    targets: layerTargets,
  }),
]);

export type Layer = z.infer<typeof layerSchema>;

export const screenSchema = z.strictObject({
  /** The screen's name: lowercase letters, digits and dashes. It names its copy, captures and files. */
  id: screenId,
  /** Its position on the default page, from 1. */
  order: z.number().int().min(1),
  /** On the default page; false keeps it for other pages, or for the header and event pictures. */
  enabled: z.boolean().default(true),
  /** The template id: hero-top, split-caption, full-bleed-card or feature-graphic. */
  template: z.string().min(1),
  /** Where the screen's capture is. */
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
  panorama: z
    .strictObject({
      /** How many screenshots wide: 2 or 3. */
      slices: z.number().int().min(2).max(3),
    })
    .optional(),
  /** The layout and background the inspector sets; see screens[].overrides below. */
  overrides: z.record(z.string(), z.unknown()).prefault({}),
  /** Extra image/text elements composited over the template. Text layers read content field <layer id>. */
  layers: z.array(layerSchema).prefault([]),
  /** What the capture shows. Apple suggests one Dark Mode screenshot when the app supports it; readiness looks for it. */
  appearance: z.enum(["light", "dark"]).optional(),
});

/**
 * A named screenshot set besides the default product page: a custom product
 * page (up to 70 per app) or a product page optimization treatment (up to 3
 * per test). Its screens may be disabled on the default page. Rendered to
 * <generated>/sets/<id>/<locale>/ and uploaded as a draft with `asc push <id>`.
 */
export const screenSetSchema = z.strictObject({
  /** The page's name in the tool: lowercase letters, digits and dashes. */
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/, "set id: lowercase letters, digits, dashes"),
  /** "custom" for a custom product page, "ppo" for an optimization test treatment. */
  kind: z.enum(["custom", "ppo"]),
  /** The page's or treatment's name in App Store Connect, for your reference. */
  name: z.string().min(1).optional(),
  /** Screen ids, in the order the set shows them. */
  screens: z.array(screenId).min(1),
  /** Custom product pages: where the app opens when installed from this page (a URL or the app's own scheme). */
  deepLink: z
    .string()
    .regex(/^[a-z][a-z0-9+.-]*:\/\/\S+$/i, "a URL such as rallo://tour or https://...")
    .optional(),
  /** Optimization treatments: an alternate app icon in the shipped binary (its name in the asset catalog). */
  appIconName: z.string().min(1).optional(),
  /** Optimization treatments: the experiment (test) it belongs to; treatments with one name share it. */
  experiment: z.string().min(1).optional(),
  /**
   * App Store Connect's id for this page or treatment, written when the tool first uploads it.
   * An editor sends "" to unlink it (the page was deleted there, or the test ended).
   */
  ascId: z.string().optional(),
});

export type ScreenSet = z.infer<typeof screenSetSchema>;

export const manifestSchema = z.strictObject({
  $schema: z.string().optional(),
  screens: z.array(screenSchema),
  sets: z.array(screenSetSchema).optional(),
});

export type Manifest = z.infer<typeof manifestSchema>;
export type ScreenDefinition = z.infer<typeof screenSchema>;

const fieldValue = z.union([z.string(), z.null()]);

/** A named set's text in one locale: what differs from the default page. */
export const setContentSchema = z.strictObject({
  /** Shown above the description on this page (custom product pages; 170 characters). */
  promotionalText: z.string().optional(),
  /** Keywords from the app's keyword field that lead search to this page (custom product pages). */
  keywords: z.array(z.string().min(1)).optional(),
  /** screen id -> field -> text, over the default page's copy for that screen. */
  screens: z.record(screenId, z.record(z.string(), fieldValue)).prefault({}),
});

export type SetContent = z.infer<typeof setContentSchema>;

export const localeContentSchema = z.strictObject({
  $schema: z.string().optional(),
  /** The language this file is for, as in the file name. */
  locale: localeCode,
  /** Right to left mirrors the layouts; default: from the language. */
  direction: z.enum(["ltr", "rtl"]).optional(),
  /** screen id -> field -> text (null = intentionally empty) */
  screens: z.record(screenId, z.record(z.string(), fieldValue)).prefault({}),
  /** set id -> that page's or treatment's own text in this locale. */
  sets: z.record(z.string(), setContentSchema).optional(),
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

/** The name `asc push` takes for the app's own product page; no set may use it. */
export const DEFAULT_PAGE = "default";
