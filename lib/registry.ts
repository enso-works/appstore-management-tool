import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CONFIG_FILENAME, loadProject, type Project } from "./config";
import { listRegistered } from "./registered";

/**
 * The workspace root is the directory that contains `tools/store-shots`
 * (i.e. three levels above this file) unless STORE_SHOTS_WORKSPACE overrides it.
 */
export function defaultWorkspaceRoot(): string {
  if (process.env.STORE_SHOTS_WORKSPACE) return path.resolve(process.env.STORE_SHOTS_WORKSPACE);
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, "..", "..", "..");
}

const SKIP_DIRS = new Set(["node_modules", ".git", ".next", "ios", "android", "build", "dist", ".expo", "fixtures"]);

export interface DiscoveredProject {
  root: string;
  configPath: string;
  /** Directory name relative to the workspace, e.g. "breathe". */
  name: string;
  project?: Project;
  error?: string;
}

/** Load one registered or discovered directory into the shape the UI renders. */
function toEntry(root: string, name: string): DiscoveredProject {
  const configPath = path.join(root, CONFIG_FILENAME);
  const entry: DiscoveredProject = { root, configPath, name };
  try {
    entry.project = loadProject(configPath);
  } catch (err) {
    entry.error = (err as Error).message;
  }
  return entry;
}

/**
 * What the UI and `projects` show: the apps you registered, or - only while you
 * have registered none - whatever scanning turns up, so a fresh clone is not an
 * empty screen. Scanning is a fallback, never a merge: once you have registered
 * anything, the list is exactly what you asked for and nothing else.
 */
export function listProjects(): DiscoveredProject[] {
  const registered = listRegistered();
  if (registered.length > 0) {
    return registered.map((p) => toEntry(p.root, p.name));
  }
  return discoverProjects();
}

/** True when the list above is coming from a scan rather than the registry. */
export function isFallbackListing(): boolean {
  return listRegistered().length === 0;
}

/** Find every directory (up to `maxDepth` below the workspace) that has a config. */
export function discoverProjects(workspaceRoot = defaultWorkspaceRoot(), maxDepth = 2): DiscoveredProject[] {
  const found: DiscoveredProject[] = [];
  walk(workspaceRoot, 0);
  found.sort((a, b) => a.name.localeCompare(b.name));
  return found;

  function walk(dir: string, depth: number) {
    const candidate = path.join(dir, CONFIG_FILENAME);
    if (depth > 0 && fs.existsSync(candidate)) {
      const entry: DiscoveredProject = {
        root: dir,
        configPath: candidate,
        name: path.relative(workspaceRoot, dir).split(path.sep).join("/"),
      };
      try {
        entry.project = loadProject(candidate);
      } catch (err) {
        entry.error = (err as Error).message;
      }
      found.push(entry);
      return; // do not descend into an app
    }
    if (depth >= maxDepth) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (!e.isDirectory() || e.name.startsWith(".") || SKIP_DIRS.has(e.name)) continue;
      walk(path.join(dir, e.name), depth + 1);
    }
  }
}
