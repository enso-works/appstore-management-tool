import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const FIXTURE_ROOT = path.resolve(import.meta.dirname, "..", "fixtures", "demo-app");

/** Copy the fixture project into a temp dir so tests can break it freely. */
export function tempFixture(): { root: string; cleanup: () => void } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "store-shots-fixture-"));
  fs.cpSync(FIXTURE_ROOT, root, { recursive: true });
  return { root, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}

export function readJson<T = unknown>(file: string): T {
  return JSON.parse(fs.readFileSync(file, "utf8")) as T;
}

export function writeJson(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n");
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyJson = any;

export function editJson(file: string, mutate: (v: AnyJson) => void): void {
  const v = readJson<AnyJson>(file);
  mutate(v);
  writeJson(file, v);
}
