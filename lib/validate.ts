import { type Project, CONFIG_FILENAME, validateConfigSemantics } from "./config";
import { loadContent, loadManifest } from "./content";
import { IssueList } from "./issues";
import { isAppStoreLocale } from "./locales";
import { displayRelative, fileExists, resolveWithin } from "./paths";
import { readPngInfo } from "./png";
import { buildRenderPlan, type RenderJob } from "./render-plan";
import type { LocaleContent, Manifest } from "./schema";
import { getTarget } from "./targets";
import { getTemplate, templateFields, templateIds } from "./templates/registry";
import { getTemplateModule } from "../templates";
import { formatZodError } from "./schema";
import { requiredFontFamilies, resolveFontStack } from "./fonts";
import { GlyphChecker, suggestFamilyFor } from "./glyphs";

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
  validateContent(project, manifest, content, issues);
  validateGlyphs(project, manifest, content, issues);

  const plan = buildRenderPlan(project, manifest);
  validateSources(project, plan, issues);
  validateCounts(project, plan, issues);

  return { issues, manifest, content, plan };
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
      const prev = orders.get(screen.order);
      if (prev) {
        issues.error(
          "manifest.duplicate-order",
          `Screens "${prev}" and "${screen.id}" both have order ${screen.order}`,
          {
            key,
            file,
          },
        );
      }
      orders.set(screen.order, screen.id);
    }

    const template = getTemplate(screen.template);
    if (!template) {
      issues.error("manifest.unknown-template", `Unknown template "${screen.template}"`, {
        key,
        file,
        hint: `known templates: ${templateIds.join(", ")}`,
      });
    } else {
      for (const targetId of screen.targets ?? project.config.targets) {
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
  const enabled = manifest.screens.filter((s) => s.enabled);

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
      const known = templateFields(template);
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
      const info = readPngInfo(job.sourcePath);
      const expected = job.target.width / job.target.height;
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
    const k = `${job.target.id}/${job.locale}`;
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  for (const targetId of project.config.targets) {
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
  const enabled = manifest.screens.filter((s) => s.enabled);
  for (const [locale, lc] of content) {
    const file = displayRelative(project.root, `${project.paths.content}/${locale}.json`);
    for (const screen of enabled) {
      const fields = lc.screens[screen.id] ?? {};
      for (const [field, value] of Object.entries(fields)) {
        if (typeof value !== "string") continue;
        const miss = checker.missing(value);
        if (miss.length) {
          issues.error(
            "content.glyph-missing",
            `${locale} ${screen.id}.${field} uses characters no local font covers: ${miss.map((c) => `"${c}"`).join(" ")}`,
            {
              key: `${locale}/${screen.id}`,
              file,
              hint: `store-shots fonts add "${suggestFamilyFor(miss[0])}" and add it to brand.font.fallbacks`,
            },
          );
        }
      }
    }
  }
}
