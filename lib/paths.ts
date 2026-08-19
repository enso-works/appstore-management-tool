import fs from "node:fs";
import path from "node:path";

export class PathEscapeError extends Error {
  constructor(
    public readonly root: string,
    public readonly attempted: string,
  ) {
    super(`Path "${attempted}" resolves outside the app root "${root}"`);
    this.name = "PathEscapeError";
  }
}

function isInside(root: string, candidate: string): boolean {
  const rel = path.relative(root, candidate);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

/**
 * Resolve `relative` against `root` and refuse anything that lands outside
 * the root, including via `..` segments or symlinks that already exist.
 * Paths that do not exist yet are checked lexically only (their nearest
 * existing ancestor is checked for symlink escapes).
 */
export function resolveWithin(root: string, relative: string): string {
  const absRoot = path.resolve(root);
  const resolved = path.resolve(absRoot, relative);
  if (!isInside(absRoot, resolved)) throw new PathEscapeError(absRoot, relative);

  // Symlink check on the nearest existing ancestor.
  let probe = resolved;
  while (!fs.existsSync(probe)) {
    const parent = path.dirname(probe);
    if (parent === probe) break;
    probe = parent;
  }
  const realRoot = safeRealpath(absRoot);
  const realProbe = safeRealpath(probe);
  if (!isInside(realRoot, realProbe)) throw new PathEscapeError(absRoot, relative);
  return resolved;
}

function safeRealpath(p: string): string {
  try {
    return fs.realpathSync.native(p);
  } catch {
    return path.resolve(p);
  }
}

/** Forward-slash relative path for display and manifests. */
export function displayRelative(root: string, absolute: string): string {
  return path.relative(root, absolute).split(path.sep).join("/");
}

export function fileExists(p: string): boolean {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

export function dirExists(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}
