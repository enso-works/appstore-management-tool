import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { CONFIG_FILENAME } from "./config";

/**
 * Apps register themselves when `init` runs inside them, so the tool works on a
 * list you built rather than on whatever happened to sit near it on disk.
 * The list is per machine because the config it points at already lives in each
 * app's own repo - duplicating it there would make two sources of truth.
 */
export interface RegisteredProject {
  /** Absolute path to the app directory. */
  root: string;
  /** Display name; defaults to the directory name, unique within the list. */
  name: string;
  addedAt: string;
}

export function registryDir(): string {
  return process.env.STORE_SHOTS_HOME
    ? path.resolve(process.env.STORE_SHOTS_HOME)
    : path.join(os.homedir(), ".store-shots");
}

export function registryPath(): string {
  return path.join(registryDir(), "projects.json");
}

function read(): RegisteredProject[] {
  try {
    const raw = fs.readFileSync(registryPath(), "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed?.projects) ? parsed.projects : [];
  } catch {
    return [];
  }
}

function write(projects: RegisteredProject[]) {
  fs.mkdirSync(registryDir(), { recursive: true });
  // Written via a temp file so an interrupted write cannot leave the list
  // truncated - losing the registry would look like every app vanished.
  const tmp = `${registryPath()}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify({ version: 1, projects }, null, 2)}\n`);
  fs.renameSync(tmp, registryPath());
}

/** Registered entries whose directory and config still exist. */
export function listRegistered(): RegisteredProject[] {
  return read()
    .filter((p) => fs.existsSync(path.join(p.root, CONFIG_FILENAME)))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Entries pointing at a directory that has gone away or lost its config. */
export function listStale(): RegisteredProject[] {
  return read().filter((p) => !fs.existsSync(path.join(p.root, CONFIG_FILENAME)));
}

/**
 * Idempotent: registering the same directory twice updates it rather than
 * adding a duplicate, so `init --force` and a re-run behave the same.
 */
export function register(root: string, name?: string): RegisteredProject {
  const resolved = path.resolve(root);
  const projects = read().filter((p) => path.resolve(p.root) !== resolved);
  const taken = new Set(projects.map((p) => p.name));

  let candidate = name?.trim() || path.basename(resolved);
  if (taken.has(candidate)) {
    // Two apps can share a directory name; disambiguate with the parent rather
    // than refusing, so registering never fails on a name collision.
    const parent = path.basename(path.dirname(resolved));
    candidate = taken.has(`${parent}/${candidate}`) ? resolved : `${parent}/${candidate}`;
  }

  const entry: RegisteredProject = {
    root: resolved,
    name: candidate,
    addedAt: new Date().toISOString(),
  };
  projects.push(entry);
  write(projects);
  return entry;
}

/** Returns true when something was actually removed. */
export function unregister(rootOrName: string): boolean {
  const resolved = path.resolve(rootOrName);
  const projects = read();
  const kept = projects.filter(
    (p) => path.resolve(p.root) !== resolved && p.name !== rootOrName,
  );
  if (kept.length === projects.length) return false;
  write(kept);
  return true;
}

export function pruneStale(): RegisteredProject[] {
  const stale = listStale();
  if (stale.length > 0) write(listRegistered());
  return stale;
}
