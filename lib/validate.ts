import { type Project, CONFIG_FILENAME, validateConfigSemantics } from "./config";
import { loadContent, loadManifest } from "./content";
import { IssueList } from "./issues";
import { isAppStoreLocale } from "./locales";
import { displayRelative, fileExists, resolveWithin } from "./paths";
import { readImageInfo } from "./image";
import { buildRenderPlan, buildSetPlan, ordersOf, type RenderJob } from "./render-plan";
import type { LocaleContent, Manifest, ScreenDefinition } from "./schema";
import {
  creativePlacementsOf,
  deviceFamilyOf,
  getTarget,
  isOptInTarget,
  isScreenshotSet,
  showsIphoneCapture,
} from "./targets";
import { getTemplate, templateFields, templateIds } from "./templates/registry";
import { getTemplateModule } from "../templates";
import { formatZodError } from "./schema";
import { readMetadataLocale } from "./metadata";
import { requiredFontFamilies, resolveFontStack } from "./fonts";
import { GlyphChecker, suggestFamilyFor } from "./glyphs";
import { frameNameFromShell, framesAvailable, getFrame, resolveShell, shellValues } from "./frames";

export interface ValidationResult {
  issues: IssueList;
  manifest?: Manifest;
  content: Map<string, LocaleContent>;
  plan: RenderJob[];
}

/**
 * Pre-render validation (plan §13.1). Everything that can be checked without
 * a browser: schemas, locales, manifest integrity, template support, copy
 * completeness, source captures, and per-set counts.
 */
export function validateProject(project: Project): ValidationResult {
  const issues = new IssueList();
  const configFile = CONFIG_FILENAME;
  issues.merge(validateConfigSemantics(project.config));

  for (const locale of project.config.locales) {
    if (!isAppStoreLocale(locale)) {
      issues.warn("config.locale-unknown", `Locale "${locale}" is not a known App Store Connect locale code`, {
        key: locale,
        file: configFile,
        hint: "deliver expects codes like en-US, de-DE, da, zh-Hans",
      });
    }
  }

  const { manifest, issues: manifestIssues } = loadManifest(project);
  issues.merge(manifestIssues);
  const { byLocale: content, issues: contentIssues } = loadContent(project);
  issues.merge(contentIssues);

  if (!manifest) return { issues, content, plan: [] };

  validateManifest(project, manifest, issues);
  validateSets(project, manifest, issues);
  validateCreative(project, manifest, issues);
  validateContent(project, manifest, content, issues);
  validateStoreClaims(project, manifest, content, issues);
  validateSetContent(project, manifest, content, issues);
  validateGlyphs(project, manifest, content, issues);

  const plan = buildRenderPlan(project, manifest);
  // Screens only a named set shows need their captures too; set counts are checked in validateSets.
  validateSources(project, [...plan, ...buildSetPlan(project, manifest)], issues);
  validateCounts(project, plan, issues);

  return { issues, manifest, content, plan };
}

/** On the default page, or in a named set: either way its copy and glyphs are checked. */
function isShown(manifest: Manifest, screen: ScreenDefinition): boolean {
  return screen.enabled || (manifest.sets ?? []).some((set) => set.screens.includes(screen.id));
}

function shownScreens(manifest: Manifest): ScreenDefinition[] {
  return manifest.screens.filter((s) => isShown(manifest, s));
}

/** App Store Connect allows 70 custom product pages per app and 3 treatments per optimization test (verified 2026-10-09). */
export const SET_LIMITS = { custom: 70, ppo: 3 } as const;

function validateSets(project: Project, manifest: Manifest, issues: IssueList) {
  const file = displayRelative(project.root, project.paths.manifest);
  const sets = manifest.sets ?? [];
  const ids = new Set<string>();
  for (const set of sets) {
    const key = `sets/${set.id}`;
    if (ids.has(set.id)) issues.error("sets.duplicate-id", `Two sets are called "${set.id}"`, { key, file });
    ids.add(set.id);
    let count = 0;
    for (const id of set.screens) {
      const screen = manifest.screens.find((s) => s.id === id);
      if (!screen) {
        issues.error("sets.unknown-screen", `Set "${set.id}" lists unknown screen "${id}"`, { key, file });
        continue;
      }
      // A screen made only for opt-in targets (a header, say) is not a screenshot.
      if (!screen.targets?.every(isOptInTarget)) count += screen.panorama?.slices ?? 1;
    }
    if (new Set(set.screens).size !== set.screens.length) {
      issues.error("sets.duplicate-screen", `Set "${set.id}" lists a screen twice`, { key, file });
    }
    const { max } = project.config.validation.screensPerTarget;
    if (count > max) {
      issues.error("sets.too-many", `Set "${set.id}" has ${count} screenshots; maximum is ${max}`, { key, file });
    }
    // A treatment tests screenshots, previews and the icon; a custom page has its own link.
    if (set.kind === "ppo" && set.deepLink) {
      issues.error("sets.field-kind", `Treatment "${set.id}" has a deepLink; only custom product pages have one`, {
        key,
        file,
      });
    }
    if (set.kind === "custom" && set.experiment) {
      issues.error(
        "sets.field-kind",
        `Custom product page "${set.id}" names an experiment; only optimization treatments belong to one`,
        { key, file },
      );
    }
    if (set.kind === "custom" && set.appIconName) {
      issues.error(
        "sets.field-kind",
        `Custom product page "${set.id}" has an appIconName; only optimization treatments test icons`,
        { key, file },
      );
    }
  }
  const custom = sets.filter((s) => s.kind === "custom").length;
  if (custom > SET_LIMITS.custom) {
    issues.error(
      "sets.too-many-sets",
      `${custom} custom product pages; App Store Connect allows ${SET_LIMITS.custom} per app`,
      { file },
    );
  }
  // Treatments are counted per experiment: each test takes up to three.
  const byExperiment = new Map<string, number>();
  for (const s of sets.filter((x) => x.kind === "ppo")) {
    const name = s.experiment ?? "store-shots";
    byExperiment.set(name, (byExperiment.get(name) ?? 0) + 1);
  }
  for (const [name, n] of byExperiment) {
    if (n > SET_LIMITS.ppo) {
      issues.error(
        "sets.too-many-sets",
        `${n} treatments in experiment "${name}"; a test has at most ${SET_LIMITS.ppo}`,
        { file },
      );
    }
  }
}

/**
 * A page shows one product page header and one search results asset per
 * locale (App Store Connect's limit, verified 2026-10-09): on the default page
 * from its enabled screens, on a named set from the set's screens. A universal
 * image fills the header and, unless a dedicated search image is there,
 * search results too.
 */
function validateCreative(project: Project, manifest: Manifest, issues: IssueList) {
  const file = displayRelative(project.root, project.paths.manifest);
  const pages = [
    { name: "The default page", key: "creative", screens: manifest.screens.filter((s) => s.enabled) },
    ...(manifest.sets ?? []).map((set) => ({
      name: `"${set.id}"`,
      key: `sets/${set.id}/creative`,
      screens: set.screens
        .map((id) => manifest.screens.find((s) => s.id === id))
        .filter((s): s is ScreenDefinition => !!s),
    })),
  ];
  const configured = new Set(project.config.targets);
  for (const page of pages) {
    const by = { header: [] as string[], search: [] as string[], universal: [] as string[] };
    for (const screen of page.screens) {
      for (const t of screen.targets ?? []) {
        if (!configured.has(t)) continue;
        const placements = creativePlacementsOf(t);
        if (placements.length === 2) by.universal.push(screen.id);
        else if (placements[0]) by[placements[0]].push(screen.id);
      }
    }
    const headers = [...by.header, ...by.universal];
    if (headers.length > 1) {
      issues.error(
        "creative.too-many",
        `${page.name} has ${headers.length} header images (${headers.join(", ")}); a page shows one`,
        { key: page.key, file, hint: "keep one screen with a header or universal target on the page" },
      );
    }
    if (by.search.length > 1) {
      issues.error(
        "creative.too-many",
        `${page.name} has ${by.search.length} search results images (${by.search.join(", ")}); a page shows one`,
        { key: page.key, file },
      );
    }
  }
}

/** App Store Connect's limit for promotional text, on the default page and on custom product pages. */
const PROMOTIONAL_TEXT_LIMIT = 170;

/**
 * Each locale's text for the named sets: promotional text within its limit,
 * keywords only on custom pages and only from the app's own keyword field,
 * screen copy only for screens the set shows.
 */
function validateSetContent(
  project: Project,
  manifest: Manifest,
  content: Map<string, LocaleContent>,
  issues: IssueList,
) {
  const sets = new Map((manifest.sets ?? []).map((s) => [s.id, s]));
  for (const [locale, lc] of content) {
    const file = displayRelative(project.root, `${project.paths.content}/${locale}.json`);
    let appKeywords: Set<string> | undefined;
    for (const [setId, text] of Object.entries(lc.sets ?? {})) {
      const set = sets.get(setId);
      const key = `sets/${setId}`;
      if (!set) {
        issues.warn("sets.content-unknown", `${locale} has text for "${setId}", which is not a set in the manifest`, {
          file,
        });
        continue;
      }
      const promo = text.promotionalText ?? "";
      if (set.kind === "ppo" && (promo || text.keywords?.length)) {
        issues.error(
          "sets.field-kind",
          `Treatment "${setId}" has promotional text or keywords in ${locale}; treatments only change screenshots, previews and the icon`,
          { key, file },
        );
      }
      if ([...promo].length > PROMOTIONAL_TEXT_LIMIT) {
        issues.error(
          "sets.promotional-text",
          `"${setId}" promotional text is ${[...promo].length}/${PROMOTIONAL_TEXT_LIMIT} characters in ${locale}`,
          { key, file },
        );
      }
      if (set.kind === "custom" && text.keywords?.length) {
        appKeywords ??= new Set(
          (readMetadataLocale(project, locale, ["keywords"]).fields[0]?.value ?? "")
            .split(",")
            .map((k) => k.trim().toLowerCase())
            .filter(Boolean),
        );
        const outside = text.keywords.filter((k) => !appKeywords!.has(k.trim().toLowerCase()));
        if (outside.length) {
          issues.warn(
            "sets.keyword-not-in-app",
            `"${setId}" uses ${outside.map((k) => `"${k}"`).join(", ")} in ${locale}, which the app's keywords do not have`,
            { key, file, hint: "a custom page's keywords are picked from the app's keyword field (keywords.txt)" },
          );
        }
      }
      const extra = Object.keys(text.screens).filter((id) => !set.screens.includes(id));
      if (extra.length) {
        issues.warn(
          "sets.content-screen",
          `"${setId}" has ${locale} copy for ${extra.join(", ")}, which it does not show`,
          {
            key,
            file,
          },
        );
      }
    }
  }
}

/**
 * A screen's copy in the default page and in every set that changes it, for
 * checks that read all of it. `key` scopes an issue to the copy it is about:
 * the default page's screen, or the one set.
 */
function copiesOf(
  lc: LocaleContent,
  screenId: string,
  manifest: Manifest,
): { key: string; where: string; fields: Record<string, string | null> }[] {
  // Only copy that renders: sets the manifest has, for screens they show. Leftovers are
  // reported by validateSetContent and must not block anything.
  const shownBy = new Set((manifest.sets ?? []).filter((s) => s.screens.includes(screenId)).map((s) => s.id));
  return [
    { key: `${lc.locale}/${screenId}`, where: "", fields: lc.screens[screenId] ?? {} },
    ...Object.entries(lc.sets ?? {})
      .filter(([id]) => shownBy.has(id))
      .map(([id, s]) => ({
        // One locale's problem blocks that locale's renders of the set, not all of them.
        key: `sets/${id}/${lc.locale}`,
        where: ` (set "${id}")`,
        fields: s.screens[screenId] ?? {},
      })),
  ];
}

function validateManifest(project: Project, manifest: Manifest, issues: IssueList) {
  const file = displayRelative(project.root, project.paths.manifest);
  const ids = new Set<string>();
  const orders = new Map<number, string>();

  if (manifest.screens.length === 0) {
    issues.warn("manifest.empty", "Manifest has no screens", { file });
  }

  for (const screen of manifest.screens) {
    const key = screen.id;
    if (ids.has(screen.id)) {
      issues.error("manifest.duplicate-id", `Duplicate screen id "${screen.id}"`, { key, file });
    }
    ids.add(screen.id);

    if (screen.enabled) {
      for (const o of ordersOf(screen)) {
        const prev = orders.get(o);
        if (prev) {
          issues.error(
            "manifest.duplicate-order",
            `Screens "${prev}" and "${screen.id}" both occupy order ${o}${screen.panorama ? " (panorama slices reserve the following orders)" : ""}`,
            { key, file },
          );
        }
        orders.set(o, screen.id);
      }
    }

    const template = getTemplate(screen.template);
    if (!template) {
      issues.error("manifest.unknown-template", `Unknown template "${screen.template}"`, {
        key,
        file,
        hint: `known templates: ${templateIds.join(", ")}`,
      });
    } else {
      for (const targetId of screen.targets ?? project.config.targets.filter((t) => !isOptInTarget(t))) {
        const target = getTarget(targetId);
        if (!target) {
          issues.error("manifest.unknown-target", `Screen "${screen.id}" lists unknown target "${targetId}"`, {
            key,
            file,
          });
          continue;
        }
        if (!project.config.targets.includes(targetId)) {
          issues.error(
            "manifest.target-not-configured",
            `Screen "${screen.id}" lists target "${targetId}" which is not in config.targets`,
            {
              key,
              file,
            },
          );
          continue;
        }
        if (!template.families.includes(target.family) || !template.orientations.includes(target.orientation)) {
          issues.error(
            "manifest.template-unsupported-target",
            `Template "${template.id}" does not support target "${targetId}" (${target.family}/${target.orientation})`,
            { key, file },
          );
        } else if (
          showsIphoneCapture(target) &&
          target.orientation === "landscape" &&
          template.id !== "feature-graphic"
        ) {
          // The card is landscape but the captures are portrait iPhone ones; only the banner layout fits both.
          issues.error(
            "manifest.template-unsupported-target",
            `Screen "${screen.id}" renders the ${target.displayClass} with "${template.id}"; use the feature-graphic template, which fits a portrait phone into a wide card`,
            { key, file },
          );
        }
        if (
          target.orientation === "landscape" &&
          frameNameFromShell(resolveShell(screen.overrides.shell, deviceFamilyOf(target)))
        ) {
          issues.error(
            "manifest.frame-landscape",
            `Screen "${screen.id}" uses a device frame on landscape target "${targetId}"; frames are portrait only`,
            { key, file, hint: 'use shell "dark", "light" or "none" for landscape sets' },
          );
        }
      }
      const bg = screen.overrides.backgroundImage;
      if (typeof bg === "string" && bg.startsWith("asset:")) {
        const rel = bg.slice("asset:".length);
        let ok = false;
        try {
          ok = fileExists(resolveWithin(project.paths.assets, rel));
        } catch {
          ok = false;
        }
        if (!ok) {
          issues.error(
            "manifest.asset-missing",
            `Screen "${screen.id}" backgroundImage refers to ${project.config.paths.assets}/${rel}, which does not exist`,
            {
              key,
              file,
              hint: "put the image under store/assets/ (e.g. backgrounds/) or use pattern:waves|dots|grid",
            },
          );
        }
      }
      const layerIds = new Set<string>();
      for (const layer of screen.layers ?? []) {
        if (layerIds.has(layer.id)) {
          issues.error("manifest.layer-duplicate", `Screen "${screen.id}" has two layers with id "${layer.id}"`, {
            key,
            file,
          });
        }
        layerIds.add(layer.id);
        for (const t of layer.targets ?? []) {
          if (!project.config.targets.includes(t)) {
            issues.error(
              "manifest.layer-target",
              `Layer "${layer.id}" on screen "${screen.id}" names target "${t}", which is not configured`,
              { key, file, hint: `configured targets: ${project.config.targets.join(", ")}` },
            );
          } else if (screen.targets && !screen.targets.includes(t)) {
            issues.warn(
              "manifest.layer-target-unused",
              `Layer "${layer.id}" names target "${t}", but screen "${screen.id}" does not render for it`,
              { key, file, hint: `the screen's targets: ${screen.targets.join(", ")}` },
            );
          }
        }
        if (layer.type === "image") {
          let ok = false;
          try {
            ok = fileExists(resolveWithin(project.paths.assets, layer.asset));
          } catch {
            ok = false;
          }
          if (!ok) {
            issues.error(
              "manifest.layer-asset-missing",
              `Screen "${screen.id}" layer "${layer.id}" refers to ${project.config.paths.assets}/${layer.asset}, which does not exist`,
              {
                key,
                file,
                hint: "upload it in the editor's layer panel or put the file under store/assets/",
              },
            );
          }
        }
      }
      for (const shellValue of shellValues(screen.overrides.shell)) {
        const frameName = frameNameFromShell(shellValue);
        if (!frameName || getFrame(frameName)) continue;
        issues.error(
          "manifest.frame-missing",
          `Screen "${screen.id}" uses device frame "${frameName}", which is not available locally`,
          {
            key,
            file,
            hint: framesAvailable()
              ? "check the exact name with `store-shots frames list <search>`"
              : "run `store-shots frames setup` to download the official frames (fastlane frameit)",
          },
        );
      }
      const mod = getTemplateModule(template.id);
      const parsedOverrides = mod?.overridesSchema.safeParse(screen.overrides);
      if (parsedOverrides && !parsedOverrides.success) {
        for (const m of formatZodError(parsedOverrides.error)) {
          issues.error("manifest.override-invalid", `Screen "${screen.id}" overrides: ${m}`, {
            key,
            file,
            hint: `allowed: ${template.overrideKeys.join(", ")}`,
          });
        }
      }
    }
  }
}

function validateContent(project: Project, manifest: Manifest, content: Map<string, LocaleContent>, issues: IssueList) {
  const strict = project.config.validation.strictTranslations;
  const defaultLocale = project.config.defaultLocale;
  const enabled = shownScreens(manifest);

  for (const locale of project.config.locales) {
    const lc = content.get(locale);
    if (!lc) continue; // already reported as missing
    const file = displayRelative(project.root, `${project.paths.content}/${locale}.json`);
    const isDefault = locale === defaultLocale;

    for (const screen of enabled) {
      const template = getTemplate(screen.template);
      if (!template) continue;
      const fields = lc.screens[screen.id] ?? {};
      const key = `${locale}/${screen.id}`;

      if (!(screen.id in lc.screens)) {
        issues[strict || isDefault ? "error" : "warn"](
          "content.missing-screen",
          `No copy for screen "${screen.id}" in ${locale}`,
          {
            key,
            file,
            hint: `add screens.${screen.id} with: ${template.requiredFields.join(", ")}`,
          },
        );
        continue;
      }
      for (const f of template.requiredFields) {
        const v = fields[f];
        if (v === undefined || v === null || v.trim() === "") {
          issues[strict || isDefault ? "error" : "warn"](
            "content.missing-field",
            `Missing required field "${f}" for screen "${screen.id}" in ${locale}`,
            {
              key,
              file,
              hint: `set screens.${screen.id}.${f} (required fields cannot be null; null is only for optional fields)`,
            },
          );
        }
      }
      const slices = screen.panorama?.slices ?? 1;
      const known = [
        ...templateFields(template).flatMap((f) =>
          Array.from({ length: slices }, (_, i) => (i === 0 ? f : `${f}${i + 1}`)),
        ),
        ...(screen.layers ?? []).filter((l) => l.type === "text").map((l) => l.id),
      ];
      for (const f of Object.keys(fields)) {
        if (!known.includes(f)) {
          issues[strict ? "error" : "warn"](
            "content.unknown-field",
            `Field "${f}" is not declared by template "${template.id}" (screen "${screen.id}", ${locale})`,
            {
              key,
              file,
              hint: `declared fields: ${known.join(", ")}`,
            },
          );
        }
      }
    }
    for (const id of Object.keys(lc.screens)) {
      if (!manifest.screens.some((s) => s.id === id)) {
        issues.warn("content.unknown-screen", `Content has screen "${id}" which is not in the manifest (${locale})`, {
          key: `${locale}/${id}`,
          file,
        });
      }
    }
  }
}

/**
 * What Apple's asset guidelines (verified 2026-10-08) say screenshots must not
 * show: "specific pricing, discounts, website URLs, copyright symbols", "logos or
 * references to other platforms or marketplaces" and Apple-designated
 * recognitions. Words are matched in English; symbols and URLs in any language.
 */
const STORE_CLAIMS: { pattern: RegExp; what: string }[] = [
  {
    pattern: /[$€£¥₹₩₺₽]\s?\d|\d\s?[$€£¥₹₩₺₽]|\b\d+(?:[.,]\d{1,2})?\s?(?:USD|EUR|GBP|CHF|BAM)\b/u,
    what: "a price",
  },
  { pattern: /\b\d{1,3}\s?%\s?off\b|\bdiscount(?:s|ed)?\b/iu, what: "a discount" },
  {
    pattern: /\bhttps?:\/\/|\bwww\.|\b[\p{L}\p{N}-]+\.(?:com|app|io|net|org|co|dev)\b/iu,
    what: "a website URL",
  },
  { pattern: /©|\(c\)\s?\d{4}/iu, what: "a copyright symbol" },
  {
    pattern: /\b(?:android|google play|play store|galaxy store|appgallery|amazon appstore)\b/iu,
    what: "another platform or marketplace",
  },
  {
    pattern: /\beditor['’]?s choice\b|\b(?:app|game) of the day\b|\bapple design award/iu,
    what: "an Apple recognition",
  },
];

function validateStoreClaims(
  project: Project,
  manifest: Manifest,
  content: Map<string, LocaleContent>,
  issues: IssueList,
) {
  // Apple's guidance: screens that only render for Google Play are not held to it.
  const forAppStore = manifest.screens.filter(
    (s) => isShown(manifest, s) && (s.targets ?? project.config.targets).some((t) => getTarget(t)?.platform === "ios"),
  );
  for (const locale of project.config.locales) {
    const lc = content.get(locale);
    if (!lc) continue;
    const file = displayRelative(project.root, `${project.paths.content}/${locale}.json`);
    for (const screen of forAppStore) {
      for (const copy of copiesOf(lc, screen.id, manifest)) {
        for (const [field, value] of Object.entries(copy.fields)) {
          if (typeof value !== "string") continue;
          for (const { pattern, what } of STORE_CLAIMS) {
            const match = pattern.exec(value);
            if (!match) continue;
            issues.warn(
              "content.store-claims",
              `Screen "${screen.id}" ${field}${copy.where} shows ${what} ("${match[0].trim()}") in ${locale}`,
              {
                key: copy.key,
                file,
                hint: "Apple's screenshot guidelines rule out prices, discounts, URLs, ©, other platforms and Apple recognitions",
              },
            );
          }
        }
      }
    }
  }
}

function validateSources(project: Project, plan: RenderJob[], issues: IssueList) {
  const seen = new Set<string>();
  for (const job of plan) {
    if (seen.has(job.sourcePath)) continue; // one report per file
    seen.add(job.sourcePath);
    const file = displayRelative(project.root, job.sourcePath);
    if (job.sourceError) {
      issues.error("source.escape", job.sourceError, {
        key: job.key,
        file: displayRelative(project.root, project.paths.manifest),
      });
      continue;
    }
    if (!fileExists(job.sourcePath)) {
      issues.error("source.missing", `Raw capture not found`, {
        key: job.key,
        file,
        hint: `capture it with: store-shots capture --device ${job.sourceDevice} --locale ${job.sourceLocale} --screen ${job.screen.id}`,
      });
      continue;
    }
    try {
      const info = readImageInfo(job.sourcePath);
      // Event and creative media use the iPhone captures as they are; compare them with the app's iPhone sets.
      const iphone = project.config.targets.map((t) => getTarget(t)).find((t) => t?.family === "iphone");
      const expected = showsIphoneCapture(job.target)
        ? iphone
          ? iphone.width / iphone.height
          : 1320 / 2868
        : job.target.width / job.target.height;
      const actual = info.width / info.height;
      if (Math.abs(expected - actual) > 0.01) {
        issues.warn(
          "source.aspect",
          `Raw capture is ${info.width}x${info.height} (aspect ${actual.toFixed(3)}) but target ${job.target.id} is ${expected.toFixed(3)}`,
          { key: job.key, file, hint: "capture from a simulator with the target's aspect ratio" },
        );
      }
    } catch (err) {
      issues.error("source.invalid", (err as Error).message, { key: job.key, file });
    }
  }
}

function validateCounts(project: Project, plan: RenderJob[], issues: IssueList) {
  const { min, max } = project.config.validation.screensPerTarget;
  const counts = new Map<string, number>();
  for (const job of plan) {
    if (!isScreenshotSet(job.target)) continue;
    const k = `${job.target.id}/${job.locale}`;
    counts.set(k, (counts.get(k) ?? 0) + job.slices);
  }
  for (const targetId of project.config.targets) {
    if (!isScreenshotSet(targetId)) continue; // posters and event media are not store screenshot sets
    for (const locale of project.config.locales) {
      const k = `${targetId}/${locale}`;
      const n = counts.get(k) ?? 0;
      if (n < min) {
        issues.error("plan.too-few", `${n} screenshot(s) planned for ${k}; minimum is ${min}`, {
          key: k,
          file: displayRelative(project.root, project.paths.manifest),
        });
      } else if (n > max) {
        issues.error("plan.too-many", `${n} screenshots planned for ${k}; maximum is ${max}`, {
          key: k,
          file: displayRelative(project.root, project.paths.manifest),
        });
      }
    }
  }
}

/** Every character of every field must exist in the local font stack (plan §12.3). */
function validateGlyphs(project: Project, manifest: Manifest, content: Map<string, LocaleContent>, issues: IssueList) {
  const { stack, missing } = resolveFontStack(project);
  const required = requiredFontFamilies(project);
  for (const m of missing) {
    const isBrand = required.includes(m);
    issues[isBrand ? "error" : "warn"](
      isBrand ? "font.missing" : "font.fallback-missing",
      `Font "${m}" is not available locally`,
      {
        file: CONFIG_FILENAME,
        hint: `store-shots fonts add "${m}"`,
      },
    );
  }
  if (stack.length === 0) return;
  let checker: GlyphChecker;
  try {
    checker = new GlyphChecker(stack);
  } catch (err) {
    issues.warn("font.unreadable", `Could not read font files for glyph check: ${(err as Error).message}`);
    return;
  }
  const enabled = shownScreens(manifest);
  for (const [locale, lc] of content) {
    const file = displayRelative(project.root, `${project.paths.content}/${locale}.json`);
    for (const screen of enabled) {
      for (const copy of copiesOf(lc, screen.id, manifest)) {
        for (const [field, value] of Object.entries(copy.fields)) {
          if (typeof value !== "string") continue;
          const miss = checker.missing(value);
          if (miss.length) {
            issues.error(
              "content.glyph-missing",
              `${locale} ${screen.id}.${field}${copy.where} uses characters no local font covers: ${miss.map((c) => `"${c}"`).join(" ")}`,
              {
                // A set's own copy blocks only that set's renders.
                key: copy.key,
                file,
                hint: `store-shots fonts add "${suggestFamilyFor(miss[0])}" and add it to brand.font.fallbacks`,
              },
            );
          }
        }
      }
    }
  }
}
