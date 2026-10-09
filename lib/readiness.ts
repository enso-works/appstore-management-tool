import fs from "node:fs";
import path from "node:path";
import { appFacts, type AppFacts } from "./app-facts";
import { type Project } from "./config";
import { analyzeKeywords, listMetadataLocales, readMetadataLocale } from "./metadata";
import { dirExists, displayRelative, fileExists, resolveWithin } from "./paths";
import { isJpegFile, readImageInfo, type ImageInfo } from "./image";
import { isPngFile, readPngInfo, type PngInfo } from "./png";
import { METADATA_FIELDS } from "./schema";
import { readVideoInfo, type VideoInfo } from "./video";
import { getTarget, isScreenshotSet, outputDirFor, targetIds, type DeviceFamily, type Orientation } from "./targets";

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
  { id: "metadata-keywords", title: "Keywords follow Apple's guidance", run: checkKeywords },
  { id: "required-sizes", title: "Screenshot sets cover the sizes Apple requires", run: checkRequiredSizes },
  { id: "screenshots", title: "Screenshots complete per locale and target", run: checkScreenshots },
  { id: "screenshot-consistency", title: "Same screenshot count in every locale", run: checkScreenshotConsistency },
  { id: "dark-mode", title: "A Dark Mode screenshot, if the app has Dark Mode", run: checkDarkMode },
  { id: "app-previews", title: "App previews meet Apple's specification", run: checkAppPreviews },
  { id: "icon", title: "App icon is 1024x1024 opaque PNG", run: checkIcon },
  { id: "icon-variants", title: "Dark and tinted app icons", run: checkIconVariants },
  { id: "credentials", title: "Fastlane credentials present", run: checkCredentials },
  { id: "version", title: "App version consistent", run: checkVersion },
];

/**
 * Store readiness (plan §13.2). Every check is independent and cheap; none
 * reads credential contents or touches the network. A check that throws
 * becomes a failed check, never a failed report.
 */
export function readinessReport(project: Project): ReadinessReport {
  // Several checks read the app's facts; read them once per report.
  facts = undefined;
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

let facts: { root: string; value: AppFacts } | undefined;

function factsOf(project: Project): AppFacts {
  if (facts?.root !== project.root) facts = { root: project.root, value: appFacts(project.root) };
  return facts.value;
}

function worst(statuses: CheckStatus[]): CheckStatus {
  if (statuses.includes("fail")) return "fail";
  if (statuses.includes("warn")) return "warn";
  if (statuses.every((s) => s === "skip")) return "skip";
  return "pass";
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

/** PNG or JPEG header (App Store Connect takes both for screenshots) or an error string; never throws. */
function safeImage(file: string): { info?: ImageInfo; error?: string } {
  try {
    return { info: readImageInfo(file) };
  } catch (err) {
    const kind = isPngFile(file) ? "PNG" : isJpegFile(file) ? "JPEG" : undefined;
    return { error: kind ? `unreadable ${kind} (${(err as Error).message})` : "not a PNG or JPEG" };
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

function checkKeywords(project: Project): ReadinessCheck {
  const id = "metadata-keywords";
  const title = "Keywords follow Apple's guidance";
  if (!project.config.metadata.manage) return skipped(id, title, "metadata.manage is false");
  const f = new Findings();
  for (const locale of listMetadataLocales(project)) {
    const state = readMetadataLocale(project, locale, ["keywords", "name", "subtitle"]);
    const [keywords, name, subtitle] = state.fields.map((x) => x.value);
    if (!state.fields[0].present) continue; // metadata-locales reports missing fields
    for (const { level, text } of analyzeKeywords(keywords, name, subtitle).findings) {
      f[level](`${locale}: ${text}`);
    }
  }
  return f.check(id, title, "fastlane/metadata/<locale>/keywords.txt; the Store view shows the same findings");
}

interface ScreenshotSet {
  locale: string;
  /** target id -> file names that match that target's exact dimensions */
  byTarget: Map<string, string[]>;
  /** failOnAlpha violations */
  alpha: string[];
  /** files that are not images or match no configured target (informational) */
  unmatched: string[];
  /** files that could not be read (corrupt) */
  broken: string[];
}

function scanScreenshots(project: Project): ScreenshotSet[] {
  const sets: ScreenshotSet[] = [];
  const targets = project.config.targets
    .map((id) => getTarget(id)!)
    .filter(Boolean)
    .filter((t) => isScreenshotSet(t));
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
        const { info, error } = safeImage(path.join(dir, name));
        if (!info) {
          set.broken.push(`${name} (${error})`);
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

/**
 * Apple's screenshot specification (verified 2026-10-08) says "you must provide"
 * iPhone with Dynamic Island (medium display), 6.1", and iPad 13" when the app
 * runs on iPad. Its size table still lets a 6.9" set stand in for 6.1" (scaled),
 * and apps have shipped that way, so a missing 6.1" set is a warning.
 */
function checkRequiredSizes(project: Project): ReadinessCheck {
  const id = "required-sizes";
  const title = "Screenshot sets cover the sizes Apple requires";
  const ios = project.config.targets
    .map((t) => getTarget(t))
    .filter((t) => t !== undefined)
    .filter((t) => t.platform === "ios" && isScreenshotSet(t));
  if (ios.length === 0) return skipped(id, title, "no App Store screenshot targets configured");
  const f = new Findings();
  const iphone = ios.filter((t) => t.family === "iphone");
  const orientation = iphone[0]?.orientation ?? ios[0].orientation;
  const sixOne = requiredTargetId("iphone", "6.1-inch", orientation);
  if (iphone.length === 0) {
    f.fail(`no iPhone set; add ${sixOne}`);
  } else if (!iphone.some((t) => t.displayClass === "6.1-inch")) {
    f.warn(
      `no 6.1" iPhone set: Apple names it the required iPhone size, and without it App Store Connect shows a scaled larger set; add ${sixOne}`,
    );
  }
  const hasIpad13 = ios.some((t) => t.family === "ipad" && t.displayClass === "13-inch");
  const { ipad } = factsOf(project);
  if (ipad.value && !hasIpad13) {
    f.fail(
      `the app runs on iPad (${ipad.source}), so App Store Connect requires an iPad 13" set; add ${requiredTargetId("ipad", "13-inch", orientation)}`,
    );
  } else if (!ipad.value && hasIpad13) {
    f.info(
      `iPad 13" set configured, but the app does not run on iPad (${ipad.source}); it is only needed for iPad apps`,
    );
  }
  return f.check(id, title, 'targets in store-shots.config.json; 6.1" renders from the same raw captures as 6.9"');
}

/** The registry's target for a required size, in the app's orientation. */
function requiredTargetId(family: DeviceFamily, displayClass: string, orientation: Orientation): string {
  const matches = targetIds.filter((t) => {
    const target = getTarget(t)!;
    return target.family === family && target.displayClass === displayClass;
  });
  return matches.find((t) => getTarget(t)!.orientation === orientation) ?? matches[0];
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

/**
 * Apple's product page guidance (verified 2026-10-09): "If your app supports
 * Dark Mode, consider including at least one screenshot that showcases what
 * the experience looks like." A screen says what its capture shows with
 * `appearance` in the manifest.
 */
function checkDarkMode(project: Project): ReadinessCheck {
  const id = "dark-mode";
  const title = "A Dark Mode screenshot, if the app has Dark Mode";
  const style = factsOf(project).interfaceStyle;
  if (!style) return skipped(id, title, "the app does not declare an interface style (UIUserInterfaceStyle)");
  if (style.value !== "automatic") return skipped(id, title, `the app is always ${style.value} (${style.source})`);
  const f = new Findings();
  let manifest: { screens: { id: string; enabled: boolean; appearance?: string }[] } | undefined;
  try {
    manifest = JSON.parse(fs.readFileSync(project.paths.manifest, "utf8"));
  } catch {
    return skipped(id, title, "the manifest is unreadable (validate reports why)");
  }
  const shown = (manifest?.screens ?? []).filter((s) => s.enabled !== false);
  if (!shown.some((s) => s.appearance === "dark")) {
    f.warn(
      `the app follows the system appearance (${style.source}), but no screen is marked appearance: "dark"; Apple suggests showing Dark Mode in at least one screenshot`,
    );
  }
  return f.check(
    id,
    title,
    'capture one screen in Dark Mode and set "appearance": "dark" on it in store/manifest.json',
  );
}

/**
 * Accepted App Preview sizes per display class (verified 2026-10-09), either
 * way round: 886x1920 for every iPhone with Face ID or Dynamic Island,
 * 1080x1920 and 750x1334 for the Home-button iPhones, 1200x1600 for iPads
 * from 10.5" up, 900x1200 for 9.7" and older 12.9".
 */
const PREVIEW_CLASSES: { device: string; width: number; height: number }[] = [
  { device: "iPhone", width: 886, height: 1920 },
  { device: 'iPhone 5.5"', width: 1080, height: 1920 },
  { device: 'iPhone 4.7"', width: 750, height: 1334 },
  { device: "iPad", width: 1200, height: 1600 },
  { device: 'iPad 9.7"', width: 900, height: 1200 },
];

function previewClass(width: number, height: number) {
  return PREVIEW_CLASSES.find(
    (c) => (c.width === width && c.height === height) || (c.width === height && c.height === width),
  );
}

export const PREVIEW_LIMITS = { minSeconds: 15, maxSeconds: 30, maxFps: 30, maxBytes: 500 * 1024 * 1024, perSet: 3 };

/**
 * App previews are optional; when <previews>/<locale>/ has videos, each must
 * be one of Apple's accepted sizes, 15-30 seconds, at most 30 fps and 500 MB,
 * with at most three per device and locale.
 */
function checkAppPreviews(project: Project): ReadinessCheck {
  const id = "app-previews";
  const title = "App previews meet Apple's specification";
  if (!dirExists(project.paths.previews)) {
    return skipped(id, title, `no ${project.config.paths.previews}/ (app previews are optional)`);
  }
  const f = new Findings();
  const { ipad } = factsOf(project);
  const dirs = fs.readdirSync(project.paths.previews, { withFileTypes: true }).filter((e) => e.isDirectory());
  for (const d of dirs) {
    if (!project.config.locales.includes(d.name)) {
      f.warn(`${d.name}/ is not one of the app's locales`);
      continue;
    }
    const counts = new Map<string, number>();
    for (const name of fs.readdirSync(path.join(project.paths.previews, d.name)).sort()) {
      if (name.startsWith(".")) continue;
      const rel = `${d.name}/${name}`;
      if (!/\.(mov|m4v|mp4)$/i.test(name)) {
        f.warn(`${rel}: App Store Connect takes .mov, .m4v or .mp4`);
        continue;
      }
      let info: VideoInfo;
      try {
        info = readVideoInfo(path.join(project.paths.previews, d.name, name));
      } catch (err) {
        f.fail(`${rel}: unreadable (${(err as Error).message})`);
        continue;
      }
      const size = previewClass(info.width, info.height);
      if (!size) {
        f.fail(
          `${rel}: ${info.width}x${info.height}; App Store Connect takes 886x1920 for current iPhones and 1200x1600 for iPads (either way round)`,
        );
      } else {
        counts.set(size.device, (counts.get(size.device) ?? 0) + 1);
        if (size.device.startsWith("iPad") && !ipad.value) {
          f.warn(`${rel}: an iPad preview, but the app does not run on iPad`);
        }
      }
      const secs = info.durationSeconds;
      if (secs < PREVIEW_LIMITS.minSeconds || secs > PREVIEW_LIMITS.maxSeconds) {
        f.fail(
          `${rel}: ${Math.round(secs * 100) / 100} s; previews are ${PREVIEW_LIMITS.minSeconds} to ${PREVIEW_LIMITS.maxSeconds} seconds`,
        );
      }
      // The peak rate, not the average: 29.97 is fine, a 60 fps stretch in a screen recording is not.
      if (info.maxFps > PREVIEW_LIMITS.maxFps + 0.05) {
        f.fail(`${rel}: ${Math.round(info.maxFps * 100) / 100} fps; at most ${PREVIEW_LIMITS.maxFps}`);
      }
      if (info.bytes > PREVIEW_LIMITS.maxBytes) {
        f.fail(`${rel}: ${Math.round(info.bytes / 1024 / 1024)} MB; at most 500 MB`);
      }
    }
    for (const [device, n] of counts) {
      if (n > PREVIEW_LIMITS.perSet) f.fail(`${d.name}: ${n} ${device} previews; at most ${PREVIEW_LIMITS.perSet}`);
    }
  }
  return f.check(id, title, "App Store Connect takes previews by hand; deliver does not upload them");
}

/**
 * iOS 18 and later show a dark and a tinted home screen icon. Without them
 * the system derives both from the light icon, which rarely looks designed.
 */
function checkIconVariants(project: Project): ReadinessCheck {
  const id = "icon-variants";
  const title = "Dark and tinted app icons";
  const variants = factsOf(project).iconVariants;
  if (!variants) return skipped(id, title, "no icon set found to inspect");
  const missing = (["dark", "tinted"] as const).filter((v) => !variants.value[v]);
  const f = new Findings();
  if (missing.length) {
    f.warn(
      `no ${missing.join(" or ")} icon (${variants.source}); iOS 18 and later derive ${missing.length > 1 ? "them" : "it"} from the light icon`,
    );
  }
  return f.check(
    id,
    title,
    'Expo: ios.icon as { "light", "dark", "tinted" } or an Icon Composer .icon file; Xcode: the appearances in the AppIcon set',
  );
}

function checkIcon(project: Project): ReadinessCheck {
  const id = "icon";
  const title = "App icon is 1024x1024 opaque PNG";
  const f = new Findings();
  const facts = factsOf(project);
  if (facts.appJsonError) {
    f.fail(facts.appJsonError);
    return f.check(id, title);
  }
  if (!facts.icon) {
    f.fail("no 1024x1024 image in the app icon set (ios/**/AppIcon.appiconset)");
    return f.check(id, title);
  }
  const iconRel = facts.icon.value.rel;
  let abs: string;
  try {
    abs = resolveWithin(project.root, iconRel);
  } catch {
    f.fail(`${facts.icon.source} "${iconRel}" points outside the app`);
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
      // Expo prebuild flattens the iOS icon (removeTransparency), so alpha in an
      // Expo source is a warning; in an asset catalog it ships as is and App
      // Store Connect rejects it.
      if (info.hasAlpha) {
        if (facts.kind === "expo")
          f.warn(`${iconRel} has an alpha channel (prebuild flattens it; keep it opaque anyway)`);
        else f.fail(`${iconRel} has an alpha channel; the App Store icon must be opaque`);
      }
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
  const facts = factsOf(project);
  if (facts.appJsonError) {
    f.fail(facts.appJsonError);
    return f.check("version", "App version consistent");
  }
  const version = facts.version?.value;
  if (!version) f.warn("no app version (app.json version, or MARKETING_VERSION in the Xcode project)");
  const genManifest = path.join(project.paths.outputScreenshots, ".store-shots-manifest.json");
  if (fileExists(genManifest) && version) {
    try {
      const gm = JSON.parse(fs.readFileSync(genManifest, "utf8")) as { appVersion?: string };
      if (gm.appVersion && gm.appVersion !== version) {
        f.warn(
          `screenshots were generated for version ${gm.appVersion}; the app is ${version} (${facts.version!.source})`,
        );
      }
    } catch {
      f.warn(".store-shots-manifest.json is unreadable");
    }
  }
  return f.check("version", `App version ${version ?? "?"} consistent`);
}
