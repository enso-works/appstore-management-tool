import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { CONFIG_FILENAME } from "./config";
import { listRegistered, register } from "./registered";

/**
 * `store-shots open`: an app in the Store Shots Mac app, which is the editor
 * (there is no browser editor). The Mac app handles storeshots://open?app=<name>,
 * whether it is running or not; it starts the engine itself.
 */
export const OPEN_SCHEME = "storeshots";

export function openLink(name?: string): string {
  return `${OPEN_SCHEME}://open${name ? `?app=${encodeURIComponent(name)}` : ""}`;
}

export class OpenError extends Error {}

/**
 * Which app to open: a name in the list, a directory (added to the list when it
 * has a config but is not in it yet), else the app you are standing in. None:
 * the Mac app opens on its list of apps.
 */
export function resolveOpenTarget(target?: string, cwd = process.cwd()): string | undefined {
  const registered = listRegistered();
  if (target) {
    const byName = registered.find((p) => p.name === target);
    if (byName) return byName.name;
  }
  const dir = path.resolve(cwd, target ?? ".");
  const byRoot = registered.find((p) => {
    const root = path.resolve(p.root);
    return dir === root || dir.startsWith(`${root}${path.sep}`);
  });
  if (byRoot) return byRoot.name;
  if (fs.existsSync(path.join(dir, CONFIG_FILENAME))) return register(dir).name;
  if (target) {
    throw new OpenError(
      `Not in your list: ${target}. Run \`store-shots projects\` to see what is there, or \`store-shots init\` in the app.`,
    );
  }
  return undefined;
}

export function openInMacApp(target?: string): string {
  if (process.platform !== "darwin") {
    throw new OpenError("The Store Shots editor is a Mac app. Everywhere else, use the commands (store-shots --help).");
  }
  const name = resolveOpenTarget(target);
  const link = openLink(name);
  const r = spawnSync("open", [link], { encoding: "utf8" });
  if (r.status !== 0) {
    throw new OpenError(
      "The Store Shots Mac app is not installed. Build it with `sh mac/build.sh` in the store-shots folder and open it once.",
    );
  }
  return name ?? "";
}
