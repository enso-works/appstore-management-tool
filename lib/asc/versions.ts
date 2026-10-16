import type { Project } from "../config";
import { findAscKey } from "./auth";
import type { AscClient } from "./client";
import { appBundleId, AscStatusError, compareVersions, fetchVersions, findAscApp, type AscVersion } from "./status";

/**
 * Where the app stands in App Store Connect at a glance: the live version and
 * the one in progress ("2.1.0 Live · 2.2.0 Waiting for review"), for the Mac
 * app's overview and toolbar. One call once the app's id is known, and the
 * engine keeps the answer for five minutes. Read-only.
 */

export type AscVersions =
  | { connected: false; reason: string }
  | {
      connected: true;
      app: { id: string; name: string; bundleId: string };
      /** Newest first. */
      versions: AscVersion[];
      /** On the store now. */
      live?: AscVersion;
      /** The newer version being worked on or reviewed, if any. */
      next?: AscVersion;
      /** When App Store Connect was read (ISO). */
      readAt: string;
    };

export const VERSIONS_TTL_MS = 5 * 60 * 1000;

const LIVE_STATES = new Set(["READY_FOR_DISTRIBUTION", "READY_FOR_SALE"]);
/** States a version is left in once another has replaced it or it left the store. */
const PAST_STATES = new Set(["REPLACED_WITH_NEW_VERSION", "REMOVED_FROM_SALE", "DEVELOPER_REMOVED_FROM_SALE"]);

/** The live version and the newer one in progress, from versions in any order. */
export function liveAndNext(versions: AscVersion[]): { live?: AscVersion; next?: AscVersion } {
  const newest = [...versions].sort((a, b) => compareVersions(b.version, a.version));
  const live = newest.find((v) => v.state && LIVE_STATES.has(v.state));
  const next = newest.find(
    (v) =>
      v !== live &&
      !(v.state && (LIVE_STATES.has(v.state) || PAST_STATES.has(v.state))) &&
      (!live || compareVersions(v.version, live.version) > 0),
  );
  return { live, next };
}

/** App records by app folder: they do not change while the engine runs (unless the bundle id does). */
const appIds = new Map<string, { id: string; name: string; bundleId: string }>();
const answers = new Map<string, { at: number; value: AscVersions }>();

/**
 * The app's versions, from the cache when read less than five minutes ago
 * (`fresh` reads again). No key, no bundle id or no App Store Connect record
 * is `connected: false`, not an error; a key that does not sign or an API
 * failure throws.
 */
export async function ascVersions(
  project: Project,
  client: () => AscClient,
  opts: { fresh?: boolean; now?: number } = {},
): Promise<AscVersions> {
  const now = opts.now ?? Date.now();
  if (!findAscKey(project)) return { connected: false, reason: "No App Store Connect key for this app" };
  const cached = answers.get(project.root);
  if (!opts.fresh && cached && now - cached.at < VERSIONS_TTL_MS) return cached.value;

  let value: AscVersions;
  try {
    const c = client();
    const known = appIds.get(project.root);
    const app = known && known.bundleId === appBundleId(project) ? known : await findAscApp(project, c);
    appIds.set(project.root, app);
    const versions = await fetchVersions(c, app.id);
    value = { connected: true, app, versions, ...liveAndNext(versions), readAt: new Date(now).toISOString() };
  } catch (err) {
    if (!(err instanceof AscStatusError)) throw err;
    value = { connected: false, reason: err.message };
  }
  answers.set(project.root, { at: now, value });
  return value;
}

/** Forget every cached answer (tests). */
export function clearVersionsCache() {
  appIds.clear();
  answers.clear();
}
