import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { Project } from "./config";
import { resolveWithin } from "./paths";
import { METADATA_FIELDS, type MetadataField } from "./schema";
import { dirExists, fileExists } from "./paths";

/**
 * App Store Connect character limits. Must stay identical to the table in
 * every app's Fastfile `validate_metadata` lane. Apple counts characters
 * (code points), not bytes, which matches Ruby String#length.
 */
export const METADATA_LIMITS: Record<MetadataField, number> = {
  name: 30,
  subtitle: 30,
  keywords: 100,
  promotional_text: 170,
  description: 4000,
  release_notes: 4000,
  marketing_url: 255,
  support_url: 255,
  privacy_url: 255,
};

/** Ruby String#strip: leading/trailing ASCII whitespace and NUL only (not U+FEFF, NBSP, ...). */
export function rubyStrip(text: string): string {
  return text.replace(/^[ \t\n\v\f\r\0]+/, "").replace(/[ \t\n\v\f\r\0]+$/, "");
}

/** Code-point length of the stripped text: what the Fastfile lane's `File.read(path).strip.length` computes. */
export function metadataLength(text: string): number {
  return Array.from(rubyStrip(text)).length;
}

export interface MetadataFieldState {
  field: MetadataField;
  present: boolean;
  value: string;
  length: number;
  limit: number;
  overLimit: boolean;
}

export interface MetadataLocaleState {
  locale: string;
  dirExists: boolean;
  fields: MetadataFieldState[];
}

export function metadataDir(project: Project, locale: string): string {
  return path.join(project.paths.metadata, locale);
}

export function metadataFile(project: Project, locale: string, field: MetadataField): string {
  return path.join(metadataDir(project, locale), `${field}.txt`);
}

export function readMetadataLocale(project: Project, locale: string, fields?: MetadataField[]): MetadataLocaleState {
  const dir = metadataDir(project, locale);
  const exists = dirExists(dir);
  const wanted = fields ?? project.config.metadata.fields;
  const states: MetadataFieldState[] = wanted.map((field) => {
    const file = metadataFile(project, locale, field);
    const present = exists && fileExists(file);
    const value = present ? fs.readFileSync(file, "utf8") : "";
    const length = metadataLength(value);
    const limit = METADATA_LIMITS[field];
    return { field, present, value, length, limit, overLimit: length > limit };
  });
  return { locale, dirExists: exists, fields: states };
}

/** Locale directories that exist on disk under fastlane/metadata (whatever the config says). */
export function listMetadataLocales(project: Project): string[] {
  if (!dirExists(project.paths.metadata)) return [];
  return fs
    .readdirSync(project.paths.metadata, { withFileTypes: true })
    .filter(
      (d) => d.isDirectory() && !d.name.startsWith(".") && d.name !== "review_information" && d.name !== "android",
    )
    .map((d) => d.name)
    .sort();
}

export function isMetadataField(s: string): s is MetadataField {
  return (METADATA_FIELDS as readonly string[]).includes(s);
}

/** Keyword-field hygiene checks (plan §13.1). */
export interface KeywordAnalysis {
  keywords: string[];
  duplicates: string[];
  spacesAfterCommas: boolean;
  /** keywords that already appear (as whole words) in name or subtitle */
  redundantWithTitle: string[];
}

export function analyzeKeywords(keywords: string, name = "", subtitle = ""): KeywordAnalysis {
  const parts = keywords
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean);
  const lower = parts.map((p) => p.toLowerCase());
  const duplicates = [...new Set(lower.filter((k, i) => lower.indexOf(k) !== i))];
  const titleWords = new Set(
    `${name} ${subtitle}`
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter(Boolean),
  );
  const redundantWithTitle = [...new Set(lower.filter((k) => titleWords.has(k)))];
  return { keywords: parts, duplicates, spacesAfterCommas: /,\s/.test(keywords), redundantWithTitle };
}

/** Fields whose files conventionally end with a newline (multi-line text). */
const MULTILINE_FIELDS: ReadonlySet<string> = new Set(["description", "release_notes"]);

export function metadataEtag(project: Project, locale: string, field: MetadataField): string {
  const file = metadataFile(project, locale, field);
  if (!fileExists(file)) return "missing";
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

/** Etags for every managed field of a locale, for optimistic concurrency in the editor. */
export function metadataEtags(project: Project, locale: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of project.config.metadata.fields) out[f] = metadataEtag(project, locale, f);
  return out;
}

export class MetadataConflict extends Error {
  constructor(public readonly field: string) {
    super(`${field}.txt changed on disk since it was loaded; reload before saving`);
  }
}

/**
 * Write one field atomically. Normalises line endings to \n and trailing
 * whitespace the way Ruby's strip would; multi-line fields keep one trailing
 * newline. Refuses locales that are not configured and never creates a locale
 * directory implicitly — use createMetadataLocale for that.
 */
export function writeMetadataField(
  project: Project,
  locale: string,
  field: MetadataField,
  value: string,
  ifMatch?: string,
): { etag: string; length: number; overLimit: boolean } {
  if (!project.config.locales.includes(locale))
    throw new Error(`Locale "${locale}" is not configured for this project`);
  const dir = resolveWithin(project.paths.metadata, locale);
  if (!dirExists(dir)) throw new Error(`No metadata directory for ${locale}; create it first`);
  if (ifMatch !== undefined && ifMatch !== metadataEtag(project, locale, field)) throw new MetadataConflict(field);
  const normalised = rubyStrip(value.replace(/\r\n?/g, "\n")) + (MULTILINE_FIELDS.has(field) ? "\n" : "");
  const file = metadataFile(project, locale, field);
  const tmp = path.join(dir, `.${field}.txt.tmp`);
  fs.writeFileSync(tmp, normalised, "utf8");
  fs.renameSync(tmp, file);
  const length = metadataLength(normalised);
  return { etag: metadataEtag(project, locale, field), length, overLimit: length > METADATA_LIMITS[field] };
}

/** Create fastlane/metadata/<locale>/ (explicit user action only). Existing files are never touched. */
export function createMetadataLocale(project: Project, locale: string, seedFrom?: string): string[] {
  if (!project.config.locales.includes(locale))
    throw new Error(`Locale "${locale}" is not configured for this project`);
  const dir = resolveWithin(project.paths.metadata, locale);
  fs.mkdirSync(dir, { recursive: true });
  const created: string[] = [];
  if (seedFrom) {
    for (const field of project.config.metadata.fields) {
      const src = metadataFile(project, seedFrom, field);
      const dst = metadataFile(project, locale, field);
      // URLs are usually the same across markets; text must be translated, so only seed URL fields.
      if (fileExists(src) && !fileExists(dst) && field.endsWith("_url")) {
        fs.copyFileSync(src, dst);
        created.push(`${locale}/${field}.txt`);
      }
    }
  }
  return created;
}
