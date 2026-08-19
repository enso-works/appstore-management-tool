import fs from "node:fs";
import path from "node:path";
import { readAppJson, type Project } from "./config";
import { listMetadataLocales, readMetadataLocale } from "./metadata";
import { dirExists, displayRelative, fileExists, resolveWithin } from "./paths";
import { isPngFile, readPngInfo, type PngInfo } from "./png";
import { METADATA_FIELDS } from "./schema";
import { getTarget, outputDirFor } from "./targets";

export type CheckStatus = "pass" | "warn" | "fail" | "skip";

export interface ReadinessCheck {
  id: string;
  title: string;
  status: CheckStatus;
  /** One line per finding; empty on pass. */
  details: string[];
  hint?: string;
}

export interface ReadinessReport {
  project: string;
  root: string;
  checks: ReadinessCheck[];
  status: CheckStatus;
}

/** Collects findings with an explicit level so status never depends on message text. */
class Findings {
  private items: { level: "fail" | "warn" | "info"; text: string }[] = [];

  fail(text: string) {
    this.items.push({ level: "fail", text });
  }

  warn(text: string) {
    this.items.push({ level: "warn", text });
  }

  info(text: string) {
    this.items.push({ level: "info", text });
  }

  get details(): string[] {
    return this.items.map((i) => i.text);
  }

  get status(): CheckStatus {
    if (this.items.some((i) => i.level === "fail")) return "fail";
    if (this.items.some((i) => i.level === "warn")) return "warn";
    return "pass";
  }

  check(id: string, title: string, hint?: string): ReadinessCheck {
    return { id, title, status: this.status, details: this.details, hint };
  }
}

function skipped(id: string, title: string, reason: string): ReadinessCheck {
  return { id, title, status: "skip", details: [reason] };
}

type CheckFn = (project: Project) => ReadinessCheck;

const CHECKS: { id: string; title: string; run: CheckFn }[] = [
  { id: "placeholders", title: "No template placeholders left", run: checkPlaceholders },
  { id: "metadata-locales", title: "Metadata present for every locale", run: checkMetadataLocales },
  { id: "metadata-limits", title: "Metadata within App Store limits", run: checkMetadataLimits },
  { id: "screenshots", title: "Screenshots complete per locale and target", run: checkScreenshots },
  { id: "screenshot-consistency", title: "Same screenshot count in every locale", run: checkScreenshotConsistency },
  { id: "icon", title: "App icon is 1024x1024 opaque PNG", run: checkIcon },
  { id: "credentials", title: "Fastlane credentials present", run: checkCredentials },
  { id: "version", title: "App version consistent", run: checkVersion },
];

/**
 * Store readiness (plan §13.2). Every check is independent and cheap; none
 * reads credential contents or touches the network. A check that throws
 * becomes a failed check, never a failed report.
 */
export function readinessReport(project: Project): ReadinessReport {
  const checks = CHECKS.map(({ id, title, run }) => {
    try {
      return run(project);
    } catch (err) {
      return {
        id,
        title,
        status: "fail" as const,
        details: [`check crashed: ${(err as Error).message}`],
        hint: "fix the file named above and rerun",
      };
    }
  });
  return {
    project: project.config.projectName,
    root: project.root,
    checks,
    status: worst(checks.map((c) => c.status)),
  };
}

function worst(statuses: CheckStatus[]): CheckStatus {
  if (statuses.includes("fail")) return "fail";
  if (statuses.includes("warn")) return "warn";
  if (statuses.every((s) => s === "skip")) return "skip";
  return "pass";
}

/** app.json as {expo} or flat; a parse failure is reported via `error` instead of thrown. */
function safeAppJson(project: Project): { app?: Record<string, unknown>; error?: string } {
  try {
    return { app: readAppJson(project) };
  } catch (err) {
    return { error: (err as Error).message };
  }
}

/** PNG header or an error string; never throws. */
function safePng(file: string): { info?: PngInfo; error?: string } {
  if (!isPngFile(file)) return { error: "not a PNG" };
  try {
    return { info: readPngInfo(file) };
  } catch (err) {
    return { error: `unreadable PNG (${(err as Error).message})` };
  }
}

const PLACEHOLDER = /__[A-Z][A-Z0-9_]*__/g;

function checkPlaceholders(project: Project): ReadinessCheck {
  const f = new Findings();
  const files = [
    "app.json",
    project.config.paths.metadata,
    project.config.paths.manifest,
    project.config.paths.content,
    "fastlane/Fastfile",
    "fastlane/Appfile",
    "fastlane/Deliverfile",
    "store-shots.config.json",
  ];
  for (const rel of files) {
    const abs = path.join(project.root, rel);
    for (const file of listTextFiles(abs)) {
      const text = fs.readFileSync(file, "utf8");
      const hits = [...new Set(text.match(PLACEHOLDER) ?? [])];
      if (hits.length) f.fail(`${displayRelative(project.root, file)}: ${hits.join(", ")}`);
    }
  }
  return f.check("placeholders", "No template placeholders left", "see starter-template/NEW-APP.md section 2");
}

function listTextFiles(p: string): string[] {
  if (fileExists(p)) return [p];
  if (!dirExists(p)) return [];
  const out: string[] = [];
  for (const e of fs.readdirSync(p, { withFileTypes: true })) {
    if (e.name.startsWith(".")) continue;
    const full = path.join(p, e.name);
    if (e.isDirectory()) out.push(...listTextFiles(full));
    else if (/\.(txt|json|rb)$|Fastfile|Appfile|Deliverfile/.test(e.name)) out.push(full);
  }
  return out;
}

function checkMetadataLocales(project: Project): ReadinessCheck {
  const id = "metadata-locales";
  const title = "Metadata present for every locale";
  if (!project.config.metadata.manage) return skipped(id, title, "metadata.manage is false");
  const f = new Findings();
  for (const locale of project.config.locales) {
    const state = readMetadataLocale(project, locale);
    if (!state.dirExists) {
      f.fail(`${locale}: no ${project.config.paths.metadata}/${locale}/ directory`);
      continue;
    }
    const missing = state.fields.filter((x) => !x.present || x.length === 0).map((x) => x.field);
    if (missing.length) f.fail(`${locale}: missing or empty ${missing.join(", ")}`);
  }
  const extra = listMetadataLocales(project).filter((l) => !project.config.locales.includes(l));
  if (extra.length) f.warn(`on disk but not in config.locales: ${extra.join(", ")} (uploaded by deliver anyway)`);
  return f.check(id, title, "fill fastlane/metadata/<locale>/*.txt (the tool's Store view edits these)");
}

function checkMetadataLimits(project: Project): ReadinessCheck {
  const id = "metadata-limits";
  const title = "Metadata within App Store limits";
  if (!project.config.metadata.manage) return skipped(id, title, "metadata.manage is false");
  const f = new Findings();
  // Mirror the Fastfile lane exactly: every locale directory on disk, all nine
  // fields, regardless of which fields this project chooses to manage.
  for (const locale of listMetadataLocales(project)) {
    const state = readMetadataLocale(project, locale, [...METADATA_FIELDS]);
    for (const x of state.fields) {
      if (x.present && x.overLimit) f.fail(`${locale}/${x.field} is ${x.length}/${x.limit}`);
    }
  }
  return f.check(id, title, "same limits as `fastlane ios validate_metadata`");
}

interface ScreenshotSet {
  locale: string;
  /** target id -> file names that match that target's exact dimensions */
  byTarget: Map<string, string[]>;
  /** failOnAlpha violations */
  alpha: string[];
  /** files that are not PNGs or match no configured target (informational) */
  unmatched: string[];
  /** files that could not be read (corrupt) */
  broken: string[];
}

function scanScreenshots(project: Project): ScreenshotSet[] {
  const sets: ScreenshotSet[] = [];
  const targets = project.config.targets
    .map((id) => getTarget(id)!)
    .filter(Boolean)
    .filter((t) => !t.id.startsWith("appreview-"));
  for (const locale of project.config.locales) {
    const set: ScreenshotSet = {
      locale,
      byTarget: new Map(targets.map((t) => [t.id, []])),
      alpha: [],
      unmatched: [],
      broken: [],
    };
    sets.push(set);
    // Targets may share an output directory (all iOS targets do); scan each directory once.
    const dirs = new Map<string, typeof targets>();
    for (const t of targets) {
      const dir = outputDirFor(t, locale, project.paths);
      dirs.set(dir, [...(dirs.get(dir) ?? []), t]);
    }
    for (const [dir, dirTargets] of dirs) {
      if (!dirExists(dir)) continue;
      for (const name of fs.readdirSync(dir).sort()) {
        if (name.startsWith(".") || !/\.(png|jpe?g)$/i.test(name)) continue;
        const { info, error } = safePng(path.join(dir, name));
        if (!info) {
          (error === "not a PNG" ? set.unmatched : set.broken).push(`${name} (${error})`);
          continue;
        }
        const match = dirTargets.find((t) => t.width === info.width && t.height === info.height);
        if (!match) {
          set.unmatched.push(`${name} (${info.width}x${info.height} matches no configured target)`);
          continue;
        }
        set.byTarget.get(match.id)!.push(name);
        if (info.hasAlpha && project.config.validation.failOnAlpha) set.alpha.push(`${name} has an alpha channel`);
      }
    }
  }
  return sets;
}

function checkScreenshots(project: Project): ReadinessCheck {
  const { min, max } = project.config.validation.screensPerTarget;
  const f = new Findings();
  for (const set of scanScreenshots(project)) {
    for (const [targetId, files] of set.byTarget) {
      const n = files.length;
      if (n === 0) f.fail(`${set.locale}/${targetId}: no screenshots`);
      else if (n < min) f.fail(`${set.locale}/${targetId}: ${n} screenshot(s), minimum ${min}`);
      else if (n > max) f.fail(`${set.locale}/${targetId}: ${n} screenshots, maximum ${max}`);
    }
    for (const a of set.alpha) f.fail(`${set.locale}: ${a}`);
    for (const b of set.broken) f.fail(`${set.locale}: ${b}`);
    for (const u of set.unmatched) f.warn(`${set.locale}: ${u}`);
  }
  return f.check(
    "screenshots",
    "Screenshots complete per locale and target",
    "run `store-shots generate` after validate passes",
  );
}

function checkScreenshotConsistency(project: Project): ReadinessCheck {
  const sets = scanScreenshots(project);
  const f = new Findings();
  for (const targetId of project.config.targets) {
    const counts = sets.map((s) => ({ locale: s.locale, n: s.byTarget.get(targetId)?.length ?? 0 }));
    const nonZero = counts.filter((c) => c.n > 0);
    if (nonZero.length === 0) continue;
    const distinct = new Set(nonZero.map((c) => c.n));
    if (distinct.size > 1 || nonZero.length !== counts.length) {
      f.warn(`${targetId}: ${counts.map((c) => `${c.locale}=${c.n}`).join(", ")}`);
    }
  }
  return f.check("screenshot-consistency", "Same screenshot count in every locale");
}

function checkIcon(project: Project): ReadinessCheck {
  const id = "icon";
  const title = "App icon is 1024x1024 opaque PNG";
  const f = new Findings();
  const { app, error } = safeAppJson(project);
  if (error) {
    f.fail(error);
    return f.check(id, title);
  }
  const iconRel = typeof app?.icon === "string" ? app.icon : "./assets/icon.png";
  let abs: string;
  try {
    abs = resolveWithin(project.root, iconRel);
  } catch {
    f.fail(`app.json icon "${iconRel}" points outside the app`);
    return f.check(id, title);
  }
  if (!fileExists(abs)) {
    f.fail(`${iconRel} not found`);
  } else {
    const { info, error: pngError } = safePng(abs);
    if (!info) {
      f.fail(`${iconRel} is ${pngError}`);
    } else {
      if (info.width !== 1024 || info.height !== 1024)
        f.fail(`${iconRel} is ${info.width}x${info.height}, App Store wants 1024x1024`);
      // Expo prebuild flattens the iOS icon (removeTransparency), so alpha in the
      // source is a warning, not a blocker. It still matters when the 1024px
      // marketing icon is uploaded to App Store Connect by hand.
      if (info.hasAlpha) f.warn(`${iconRel} has an alpha channel (prebuild flattens it; keep it opaque anyway)`);
    }
  }
  return f.check(id, title);
}

function checkCredentials(project: Project): ReadinessCheck {
  const id = "credentials";
  const title = "Fastlane credentials present";
  if (!project.config.fastlane.enabled) return skipped(id, title, "fastlane.enabled is false");
  const f = new Findings();
  const fl = path.join(project.root, "fastlane");
  if (!dirExists(fl)) {
    f.fail("no fastlane/ directory");
  } else {
    const names = fs.readdirSync(fl);
    if (!names.some((n) => /^AuthKey_.+\.p8$/.test(n))) f.fail("fastlane/AuthKey_<KEY_ID>.p8 missing");
    if (!names.includes("asc_api_key.json")) f.fail("fastlane/asc_api_key.json missing");
    if (!names.includes("Deliverfile")) f.fail("fastlane/Deliverfile missing (screenshots/metadata lanes need it)");
    if (!names.includes("Fastfile")) f.fail("fastlane/Fastfile missing");
  }
  // Existence only. Contents are never read.
  return f.check(id, title, "see fastlane/CREDENTIALS.md; the tool never reads these files");
}

function checkVersion(project: Project): ReadinessCheck {
  const f = new Findings();
  const { app, error } = safeAppJson(project);
  if (error) {
    f.fail(error);
    return f.check("version", "App version consistent");
  }
  const version = typeof app?.version === "string" ? app.version : undefined;
  if (!version) f.warn("app.json has no expo.version");
  const genManifest = path.join(project.paths.outputScreenshots, ".store-shots-manifest.json");
  if (fileExists(genManifest) && version) {
    try {
      const gm = JSON.parse(fs.readFileSync(genManifest, "utf8")) as { appVersion?: string };
      if (gm.appVersion && gm.appVersion !== version) {
        f.warn(`screenshots were generated for version ${gm.appVersion}; app.json is ${version}`);
      }
    } catch {
      f.warn(".store-shots-manifest.json is unreadable");
    }
  }
  return f.check("version", `App version ${version ?? "?"} consistent`);
}
