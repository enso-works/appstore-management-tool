import fs from "node:fs";
import path from "node:path";
import type { Project } from "./config";
import { fileExists } from "./paths";
import { formatZodError, generatedManifestSchema, type GeneratedManifest } from "./schema";

export const GENERATED_MANIFEST = ".store-shots-manifest.json";

export function generatedManifestPath(project: Project): string {
  return path.join(project.paths.outputScreenshots, GENERATED_MANIFEST);
}

export function readGeneratedManifest(project: Project): GeneratedManifest | undefined {
  const file = generatedManifestPath(project);
  if (!fileExists(file)) return undefined;
  const parsed = generatedManifestSchema.safeParse(JSON.parse(fs.readFileSync(file, "utf8")));
  if (!parsed.success) throw new Error(`${file}: ${formatZodError(parsed.error).join("; ")}`);
  return parsed.data;
}

export function writeGeneratedManifest(project: Project, manifest: GeneratedManifest): void {
  fs.mkdirSync(project.paths.outputScreenshots, { recursive: true });
  const file = generatedManifestPath(project);
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(manifest, null, 2) + "\n");
  fs.renameSync(tmp, file);
}

export interface CleanResult {
  deleted: string[];
  missing: string[];
  manifestRemoved: boolean;
}

/**
 * Delete only the files the previous generation recorded (plan §11). Never
 * touches anything else under fastlane/screenshots, never removes directories.
 */
export function cleanGenerated(project: Project, { keepManifest = false } = {}): CleanResult {
  const manifest = readGeneratedManifest(project);
  const result: CleanResult = { deleted: [], missing: [], manifestRemoved: false };
  if (!manifest) return result;
  for (const f of manifest.files) {
    const abs = path.join(project.paths.outputScreenshots, f.path);
    const rel = path.relative(project.paths.outputScreenshots, abs);
    if (rel.startsWith("..") || path.isAbsolute(rel)) continue; // never follow an escaping entry
    if (fileExists(abs)) {
      fs.rmSync(abs);
      result.deleted.push(f.path);
    } else {
      result.missing.push(f.path);
    }
  }
  if (!keepManifest) {
    fs.rmSync(generatedManifestPath(project), { force: true });
    result.manifestRemoved = true;
  }
  return result;
}
