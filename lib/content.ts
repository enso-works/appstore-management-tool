import fs from "node:fs";
import path from "node:path";
import { readJsonFile, type Project } from "./config";
import { IssueList } from "./issues";
import { displayRelative, fileExists } from "./paths";
import { formatZodError, localeContentSchema, manifestSchema, type LocaleContent, type Manifest } from "./schema";
import { directionForLocale } from "./locales";

export interface LoadedManifest {
  manifest?: Manifest;
  issues: IssueList;
}

export function loadManifest(project: Project): LoadedManifest {
  const issues = new IssueList();
  const file = displayRelative(project.root, project.paths.manifest);
  if (!fileExists(project.paths.manifest)) {
    issues.error("manifest.missing", `Manifest not found`, { file, hint: "run `store-shots init` or create it" });
    return { issues };
  }
  let raw: unknown;
  try {
    raw = readJsonFile(project.paths.manifest);
  } catch (err) {
    issues.error("manifest.json", (err as Error).message, { file });
    return { issues };
  }
  const parsed = manifestSchema.safeParse(raw);
  if (!parsed.success) {
    for (const m of formatZodError(parsed.error)) issues.error("manifest.schema", m, { file });
    return { issues };
  }
  const manifest = parsed.data;
  manifest.screens.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  return { manifest, issues };
}

export interface LoadedContent {
  /** locale -> content (only locales that loaded cleanly) */
  byLocale: Map<string, LocaleContent>;
  issues: IssueList;
}

export function contentFileFor(project: Project, locale: string): string {
  return path.join(project.paths.content, `${locale}.json`);
}

export function loadContent(project: Project): LoadedContent {
  const issues = new IssueList();
  const byLocale = new Map<string, LocaleContent>();
  for (const locale of project.config.locales) {
    const abs = contentFileFor(project, locale);
    const file = displayRelative(project.root, abs);
    if (!fileExists(abs)) {
      issues.error("content.missing-locale", `No content file for locale ${locale}`, {
        key: locale,
        file,
        hint: `create ${file} with {"locale":"${locale}","screens":{}}`,
      });
      continue;
    }
    let raw: unknown;
    try {
      raw = readJsonFile(abs);
    } catch (err) {
      issues.error("content.json", (err as Error).message, { key: locale, file });
      continue;
    }
    const parsed = localeContentSchema.safeParse(raw);
    if (!parsed.success) {
      for (const m of formatZodError(parsed.error)) issues.error("content.schema", m, { key: locale, file });
      continue;
    }
    const content = parsed.data;
    if (content.locale !== locale) {
      issues.error("content.locale-mismatch", `File says locale "${content.locale}" but is named ${locale}.json`, {
        key: locale,
        file,
      });
      continue;
    }
    if (!content.direction) content.direction = directionForLocale(locale);
    byLocale.set(locale, content);
  }
  // Extra content files that are not configured locales: informative only.
  if (fs.existsSync(project.paths.content)) {
    for (const f of fs.readdirSync(project.paths.content)) {
      if (!f.endsWith(".json")) continue;
      const locale = f.slice(0, -5);
      if (!project.config.locales.includes(locale)) {
        issues.info("content.unconfigured-locale", `Content file ${f} exists but ${locale} is not in config.locales`, {
          file: displayRelative(project.root, path.join(project.paths.content, f)),
        });
      }
    }
  }
  return { byLocale, issues };
}
