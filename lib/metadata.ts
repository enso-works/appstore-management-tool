import fs from "node:fs";
import path from "node:path";
import type { Project } from "./config";
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
