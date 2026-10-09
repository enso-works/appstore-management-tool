import fs from "node:fs";
import path from "node:path";
import { readJsonFile } from "./config";
import { readExpoConfig } from "./init";
import { dirExists, fileExists } from "./paths";
import type { Orientation } from "./targets";

/**
 * What an app says about itself, whatever it is built with: Expo's app.json,
 * a Capacitor config, or the native iOS project (Info.plist, project.pbxproj,
 * the asset catalog). Import proposes a config from these; readiness and
 * release read the version, icon and device family from them. Nothing here
 * runs the app's code: config files are read as text.
 */

export type AppKind = "expo" | "capacitor" | "native-ios" | "unknown";

/** A value and where it came from, shown next to it so a wrong reading is easy to trace. */
export interface Fact<T> {
  value: T;
  source: string;
}

export interface AppFacts {
  kind: AppKind;
  /** The store version (CFBundleShortVersionString). */
  version?: Fact<string>;
  /** The 1024 px App Store icon. `rel` is relative to the app root. */
  icon?: Fact<{ abs: string; rel: string }>;
  /** Runs on iPad (and so needs an iPad screenshot set). */
  ipad: Fact<boolean>;
  /**
   * The interface style the app declares: "automatic" follows the system
   * (so it has a Dark Mode), "light" or "dark" is fixed. Unset when the app
   * does not say (a native app without UIUserInterfaceStyle).
   */
  interfaceStyle?: Fact<"automatic" | "light" | "dark">;
  /** The icon's dark and tinted variants (iOS 18 and later), when the app has any. */
  iconVariants?: Fact<{ dark: boolean; tinted: boolean }>;
  /** app.json exists but cannot be read; Expo facts are missing because of it. */
  appJsonError?: string;
}

export function appFacts(root: string): AppFacts {
  const { expo, error } = readExpoChecked(root);
  const capacitor = readCapacitor(root);
  const plist = readInfoPlist(root);
  const xcode = readXcodeProject(root);
  const kind: AppKind = expo ? "expo" : capacitor ? "capacitor" : plist || xcode ? "native-ios" : "unknown";
  const expoIos = expo?.ios as { supportsTablet?: unknown } | undefined;

  // An Expo app's ios/ folder is prebuild output, so app.json wins over it.
  const version = pick<string>(
    [str(expo?.version), "app.json version"],
    [xcode?.version, "Xcode project MARKETING_VERSION"],
    [plist?.version, "Info.plist CFBundleShortVersionString"],
  );
  const ipad = pick<boolean>(
    [typeof expoIos?.supportsTablet === "boolean" ? expoIos.supportsTablet : undefined, "app.json ios.supportsTablet"],
    [expo ? false : xcode?.ipad, expo ? "app.json (no ios.supportsTablet)" : "Xcode project TARGETED_DEVICE_FAMILY"],
  ) ?? { value: false, source: "default" };

  let icon: AppFacts["icon"];
  if (expo || error) {
    const rel = str(expo?.icon) ?? "./assets/icon.png";
    icon = { value: { abs: path.resolve(root, rel), rel }, source: expo?.icon ? "app.json icon" : "Expo's default" };
  } else {
    const found = findAppIcon(root, xcode?.iconSet ?? "AppIcon");
    if (found) icon = { value: { abs: found, rel: path.relative(root, found) }, source: "asset catalog" };
  }
  const style = (v: unknown) => (v === "automatic" || v === "light" || v === "dark" ? v : undefined);
  const plistStyle = plist?.interfaceStyle?.toLowerCase();
  const interfaceStyle = pick<"automatic" | "light" | "dark">(
    [
      style((expo?.ios as { userInterfaceStyle?: unknown } | undefined)?.userInterfaceStyle),
      "app.json ios.userInterfaceStyle",
    ],
    [style(expo?.userInterfaceStyle), "app.json userInterfaceStyle"],
    // Expo's default is light. A native app without the key follows the system, but
    // whether it was designed for Dark Mode is unknown, so the fact stays unset.
    [expo ? "light" : undefined, "app.json (no userInterfaceStyle: Expo's default, light)"],
    [
      plistStyle === "light" || plistStyle === "dark" ? plistStyle : plistStyle ? "automatic" : undefined,
      "Info.plist UIUserInterfaceStyle",
    ],
  );

  return {
    kind,
    version,
    icon,
    ipad,
    interfaceStyle,
    iconVariants: iconVariantsOf(root, expo, xcode?.iconSet),
    appJsonError: error,
  };
}

/**
 * Dark and tinted icons: Expo's ios.icon as { light, dark, tinted } or an
 * Icon Composer `.icon` file (which carries its own appearances), else the
 * appearance entries of the asset catalog's icon set.
 */
function iconVariantsOf(
  root: string,
  expo: Record<string, unknown> | undefined,
  iconSet = "AppIcon",
): AppFacts["iconVariants"] {
  if (expo) {
    const icon = (expo.ios as { icon?: unknown } | undefined)?.icon;
    if (typeof icon === "string" && icon.endsWith(".icon")) {
      return { value: { dark: true, tinted: true }, source: "app.json ios.icon (Icon Composer file)" };
    }
    if (icon && typeof icon === "object") {
      const i = icon as { dark?: unknown; tinted?: unknown };
      return { value: { dark: !!str(i.dark), tinted: !!str(i.tinted) }, source: "app.json ios.icon" };
    }
    return { value: { dark: false, tinted: false }, source: "app.json has one icon" };
  }
  const set = findIconSet(root, iconSet);
  if (!set) return undefined;
  const images = readIconSetImages(set);
  const has = (value: string) =>
    images.some(
      (i) => i.filename && (i.appearances ?? []).some((a) => a.appearance === "luminosity" && a.value === value),
    );
  return { value: { dark: has("dark"), tinted: has("tinted") }, source: "asset catalog" };
}

/** app.json as Expo writes it (wrapped or flat), or why it cannot be read. */
function readExpoChecked(root: string): { expo?: Record<string, unknown>; error?: string } {
  try {
    return { expo: readExpoConfig(root) };
  } catch (err) {
    return { error: (err as Error).message };
  }
}

/** app.json as Expo writes it, wrapped or flat; unreadable JSON counts as no app.json. */
export function readExpoSafely(root: string): Record<string, unknown> | undefined {
  return readExpoChecked(root).expo;
}

export function capacitorConfigFile(root: string): string | undefined {
  return ["capacitor.config.json", "capacitor.config.ts", "capacitor.config.js"]
    .map((f) => path.join(root, f))
    .find(fileExists);
}

/** appId and appName from a Capacitor config; the .ts/.js form is read as text, never executed. */
export function readCapacitor(root: string): { appId?: string; appName?: string } | undefined {
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
export function findInfoPlist(root: string): string | undefined {
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

export interface PlistFacts {
  displayName?: string;
  orientation?: Orientation;
  localizations?: string[];
  version?: string;
  /** UIUserInterfaceStyle: Light, Dark or Automatic. */
  interfaceStyle?: string;
}

/** The few Info.plist keys the tool needs, from the XML form source trees keep. */
export function readInfoPlist(root: string): PlistFacts | undefined {
  const file = findInfoPlist(root);
  if (!file) return undefined;
  const xml = fs.readFileSync(file, "utf8");
  const string = (key: string) => {
    const v = new RegExp(`<key>${key}</key>\\s*<string>([^<]*)</string>`).exec(xml)?.[1];
    // Build settings like $(PRODUCT_NAME) are not values.
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
    version: string("CFBundleShortVersionString"),
    interfaceStyle: string("UIUserInterfaceStyle"),
  };
}

export interface XcodeFacts {
  bundleId?: string;
  ipad: boolean;
  version?: string;
  /** The app icon set's name (ASSETCATALOG_COMPILER_APPICON_NAME). */
  iconSet?: string;
}

/**
 * The app target's build settings, from the first project.pbxproj under ios/.
 * Extensions and tests have their own; the app's bundle id is the shortest,
 * since theirs extend it (com.x.app.widget).
 */
export function readXcodeProject(root: string): XcodeFacts | undefined {
  const ios = path.join(root, "ios");
  if (!dirExists(ios)) return undefined;
  const capacitor = path.join(ios, "App");
  const dirs = [ios, ...(dirExists(capacitor) ? [capacitor] : [])];
  for (const d of dirs) {
    const proj = fs.readdirSync(d).find((f) => f.endsWith(".xcodeproj"));
    if (!proj) continue;
    const file = path.join(d, proj, "project.pbxproj");
    if (!fileExists(file)) continue;
    const setting = (block: string, key: string) => new RegExp(`\\b${key} = "?([^";]+)"?;`).exec(block)?.[1];
    const settings = [...fs.readFileSync(file, "utf8").matchAll(/buildSettings = \{([^{}]*)\}/g)].map((m) => ({
      bundleId: setting(m[1], "PRODUCT_BUNDLE_IDENTIFIER"),
      families: setting(m[1], "TARGETED_DEVICE_FAMILY"),
      version: setting(m[1], "MARKETING_VERSION"),
      iconSet: setting(m[1], "ASSETCATALOG_COMPILER_APPICON_NAME"),
    }));
    const ids = settings
      .map((s) => s.bundleId)
      .filter((id): id is string => !!id && !id.includes("$(") && !/tests?$/i.test(id));
    const bundleId = ids.sort((a, b) => a.length - b.length)[0];
    const app = settings.filter((s) => !bundleId || s.bundleId === bundleId);
    return {
      bundleId,
      ipad: app.some((s) => (s.families ?? "").split(",").includes("2")),
      version: app.map((s) => s.version).find((v) => v && !v.includes("$(")),
      iconSet: app.map((s) => s.iconSet).find(Boolean),
    };
  }
  return undefined;
}

/**
 * The 1024 px image of the app icon set in the app's asset catalog: the
 * single-size "universal" entry Xcode 14+ writes, or the older "ios-marketing"
 * one. Dark and tinted variants (with `appearances`) are not the store icon.
 */
export function findAppIcon(root: string, iconSet = "AppIcon"): string | undefined {
  for (const set of findIconSets(root, iconSet)) {
    const image = readIconSetImages(set).find(
      (i) =>
        i.filename &&
        i.size === "1024x1024" &&
        !i.appearances &&
        (i.idiom === "universal" || i.idiom === "ios-marketing"),
    );
    if (image?.filename) return path.join(set, image.filename);
  }
  return undefined;
}

/** `<iconSet>.appiconset` folders under ios/ (the app's catalog, skipping Pods and build output). */
function findIconSets(root: string, iconSet: string): string[] {
  const ios = path.join(root, "ios");
  if (!dirExists(ios)) return [];
  const sets: string[] = [];
  const walk = (dir: string, depth: number) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!e.isDirectory() || e.name === "Pods" || e.name === "build" || e.name.startsWith(".")) continue;
      const full = path.join(dir, e.name);
      if (e.name === `${iconSet}.appiconset`) sets.push(full);
      else if (depth < 5) walk(full, depth + 1);
    }
  };
  walk(ios, 1);
  return sets;
}

/** The icon set that holds the store icon, else the first one found. */
function findIconSet(root: string, iconSet: string): string | undefined {
  const sets = findIconSets(root, iconSet);
  return sets.find((set) => readIconSetImages(set).some((i) => i.filename && i.size === "1024x1024")) ?? sets[0];
}

interface IconSetImage {
  filename?: string;
  size?: string;
  idiom?: string;
  appearances?: { appearance?: string; value?: string }[];
}

function readIconSetImages(set: string): IconSetImage[] {
  try {
    const contents = JSON.parse(fs.readFileSync(path.join(set, "Contents.json"), "utf8")) as {
      images?: IconSetImage[];
    };
    return contents.images ?? [];
  } catch {
    // an unreadable Contents.json is a set without a usable icon
    return [];
  }
}

export function readPackageJson(root: string): Record<string, unknown> | undefined {
  const file = path.join(root, "package.json");
  if (!fileExists(file)) return undefined;
  try {
    return readJsonFile(file) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

export function str(v: unknown): string | undefined {
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

/** The first candidate with a value, with its source. */
function pick<T>(...candidates: [T | undefined, string][]): Fact<T> | undefined {
  for (const [value, source] of candidates) {
    if (value !== undefined) return { value, source };
  }
  return undefined;
}
