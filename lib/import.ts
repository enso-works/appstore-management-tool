import fs from "node:fs";
import path from "node:path";
import { CONFIG_FILENAME, readJsonFile } from "./config";
import { initProject, metadataLocaleDirs, proposeLocales, readExpoConfig } from "./init";
import { dirExists, fileExists } from "./paths";
import { listRegistered, register, type RegisteredProject } from "./registered";
import { discoverProjects, isFallbackListing, SKIP_DIRS } from "./registry";
import { targetsFor, type Orientation } from "./targets";

export { targetsFor };

/**
 * Importing an app: read what the app already says about itself (Expo
 * app.json, Capacitor config, the native Info.plist and Xcode project,
 * fastlane metadata), propose a config from it, and write that config once the
 * proposal has been reviewed. `init` uses the same proposal, so the CLI and the
 * editor scaffold the same thing.
 */

export type AppKind = "expo" | "capacitor" | "native-ios" | "unknown";

/** Where a proposed value came from, shown next to it so a wrong guess is easy to spot. */
export type Source = string;

export interface AppProposal {
  root: string;
  kind: AppKind;
  /** The app already has a store-shots.config.json: importing only adds it to the list. */
  hasConfig: boolean;
  /** Already in the list of apps, under this name. */
  registeredAs?: string;
  projectName: string;
  bundleId?: string;
  androidPackage?: string;
  locales: string[];
  defaultLocale: string;
  orientation: Orientation;
  ipad: boolean;
  play: boolean;
  /** Target ids the choices above produce. */
  targets: string[];
  sources: {
    projectName: Source;
    bundleId?: Source;
    locales: Source;
    orientation: Source;
    ipad: Source;
    play: Source;
  };
  /** Anything worth knowing before importing (existing store/ folder, raw captures, ...). */
  notes: string[];
}

export interface ImportChoices {
  root: string;
  /** Name in the list of apps; default: the directory name. */
  name?: string;
  projectName?: string;
  locales?: string[];
  defaultLocale?: string;
  orientation?: Orientation;
  ipad?: boolean;
  play?: boolean;
}

export interface ImportResult {
  entry: RegisteredProject;
  /** True when the app already had a config and was only added to the list. */
  registeredOnly: boolean;
  created: string[];
  skipped: string[];
}

export class ImportError extends Error {}

/** An app folder as typed or picked: `~` expanded, and it must be a full path. */
export function resolveAppPath(dir: string): string {
  const expanded = dir.trim().replace(/^~(?=$|\/)/, process.env.HOME ?? "~");
  if (!path.isAbsolute(expanded)) {
    throw new ImportError("Use the app folder's full path, e.g. /Users/you/apps/my-app");
  }
  return path.resolve(expanded);
}

/**
 * Read an app directory and propose a config. Throws ImportError for anything
 * that is not an app, unless `allowUnknown` (`init` scaffolds any folder it is
 * pointed at, with folder-name defaults).
 */
export function inspectApp(dir: string, opts: { allowUnknown?: boolean } = {}): AppProposal {
  const root = path.resolve(dir);
  if (!dirExists(root)) throw new ImportError(`${root} is not a directory`);
  if (isToolCheckout(root)) throw new ImportError("This is store-shots itself; choose an app's folder");

  const expo = readExpoSafely(root);
  const capacitor = readCapacitor(root);
  const plist = readInfoPlist(root);
  const xcode = readXcodeProject(root);
  const pkg = readPackageJson(root);
  const kind: AppKind = expo ? "expo" : capacitor ? "capacitor" : plist || xcode ? "native-ios" : "unknown";
  if (kind === "unknown" && !opts.allowUnknown && !dirExists(path.join(root, "fastlane")) && !hasConfig(root)) {
    throw new ImportError(
      `${root} does not look like an app: no app.json, capacitor.config, ios/ project or fastlane/ folder`,
    );
  }

  const [projectName, nameSource] = first<string>(
    [str(expo?.name), "app.json name"],
    [capacitor?.appName, "capacitor.config appName"],
    [plist?.displayName, "Info.plist CFBundleDisplayName"],
    [str(pkg?.name), "package.json name"],
    [path.basename(root), "folder name"],
  );
  const expoIos = expo?.ios as { bundleIdentifier?: string; supportsTablet?: boolean } | undefined;
  const [bundleId, bundleSource] = first<string | undefined>(
    [str(expoIos?.bundleIdentifier), "app.json ios.bundleIdentifier"],
    [capacitor?.appId, "capacitor.config appId"],
    [xcode?.bundleId, "Xcode project PRODUCT_BUNDLE_IDENTIFIER"],
    [undefined, ""],
  );
  const androidPackage = str((expo?.android as { package?: string } | undefined)?.package);

  // Locales: fastlane metadata first (what the store listing already has), then the app's languages.
  const languages = expo
    ? ((expo.ios as { infoPlist?: { CFBundleLocalizations?: string[] } } | undefined)?.infoPlist
        ?.CFBundleLocalizations ?? [])
    : (plist?.localizations ?? []);
  const app = expo ?? (languages.length ? { ios: { infoPlist: { CFBundleLocalizations: languages } } } : undefined);
  const locales = proposeLocales(root, app);
  const metadataDir = path.join(root, "fastlane", "metadata");
  const localesSource = metadataLocaleDirs(root).length
    ? "fastlane/metadata folders"
    : languages.length
      ? `${expo ? "app.json" : "Info.plist"} CFBundleLocalizations`
      : "default (en-US)";
  const defaultLocale = locales.includes("en-US") ? "en-US" : locales[0];

  const expoOrientation = str(expo?.orientation);
  const [orientation, orientationSource] = first<Orientation>(
    [expoOrientation === "landscape" ? "landscape" : undefined, "app.json orientation"],
    [expoOrientation ? "portrait" : undefined, "app.json orientation"],
    [plist?.orientation, "Info.plist UISupportedInterfaceOrientations"],
    ["portrait", "default"],
  );
  const [ipad, ipadSource] = first<boolean>(
    [typeof expoIos?.supportsTablet === "boolean" ? expoIos.supportsTablet : undefined, "app.json ios.supportsTablet"],
    [xcode?.ipad, "Xcode project TARGETED_DEVICE_FAMILY"],
    [false, "default"],
  );
  // Play sets only when the app already ships to Google Play through supply.
  const playMetadata = dirExists(path.join(metadataDir, "android"));
  const play = playMetadata;
  const playSource = playMetadata ? "fastlane/metadata/android" : "no fastlane/metadata/android";

  const notes: string[] = [];
  const existing = hasConfig(root);
  if (existing) notes.push(`${CONFIG_FILENAME} exists: importing adds the app to the list and changes nothing in it`);
  else if (dirExists(path.join(root, "store"))) notes.push("store/ exists: files already there are kept");
  const shots = path.join(root, "fastlane", "screenshots");
  if (dirExists(shots)) notes.push("fastlane/screenshots exists: generated screenshots will be written there");
  if (isFallbackListing() && discoverProjects().length > 0) {
    notes.push("Your list shows apps found by scanning; importing adds those to the list too, so none disappear");
  }

  const resolved = listRegistered().find((p) => path.resolve(p.root) === root);
  return {
    root,
    kind,
    hasConfig: existing,
    registeredAs: resolved?.name,
    projectName,
    bundleId,
    androidPackage,
    locales,
    defaultLocale,
    orientation,
    ipad,
    play,
    targets: targetsFor({ orientation, ipad, play }),
    sources: {
      projectName: nameSource,
      bundleId: bundleId ? bundleSource : undefined,
      locales: localesSource,
      orientation: orientationSource,
      ipad: ipadSource,
      play: playSource,
    },
    notes,
  };
}

/** Write the config (unless one exists) and add the app to the list. */
export function importApp(choices: ImportChoices): ImportResult {
  const proposal = inspectApp(choices.root);
  keepScannedApps();
  if (proposal.hasConfig) {
    const entry = register(proposal.root, choices.name);
    return { entry, registeredOnly: true, created: [], skipped: [] };
  }
  const orientation = choices.orientation ?? proposal.orientation;
  const locales = choices.locales ?? proposal.locales;
  // A reviewed locale list may no longer contain the proposed default.
  const defaultLocale =
    choices.defaultLocale ??
    (locales.includes(proposal.defaultLocale)
      ? proposal.defaultLocale
      : locales.includes("en-US")
        ? "en-US"
        : locales[0]);
  const result = initProject({
    appRoot: proposal.root,
    projectName: choices.projectName?.trim() || proposal.projectName,
    bundleId: proposal.bundleId,
    locales,
    defaultLocale,
    orientation,
    targets: targetsFor({
      orientation,
      ipad: choices.ipad ?? proposal.ipad,
      play: choices.play ?? proposal.play,
    }),
  });
  const entry = register(proposal.root, choices.name);
  return { entry, registeredOnly: false, created: result.created, skipped: result.skipped };
}

/**
 * While nothing is registered the list shows apps found by scanning. The first
 * import switches it to the registered apps only, so register what the scan
 * showed first; otherwise every other app would drop off the list.
 */
function keepScannedApps() {
  if (!isFallbackListing()) return;
  for (const found of discoverProjects()) {
    if (found.project) register(found.root, found.name);
  }
}

export interface ImportCandidate {
  root: string;
  name: string;
  kind: AppKind;
  hasConfig: boolean;
}

/**
 * Apps near the tool that are not in the list yet: folders up to `maxDepth`
 * below `dir` with an app.json, a Capacitor config or an ios/ project.
 */
export function findImportCandidates(dir: string, maxDepth = 2): ImportCandidate[] {
  const registered = new Set(listRegistered().map((p) => path.resolve(p.root)));
  const out: ImportCandidate[] = [];
  const walk = (current: string, depth: number) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (!e.isDirectory() || e.name.startsWith(".") || SKIP_DIRS.has(e.name)) continue;
      const full = path.join(current, e.name);
      const kind = quickKind(full);
      if (kind && !registered.has(full) && !isToolCheckout(full)) {
        out.push({ root: full, name: path.relative(dir, full), kind, hasConfig: hasConfig(full) });
        continue;
      }
      if (depth < maxDepth) walk(full, depth + 1);
    }
  };
  walk(path.resolve(dir), 1);
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

// --- reading the app -------------------------------------------------------

function quickKind(dir: string): AppKind | undefined {
  if (readExpoSafely(dir)) return "expo";
  if (capacitorConfigFile(dir)) return "capacitor";
  if (findInfoPlist(dir)) return "native-ios";
  return undefined;
}

function hasConfig(root: string): boolean {
  return fileExists(path.join(root, CONFIG_FILENAME));
}

function isToolCheckout(dir: string): boolean {
  return fileExists(path.join(dir, "bin", "store-shots.mjs")) && fileExists(path.join(dir, "lib", "import.ts"));
}

/** app.json as Expo writes it, wrapped or flat; unreadable JSON counts as no app.json. */
function readExpoSafely(root: string): Record<string, unknown> | undefined {
  try {
    return readExpoConfig(root);
  } catch {
    return undefined;
  }
}

function capacitorConfigFile(root: string): string | undefined {
  return ["capacitor.config.json", "capacitor.config.ts", "capacitor.config.js"]
    .map((f) => path.join(root, f))
    .find(fileExists);
}

/** appId and appName from a Capacitor config; the .ts/.js form is read as text, never executed. */
function readCapacitor(root: string): { appId?: string; appName?: string } | undefined {
  const file = capacitorConfigFile(root);
  if (!file) return undefined;
  const text = fs.readFileSync(file, "utf8");
  if (file.endsWith(".json")) {
    try {
      const json = JSON.parse(text) as { appId?: unknown; appName?: unknown };
      return { appId: str(json.appId), appName: str(json.appName) };
    } catch {
      return {};
    }
  }
  const field = (key: string) => new RegExp(`\\b${key}\\s*:\\s*(['"\`])([^'"\`]+)\\1`).exec(text)?.[2];
  return { appId: field("appId"), appName: field("appName") };
}

/** The app target's Info.plist: Capacitor's ios/App/App, else ios/<name>/ (Expo prebuild, React Native, Xcode). */
function findInfoPlist(root: string): string | undefined {
  const ios = path.join(root, "ios");
  if (!dirExists(ios)) return undefined;
  const capacitor = path.join(ios, "App", "App", "Info.plist");
  if (fileExists(capacitor)) return capacitor;
  for (const e of fs.readdirSync(ios, { withFileTypes: true })) {
    if (!e.isDirectory() || e.name === "Pods" || e.name.startsWith(".") || /Tests$|\.xc/.test(e.name)) continue;
    const candidate = path.join(ios, e.name, "Info.plist");
    // Widgets and other extensions have their own Info.plist; the app's has no NSExtension.
    if (fileExists(candidate) && !fs.readFileSync(candidate, "utf8").includes("<key>NSExtension</key>")) {
      return candidate;
    }
  }
  return undefined;
}

interface PlistFacts {
  displayName?: string;
  orientation?: Orientation;
  localizations?: string[];
}

/** The few Info.plist keys import needs, from the XML form source trees keep. */
function readInfoPlist(root: string): PlistFacts | undefined {
  const file = findInfoPlist(root);
  if (!file) return undefined;
  const xml = fs.readFileSync(file, "utf8");
  const string = (key: string) => {
    const v = new RegExp(`<key>${key}</key>\\s*<string>([^<]*)</string>`).exec(xml)?.[1];
    // Build settings like $(PRODUCT_NAME) are not names.
    return v && !v.includes("$(") ? unescapeXml(v) : undefined;
  };
  const array = (key: string) => {
    const body = new RegExp(`<key>${key}</key>\\s*<array>([\\s\\S]*?)</array>`).exec(xml)?.[1];
    return body ? [...body.matchAll(/<string>([^<]*)<\/string>/g)].map((m) => unescapeXml(m[1])) : undefined;
  };
  const orientations = array("UISupportedInterfaceOrientations");
  const orientation = orientations?.length
    ? orientations.every((o) => o.includes("Landscape"))
      ? "landscape"
      : "portrait"
    : undefined;
  return {
    displayName: string("CFBundleDisplayName") ?? string("CFBundleName"),
    orientation,
    localizations: array("CFBundleLocalizations"),
  };
}

/**
 * Bundle id and device family of the app target, from the first project.pbxproj
 * under ios/. Extensions and tests have their own build settings; the app's
 * bundle id is the shortest, since theirs extend it (com.x.app.widget).
 */
function readXcodeProject(root: string): { bundleId?: string; ipad: boolean } | undefined {
  const ios = path.join(root, "ios");
  if (!dirExists(ios)) return undefined;
  const capacitor = path.join(ios, "App");
  const dirs = [ios, ...(dirExists(capacitor) ? [capacitor] : [])];
  for (const d of dirs) {
    const proj = fs.readdirSync(d).find((f) => f.endsWith(".xcodeproj"));
    if (!proj) continue;
    const file = path.join(d, proj, "project.pbxproj");
    if (!fileExists(file)) continue;
    const settings = [...fs.readFileSync(file, "utf8").matchAll(/buildSettings = \{([^{}]*)\}/g)].map((m) => {
      const block = m[1];
      return {
        bundleId: /PRODUCT_BUNDLE_IDENTIFIER = "?([^";]+)"?;/.exec(block)?.[1],
        families: /TARGETED_DEVICE_FAMILY = "?([\d,]+)"?;/.exec(block)?.[1],
      };
    });
    const ids = settings
      .map((s) => s.bundleId)
      .filter((id): id is string => !!id && !id.includes("$(") && !/tests?$/i.test(id));
    const bundleId = ids.sort((a, b) => a.length - b.length)[0];
    const families = settings.filter((s) => !bundleId || s.bundleId === bundleId).map((s) => s.families ?? "");
    return { bundleId, ipad: families.some((f) => f.split(",").includes("2")) };
  }
  return undefined;
}

function readPackageJson(root: string): Record<string, unknown> | undefined {
  const file = path.join(root, "package.json");
  if (!fileExists(file)) return undefined;
  try {
    return readJsonFile(file) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

function unescapeXml(s: string): string {
  return s
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&amp;", "&");
}

/** The first candidate with a value, with its source. The last candidate is the fallback. */
function first<T>(...candidates: [T | undefined, Source][]): [T, Source] {
  for (const [value, source] of candidates) {
    if (value !== undefined) return [value, source];
  }
  const [value, source] = candidates[candidates.length - 1];
  return [value as T, source];
}
