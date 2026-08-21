import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { sourceDeviceFor, type Project } from "./config";
import { loadManifest } from "./content";
import type { ScreenDefinition } from "./schema";
import { buildJob } from "./render-plan";
import { readPngInfo } from "./png";
import { getTarget } from "./targets";

/**
 * Capture helper (plan §7.4): there is no `snapshot` harness in these Expo
 * apps, so the user drives the simulator by hand and this helper takes the
 * screenshot with `xcrun simctl io` and files it where the manifest expects it.
 */
export interface BootedSimulator {
  udid: string;
  name: string;
  /** "iPhone" | "iPad" | other */
  family: string;
  runtime: string;
}

export function listBootedSimulators(exec: typeof execFileSync = execFileSync): BootedSimulator[] {
  let out: string;
  try {
    out = exec("xcrun", ["simctl", "list", "devices", "booted", "-j"], { encoding: "utf8" }) as string;
  } catch (err) {
    throw new Error(`xcrun simctl failed (is Xcode installed?): ${(err as Error).message}`);
  }
  const json = JSON.parse(out) as { devices: Record<string, { udid: string; name: string; state: string }[]> };
  const result: BootedSimulator[] = [];
  for (const [runtime, devices] of Object.entries(json.devices)) {
    for (const d of devices) {
      if (d.state !== "Booted") continue;
      const family = /ipad/i.test(d.name) ? "iPad" : /iphone/i.test(d.name) ? "iPhone" : "other";
      result.push({ udid: d.udid, name: d.name, family, runtime: runtime.split(".").pop() ?? runtime });
    }
  }
  return result;
}

export interface CaptureOptions {
  device: string; // raw-capture device folder, e.g. "iphone" | "ipad"
  locale: string;
  screenId: string;
  udid?: string;
  /** Override the status bar to 9:41, full battery/signal before capturing. */
  cleanStatusBar?: boolean;
  /** Overwrite an existing capture. */
  force?: boolean;
  exec?: typeof execFileSync;
  spawn?: typeof spawnSync;
}

export interface CaptureResult {
  file: string;
  simulator: BootedSimulator;
  width: number;
  height: number;
  expectedAspect?: number;
  aspectWarning?: string;
}

/** Resolve the target path for a capture from the manifest (same interpolation as rendering). */
export function capturePathFor(
  project: Project,
  device: string,
  locale: string,
  screenId: string,
): { file: string; targetId?: string } {
  const { manifest } = loadManifest(project);
  const screen = manifest?.screens.find((s) => s.id === screenId);
  if (!screen) throw new Error(`Screen "${screenId}" is not in ${project.config.paths.manifest}`);
  if (!screen.source.localized && locale !== project.config.defaultLocale) {
    throw new Error(
      `Screen "${screenId}" has source.localized=false: one capture (${project.config.defaultLocale}) is used for every locale. Capture it with --locale ${project.config.defaultLocale}, or set localized to true in the manifest.`,
    );
  }
  const targetId = project.config.targets.find((t) => sourceDeviceFor(project, t) === device);
  const job = buildJob(project, screen, targetId ?? project.config.targets[0], locale);
  if (!job) throw new Error(`Cannot resolve a capture path for ${device}/${locale}/${screenId}`);
  // buildJob uses the target's source device; when the requested device differs (no target maps to it),
  // substitute it in the path so the file still lands under raw/<device>/.
  const file = targetId
    ? job.sourcePath
    : job.sourcePath.replace(`${path.sep}${job.sourceDevice}${path.sep}`, `${path.sep}${device}${path.sep}`);
  if (job.sourceError) throw new Error(job.sourceError);
  return { file, targetId };
}

export function captureScreen(project: Project, opts: CaptureOptions): CaptureResult {
  const exec = opts.exec ?? execFileSync;
  const spawn = opts.spawn ?? spawnSync;
  const booted = listBootedSimulators(exec);
  if (booted.length === 0) throw new Error("No booted simulator. Boot one in Xcode/Simulator first.");
  let sim: BootedSimulator | undefined;
  if (opts.udid) sim = booted.find((b) => b.udid === opts.udid);
  else {
    const wantIpad = /ipad|tablet/i.test(opts.device);
    const candidates = booted.filter((b) => (wantIpad ? b.family === "iPad" : b.family === "iPhone"));
    if (candidates.length > 1) {
      throw new Error(
        `Several ${wantIpad ? "iPad" : "iPhone"} simulators are booted; pass --udid:\n` +
          candidates.map((c) => `  ${c.udid}  ${c.name} (${c.runtime})`).join("\n"),
      );
    }
    sim = candidates[0];
  }
  if (!sim)
    throw new Error(
      `No booted ${opts.device} simulator found. Booted: ${booted.map((b) => b.name).join(", ") || "none"}`,
    );

  const { file, targetId } = capturePathFor(project, opts.device, opts.locale, opts.screenId);
  if (fs.existsSync(file) && !opts.force) {
    throw new Error(`${file} already exists; pass --force to overwrite it`);
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });

  if (opts.cleanStatusBar) {
    spawn(
      "xcrun",
      [
        "simctl",
        "status_bar",
        sim.udid,
        "override",
        "--time",
        "9:41",
        "--batteryState",
        "charged",
        "--batteryLevel",
        "100",
        "--wifiBars",
        "3",
        "--cellularBars",
        "4",
        "--operatorName",
        "",
      ],
      { stdio: "ignore" },
    );
  }
  const r = spawn("xcrun", ["simctl", "io", sim.udid, "screenshot", "--type=png", file], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`simctl screenshot failed: ${r.stderr || r.stdout || `exit ${r.status}`}`);

  const info = readPngInfo(file);
  const target = targetId ? getTarget(targetId) : undefined;
  const expectedAspect = target ? target.width / target.height : undefined;
  let aspectWarning: string | undefined;
  if (expectedAspect && Math.abs(info.width / info.height - expectedAspect) > 0.01) {
    aspectWarning = `capture is ${info.width}x${info.height} (aspect ${(info.width / info.height).toFixed(3)}) but ${targetId} needs ${expectedAspect.toFixed(3)}; use a ${target!.family === "ipad" ? "13-inch iPad Pro" : "6.9-inch iPhone (Pro Max)"} simulator`;
  }
  return { file, simulator: sim, width: info.width, height: info.height, expectedAspect, aspectWarning };
}

/** Shell commands to switch a booted simulator to a locale (printed as guidance; not run). */
export function localeSwitchHint(udid: string, locale: string): string[] {
  const lang = locale.split("-")[0];
  return [
    `xcrun simctl spawn ${udid} defaults write "Apple Global Domain" AppleLanguages -array ${lang}`,
    `xcrun simctl spawn ${udid} defaults write "Apple Global Domain" AppleLocale -string ${locale.replace("-", "_")}`,
    `xcrun simctl shutdown ${udid} && xcrun simctl boot ${udid}   # relaunch so the app picks it up`,
  ];
}

export interface CaptureAllOptions extends Omit<CaptureOptions, "screenId"> {
  /** Seconds to wait after opening each deep link before the screenshot (default 2). */
  settleSeconds?: number;
  log?: (line: string) => void;
  sleep?: (ms: number) => Promise<void>;
}

export interface CaptureAllResult {
  captured: CaptureResult[];
  skipped: { screenId: string; reason: string }[];
}

/**
 * Capture every enabled screen in order (roadmap #8). Screens that declare
 * `source.deepLink` are navigated to via `xcrun simctl openurl`; screens
 * without one are skipped with a hint (the user captures those by hand).
 */
export async function captureAll(project: Project, opts: CaptureAllOptions): Promise<CaptureAllResult> {
  const spawn = opts.spawn ?? spawnSync;
  const sleep = opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const log = opts.log ?? (() => {});
  const { manifest } = loadManifest(project);
  if (!manifest) throw new Error(`No manifest at ${project.config.paths.manifest}`);
  const screens = [...manifest.screens].filter((s) => s.enabled).sort((a, b) => a.order - b.order);
  const captured: CaptureResult[] = [];
  const skipped: { screenId: string; reason: string }[] = [];
  for (const screen of screens as ScreenDefinition[]) {
    if (!screen.source.deepLink) {
      skipped.push({ screenId: screen.id, reason: "no source.deepLink in the manifest" });
      continue;
    }
    if (!screen.source.localized && opts.locale !== project.config.defaultLocale) {
      skipped.push({
        screenId: screen.id,
        reason: `localized=false; captured only for ${project.config.defaultLocale}`,
      });
      continue;
    }
    try {
      // Resolve the simulator once per screen (cheap) so --udid and family rules apply.
      const booted = listBootedSimulators(opts.exec ?? execFileSync);
      const sim = opts.udid
        ? booted.find((b) => b.udid === opts.udid)
        : booted.find((b) => (/ipad|tablet/i.test(opts.device) ? b.family === "iPad" : b.family === "iPhone"));
      if (!sim) throw new Error(`no booted ${opts.device} simulator`);
      // Restart the app and open the URL while it is frontmost: SpringBoard
      // shows an "Open in <App>?" confirmation for custom schemes opened from
      // the home screen (seen on the iOS 18.0 iPad runtime), which blocks the
      // run and gets screenshotted; a frontmost app receives the link directly.
      if (project.config.bundleId) {
        spawn("xcrun", ["simctl", "terminate", sim.udid, project.config.bundleId], { encoding: "utf8" });
        await sleep(500);
        spawn("xcrun", ["simctl", "launch", sim.udid, project.config.bundleId], { encoding: "utf8" });
        await sleep(1500);
      }
      const open = spawn("xcrun", ["simctl", "openurl", sim.udid, screen.source.deepLink], { encoding: "utf8" });
      if (open.status !== 0) throw new Error(`openurl failed: ${open.stderr || open.stdout || `exit ${open.status}`}`);
      log(`open ${screen.source.deepLink}`);
      await sleep((opts.settleSeconds ?? 2) * 1000);
      const r = captureScreen(project, { ...opts, screenId: screen.id, force: true });
      captured.push(r);
      log(`captured ${r.file} (${r.width}x${r.height})`);
      if (r.aspectWarning) log(`WARN ${r.aspectWarning}`);
    } catch (err) {
      skipped.push({ screenId: screen.id, reason: (err as Error).message });
      log(`SKIP ${screen.id}: ${(err as Error).message}`);
    }
  }
  return { captured, skipped };
}

/* ------------------------------------------------------------------ *
 * Automated capture (plan section 7.5)
 *
 * Everything below removes the manual half of section 7.4: instead of the
 * operator switching the simulator language, navigating by hand and running
 * `capture` once per screen, `captureLocales` drives the whole matrix.
 * ------------------------------------------------------------------ */

/** Resolve `{today}` / `{today-N}` inside seeded state to YYYY-MM-DD. */
export function resolveDatePlaceholders(value: string, today: Date): string {
  return value.replace(/\{today(?:-(\d+))?\}/g, (_m, back?: string) => {
    const d = new Date(today);
    d.setDate(d.getDate() - (back ? Number(back) : 0));
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${d.getFullYear()}-${m}-${day}`;
  });
}

function resolveDeep(value: unknown, today: Date): unknown {
  if (typeof value === "string") return resolveDatePlaceholders(value, today);
  if (Array.isArray(value)) return value.map((v) => resolveDeep(v, today));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, resolveDeep(v, today)]));
  }
  return value;
}

/**
 * Write the app's AsyncStorage manifest inside the simulator container.
 * AsyncStorage keeps small values inline in `manifest.json`, so seeding is a
 * single JSON write; the app must not be running or it will overwrite this
 * from its in-memory cache on the next mutation.
 */
export function seedAppState(opts: {
  udid: string;
  bundleId: string;
  state: Record<string, unknown>;
  storageDir: string;
  today?: Date;
  exec?: typeof execFileSync;
}): { file: string; keys: string[] } | null {
  const exec = opts.exec ?? execFileSync;
  const keys = Object.keys(opts.state);
  if (!keys.length) return null;
  let container: string;
  try {
    container = (
      exec("xcrun", ["simctl", "get_app_container", opts.udid, opts.bundleId, "data"], { encoding: "utf8" }) as string
    ).trim();
  } catch (err) {
    throw new Error(`app ${opts.bundleId} is not installed on ${opts.udid}: ${(err as Error).message}`);
  }
  const dir = path.join(container, "Library", "Application Support", opts.bundleId, opts.storageDir);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "manifest.json");
  const today = opts.today ?? new Date();
  const existing: Record<string, string> = fs.existsSync(file)
    ? (JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, string>)
    : {};
  for (const [key, raw] of Object.entries(opts.state)) {
    const value = resolveDeep(raw, today);
    existing[key] = typeof value === "string" ? value : JSON.stringify(value);
  }
  fs.writeFileSync(file, JSON.stringify(existing));
  return { file, keys };
}

/** The AppleLanguages value for a store locale (config override, else the locale itself). */
export function appleLanguageFor(locale: string, overrides: Record<string, string> = {}): string {
  return overrides[locale] ?? locale;
}

/** Read the simulator's current language so a run can put it back. */
export function currentSimulatorLanguage(udid: string, exec: typeof execFileSync = execFileSync): string | null {
  try {
    const out = exec("xcrun", ["simctl", "spawn", udid, "defaults", "read", "-g", "AppleLanguages"], {
      encoding: "utf8",
    }) as string;
    const m = out.match(/"?([A-Za-z]{2,3}(?:-[A-Za-z]{2,4})?)"?/);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

/**
 * Switch the simulator language and restart SpringBoard so apps pick it up.
 * Launch arguments (`-AppleLanguages`) do not survive here, and a full
 * shutdown/boot costs about half a minute per locale; kickstarting SpringBoard
 * is the cheap way that actually works.
 */
export function setSimulatorLanguage(opts: {
  udid: string;
  language: string;
  locale?: string;
  spawn?: typeof spawnSync;
}): void {
  const spawn = opts.spawn ?? spawnSync;
  const run = (args: string[]) => {
    const r = spawn("xcrun", args, { encoding: "utf8" });
    if (r.status !== 0) throw new Error(`${args.join(" ")} failed: ${r.stderr || r.stdout || `exit ${r.status}`}`);
  };
  run(["simctl", "spawn", opts.udid, "defaults", "write", "-g", "AppleLanguages", "-array", opts.language]);
  run([
    "simctl",
    "spawn",
    opts.udid,
    "defaults",
    "write",
    "-g",
    "AppleLocale",
    "-string",
    (opts.locale ?? opts.language).replace("-", "_"),
  ]);
  // Not fatal: some runtimes reject the service name but still apply the change.
  spawn("xcrun", ["simctl", "spawn", opts.udid, "launchctl", "kickstart", "-k", "system/com.apple.SpringBoard"], {
    encoding: "utf8",
  });
}

export interface CaptureLocalesOptions {
  device: string;
  /** Store locales to capture, in order. */
  locales: string[];
  udid?: string;
  cleanStatusBar?: boolean;
  settleSeconds?: number;
  /** Skip seeding even when the config declares capture.state. */
  noSeed?: boolean;
  /** Leave the simulator in the last captured language instead of restoring. */
  keepLanguage?: boolean;
  today?: Date;
  log?: (line: string) => void;
  exec?: typeof execFileSync;
  spawn?: typeof spawnSync;
  sleep?: (ms: number) => Promise<void>;
}

export interface CaptureLocalesResult {
  perLocale: { locale: string; captured: number; skipped: { screenId: string; reason: string }[] }[];
  restoredLanguage: string | null;
}

/**
 * Capture every enabled deep-linked screen for each locale, unattended:
 * switch the simulator language, seed a known app state, then walk the screens.
 */
export async function captureLocales(project: Project, opts: CaptureLocalesOptions): Promise<CaptureLocalesResult> {
  const exec = opts.exec ?? execFileSync;
  const spawn = opts.spawn ?? spawnSync;
  const sleep = opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const log = opts.log ?? (() => {});
  const cfg = project.config;

  const booted = listBootedSimulators(exec);
  const sim = opts.udid
    ? booted.find((b) => b.udid === opts.udid)
    : booted.find((b) => (/ipad|tablet/i.test(opts.device) ? b.family === "iPad" : b.family === "iPhone"));
  if (!sim) throw new Error(`no booted ${opts.device} simulator (try: capture --list)`);

  const originalLanguage = currentSimulatorLanguage(sim.udid, exec);
  const perLocale: CaptureLocalesResult["perLocale"] = [];

  try {
    for (const locale of opts.locales) {
      const language = appleLanguageFor(locale, cfg.capture.appleLanguages);
      log(`\n[${locale}] language -> ${language}`);
      setSimulatorLanguage({ udid: sim.udid, language, locale, spawn });
      await sleep((cfg.capture.languageSettleSeconds ?? 8) * 1000);

      if (!opts.noSeed && cfg.bundleId && Object.keys(cfg.capture.state).length) {
        // Seed with the app stopped, or it rewrites the file from memory.
        spawn("xcrun", ["simctl", "terminate", sim.udid, cfg.bundleId], { encoding: "utf8" });
        await sleep(500);
        const seeded = seedAppState({
          udid: sim.udid,
          bundleId: cfg.bundleId,
          state: cfg.capture.state,
          storageDir: cfg.capture.storageDir,
          today: opts.today,
          exec,
        });
        if (seeded) log(`[${locale}] seeded ${seeded.keys.length} storage keys`);
      }

      const r = await captureAll(project, {
        device: opts.device,
        locale,
        udid: sim.udid,
        cleanStatusBar: opts.cleanStatusBar,
        settleSeconds: opts.settleSeconds ?? cfg.capture.settleSeconds,
        log: (l) => log(`[${locale}] ${l}`),
        exec,
        spawn,
        sleep,
      });
      perLocale.push({ locale, captured: r.captured.length, skipped: r.skipped });
    }
  } finally {
    if (!opts.keepLanguage && originalLanguage) {
      setSimulatorLanguage({ udid: sim.udid, language: originalLanguage, spawn });
      log(`\nrestored simulator language to ${originalLanguage}`);
    }
  }

  return { perLocale, restoredLanguage: opts.keepLanguage ? null : originalLanguage };
}
