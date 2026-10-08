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

/**
 * Keyword field hygiene (plan §13.1), following Apple's product page guidance
 * (verified 2026-10-08): 100 bytes, commas without spaces, terms longer than two
 * characters, and no plurals of included words, category names, "app",
 * duplicate words or special characters. Name and subtitle are indexed already.
 */
export interface KeywordAnalysis {
  keywords: string[];
  /** UTF-8 bytes: App Store Connect limits keywords to 100 bytes, so non-Latin scripts fit fewer characters. */
  bytes: number;
  duplicates: string[];
  spacesAfterCommas: boolean;
  /** keywords that already appear (as whole words) in name or subtitle */
  redundantWithTitle: string[];
  /** plural forms whose singular is also a keyword */
  plurals: string[];
  /** words that appear in more than one keyword phrase */
  repeatedWords: string[];
  /** "app" or "apps" as a word */
  appWord: boolean;
  /** keywords that are App Store category names */
  categoryNames: string[];
  /** keywords containing # or @ */
  specialChars: string[];
  /** keywords of two characters or fewer (not counting Chinese, Japanese and Korean words) */
  tooShort: string[];
  /** The above as one line per problem, worst first; readiness and the Store view print these. */
  findings: KeywordFinding[];
}

export interface KeywordFinding {
  level: "fail" | "warn";
  text: string;
}

export const KEYWORDS_MAX_BYTES = 100;

/** App Store top-level categories (English names, lowercase). */
const CATEGORY_NAMES = new Set([
  "books",
  "business",
  "developer tools",
  "education",
  "entertainment",
  "finance",
  "food & drink",
  "games",
  "graphics & design",
  "health & fitness",
  "kids",
  "lifestyle",
  "magazines & newspapers",
  "medical",
  "music",
  "navigation",
  "news",
  "photo & video",
  "productivity",
  "reference",
  "shopping",
  "social networking",
  "sports",
  "travel",
  "utilities",
  "weather",
]);

const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;

const WORD_SPLIT = /[^\p{L}\p{N}]+/u;

export function analyzeKeywords(keywords: string, name = "", subtitle = ""): KeywordAnalysis {
  const analysis = analyze(keywords, name, subtitle);
  return { ...analysis, findings: keywordFindings(analysis) };
}

function analyze(keywords: string, name: string, subtitle: string): Omit<KeywordAnalysis, "findings"> {
  const parts = keywords
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean);
  const lower = parts.map((p) => p.toLowerCase());
  const unique = [...new Set(lower)];
  const duplicates = [...new Set(lower.filter((k, i) => lower.indexOf(k) !== i))];
  const titleWords = new Set(`${name} ${subtitle}`.toLowerCase().split(WORD_SPLIT).filter(Boolean));
  const redundantWithTitle = [...new Set(lower.filter((k) => titleWords.has(k)))];
  const present = new Set(unique);
  const plurals = unique.filter((k) => singularsOf(k).some((s) => present.has(s)));
  const phraseCount = new Map<string, number>();
  for (const k of unique) {
    for (const w of new Set(k.split(WORD_SPLIT).filter(Boolean))) phraseCount.set(w, (phraseCount.get(w) ?? 0) + 1);
  }
  const repeatedWords = [...phraseCount].filter(([, n]) => n > 1).map(([w]) => w);
  return {
    keywords: parts,
    bytes: Buffer.byteLength(rubyStrip(keywords), "utf8"),
    duplicates,
    spacesAfterCommas: /,\s/.test(keywords),
    redundantWithTitle,
    plurals,
    repeatedWords,
    appWord: unique.some((k) => k.split(WORD_SPLIT).some((w) => w === "app" || w === "apps")),
    categoryNames: unique.filter((k) => CATEGORY_NAMES.has(k)),
    specialChars: parts.filter((k) => /[#@]/.test(k)),
    // Two Han, kana or Hangul characters make a whole word, so the rule only applies to other scripts.
    tooShort: parts.filter((k) => Array.from(k).length <= 2 && !CJK.test(k)),
  };
}

/** English singular candidates for a plural keyword ("timers" -> "timer", "stories" -> "story"). */
function singularsOf(word: string): string[] {
  const out: string[] = [];
  if (/ies$/.test(word)) out.push(word.slice(0, -3) + "y");
  if (/(s|x|z|ch|sh)es$/.test(word)) out.push(word.slice(0, -2));
  if (/[^s]s$/.test(word)) out.push(word.slice(0, -1));
  return out;
}

function keywordFindings(a: Omit<KeywordAnalysis, "findings">): KeywordFinding[] {
  const out: KeywordFinding[] = [];
  if (a.bytes > KEYWORDS_MAX_BYTES) out.push({ level: "fail", text: `${a.bytes}/${KEYWORDS_MAX_BYTES} bytes` });
  const warn = (text: string) => out.push({ level: "warn", text });
  if (a.spacesAfterCommas) warn("spaces after commas waste characters");
  if (a.duplicates.length) warn(`duplicates: ${a.duplicates.join(", ")}`);
  if (a.redundantWithTitle.length) warn(`already in name/subtitle: ${a.redundantWithTitle.join(", ")}`);
  if (a.plurals.length) warn(`plurals of included words: ${a.plurals.join(", ")}`);
  if (a.repeatedWords.length) warn(`words used in more than one keyword: ${a.repeatedWords.join(", ")}`);
  if (a.appWord) warn('"app" is indexed already');
  if (a.categoryNames.length) warn(`category names: ${a.categoryNames.join(", ")}`);
  if (a.specialChars.length) warn(`# or @ carry no search weight: ${a.specialChars.join(", ")}`);
  if (a.tooShort.length) warn(`two characters or fewer: ${a.tooShort.join(", ")}`);
  return out;
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

/** Google Play text metadata (supply layout: fastlane/metadata/android/<locale>/*.txt). */
export const PLAY_FIELDS = ["title", "short_description", "full_description"] as const;
export type PlayField = (typeof PLAY_FIELDS)[number];

export const PLAY_LIMITS: Record<PlayField, number> = {
  title: 30,
  short_description: 80,
  full_description: 4000,
};

export interface PlayLocaleState {
  locale: string;
  dirExists: boolean;
  fields: { field: PlayField; present: boolean; value: string; length: number; limit: number; overLimit: boolean }[];
}

export function readPlayLocale(project: Project, playLocale: string): PlayLocaleState {
  const dir = path.join(project.paths.outputPlay, playLocale);
  const exists = dirExists(dir);
  return {
    locale: playLocale,
    dirExists: exists,
    fields: PLAY_FIELDS.map((field) => {
      const file = path.join(dir, `${field}.txt`);
      const present = exists && fileExists(file);
      const value = present ? fs.readFileSync(file, "utf8") : "";
      const length = metadataLength(value);
      return { field, present, value, length, limit: PLAY_LIMITS[field], overLimit: length > PLAY_LIMITS[field] };
    }),
  };
}

export function writePlayField(
  project: Project,
  playLocale: string,
  field: PlayField,
  value: string,
): { length: number; overLimit: boolean } {
  const dir = resolveWithin(project.paths.outputPlay, playLocale);
  fs.mkdirSync(dir, { recursive: true });
  const normalised = rubyStrip(value.replace(/\r\n?/g, "\n")) + (field === "full_description" ? "\n" : "");
  const tmp = path.join(dir, `.${field}.txt.tmp`);
  fs.writeFileSync(tmp, normalised, "utf8");
  fs.renameSync(tmp, path.join(dir, `${field}.txt`));
  const length = metadataLength(normalised);
  return { length, overLimit: length > PLAY_LIMITS[field] };
}
