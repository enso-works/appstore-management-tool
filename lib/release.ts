import fs from "node:fs";
import path from "node:path";
import { readAppJson, type Project } from "./config";
import { validateProject } from "./validate";
import { resolveFontStack } from "./fonts";
import { buildRenderPlan } from "./render-plan";
import { readGeneratedManifest } from "./generated-manifest";
import { inputsHash, templatesSourceHash, readToolVersion } from "./generate";
import { fileExists } from "./paths";

/* ------------------------------------------------------------------ *
 * Release review (editor Release tab)
 *
 * The Store tab answers "is the listing complete?"; this module answers
 * "are the generated files the ones we are about to ship, and has a human
 * looked at each locale?". Status is computed with the same inputs hash the
 * incremental renderer uses, so "stale" here means exactly "generate would
 * re-render this file".
 * ------------------------------------------------------------------ */

export type ShotState = "ok" | "stale" | "missing" | "blocked";

export interface ReleaseShot {
  /** Path relative to fastlane/screenshots/, usable with the file API (kind=shot). */
  rel: string;
  screen: string;
  slice: number;
  state: ShotState;
  /** Why the job cannot render (state "blocked"), e.g. a missing raw capture. */
  reason?: string;
}

export interface ReleaseSet {
  target: string;
  locale: string;
  shots: ReleaseShot[];
  ok: number;
  stale: number;
  missing: number;
  blocked: number;
}

export interface ReleaseStatus {
  appVersion?: string;
  generatedAt?: string;
  /** appVersion recorded by the last generate run, if any. */
  generatedFor?: string;
  sets: ReleaseSet[];
  signoffs: ReleaseSignoffs["signoffs"];
  /** Sign-offs were made for a different app version and no longer count. */
  signoffsStale: boolean;
}

export interface ReleaseSignoffs {
  /** expo.version the sign-offs apply to; a version bump resets them. */
  appVersion?: string;
  signoffs: Record<string, { at: string }>;
}

const SIGNOFF_FILE = "release-signoff.json";

function signoffPath(project: Project): string {
  return path.join(path.dirname(project.paths.manifest), SIGNOFF_FILE);
}

export function appVersionOf(project: Project): string | undefined {
  const v = readAppJson(project)?.version;
  return typeof v === "string" ? v : undefined;
}

export function readSignoffs(project: Project): ReleaseSignoffs {
  const file = signoffPath(project);
  if (!fileExists(file)) return { signoffs: {} };
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8")) as Partial<ReleaseSignoffs>;
    return {
      appVersion: typeof raw.appVersion === "string" ? raw.appVersion : undefined,
      signoffs: raw.signoffs && typeof raw.signoffs === "object" ? raw.signoffs : {},
    };
  } catch {
    return { signoffs: {} };
  }
}

/**
 * Mark or clear one locale's review. Sign-offs are tied to the current
 * expo.version: the first write after a version bump starts a fresh file.
 */
export function setSignoff(project: Project, locale: string, reviewed: boolean): ReleaseSignoffs {
  const version = appVersionOf(project);
  let state = readSignoffs(project);
  if (state.appVersion !== version) state = { appVersion: version, signoffs: {} };
  if (reviewed) state.signoffs[locale] = { at: new Date().toISOString() };
  else delete state.signoffs[locale];
  const file = signoffPath(project);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2) + "\n");
  fs.renameSync(tmp, file);
  return state;
}

/**
 * One entry per planned output file, grouped per target x locale, each marked
 * ok / stale / missing / blocked with the renderer's own change detection.
 */
export function releaseStatus(project: Project): ReleaseStatus {
  const validation = validateProject(project);
  const manifest = readGeneratedManifest(project);
  const groups = new Map<string, ReleaseSet>();
  const outRoot = project.paths.outputScreenshots;

  if (validation.manifest) {
    const plan = buildRenderPlan(project, validation.manifest);
    const { stack: fontStack } = resolveFontStack(project);
    const fontHashes = fontStack.flatMap((f) => f.files.map((x) => x.sha256));
    const templatesHash = templatesSourceHash();
    const toolVersion = readToolVersion();

    for (const job of plan) {
      const key = `${job.target.id}/${job.locale}`;
      let set = groups.get(key);
      if (!set) {
        set = { target: job.target.id, locale: job.locale, shots: [], ok: 0, stale: 0, missing: 0, blocked: 0 };
        groups.set(key, set);
      }
      const content = validation.content.get(job.locale);
      const sourceMissing = job.sourceError ?? (!fs.existsSync(job.sourcePath) ? "raw capture not found" : undefined);
      const hash =
        content && !sourceMissing
          ? inputsHash(project, job, content, toolVersion, fontHashes, templatesHash)
          : undefined;
      job.outputPaths.forEach((abs, slice) => {
        const rel = path.relative(outRoot, abs).split(path.sep).join("/");
        const entry = manifest?.files.find((f) => f.path === path.relative(project.root, abs).split(path.sep).join("/"));
        const exists = fs.existsSync(abs);
        let state: ShotState;
        let reason: string | undefined;
        if (!exists) {
          state = "blocked";
          if (sourceMissing) reason = sourceMissing;
          else if (!content) reason = "no copy for this locale";
          else state = "missing";
        } else if (!hash) {
          // Output exists but its inputs cannot be hashed right now (capture or
          // copy gone): the file is there, but a regenerate would not reproduce it.
          state = "stale";
          reason = sourceMissing ?? "no copy for this locale";
        } else if (entry?.inputsSha256 === hash) {
          state = "ok";
        } else {
          state = "stale";
          reason = entry ? "inputs changed since the last generate" : "not recorded by the last generate";
        }
        set!.shots.push({ rel, screen: job.screen.id, slice, state, reason });
        set![state === "ok" ? "ok" : state === "stale" ? "stale" : state === "missing" ? "missing" : "blocked"]++;
      });
    }
  }

  const signoff = readSignoffs(project);
  const appVersion = appVersionOf(project);
  return {
    appVersion,
    generatedAt: manifest?.generatedAt,
    generatedFor: manifest?.appVersion,
    sets: [...groups.values()],
    signoffs: signoff.signoffs,
    signoffsStale: Object.keys(signoff.signoffs).length > 0 && signoff.appVersion !== appVersion,
  };
}
