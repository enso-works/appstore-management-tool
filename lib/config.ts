import fs from "node:fs";
import path from "node:path";
import { formatZodError, projectConfigSchema, type ProjectConfig } from "./schema";
import { fileExists, resolveWithin } from "./paths";
import { IssueList } from "./issues";

export const CONFIG_FILENAME = "store-shots.config.json";

export interface ProjectPaths {
  manifest: string;
  content: string;
  raw: string;
  assets: string;
  outputScreenshots: string;
  outputPlay: string;
  metadata: string;
  generated: string;
  appJson: string;
}

export interface Project {
  /** Absolute app root: the directory containing store-shots.config.json. */
  root: string;
  configPath: string;
  config: ProjectConfig;
  paths: ProjectPaths;
}

export class ConfigError extends Error {
  constructor(
    message: string,
    public readonly issues: IssueList = new IssueList(),
  ) {
    super(message);
    this.name = "ConfigError";
  }
}

/** Walk up from `startDir` to find the nearest store-shots.config.json. */
export function findConfigPath(startDir: string): string | undefined {
  let dir = path.resolve(startDir);
  for (;;) {
    const candidate = path.join(dir, CONFIG_FILENAME);
    if (fileExists(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

/**
 * Resolve a `--project` argument: a directory containing the config, a
 * config file path, or (when omitted) a walk up from cwd.
 */
export function resolveProjectArg(arg: string | undefined, cwd = process.cwd()): string {
  if (!arg) {
    const found = findConfigPath(cwd);
    if (!found) {
      throw new ConfigError(
        `No ${CONFIG_FILENAME} found in ${cwd} or any parent. Pass --project <app-dir> or run \`store-shots init\`.`,
      );
    }
    return found;
  }
  const abs = path.resolve(cwd, arg);
  if (fileExists(abs)) return abs;
  const inDir = path.join(abs, CONFIG_FILENAME);
  if (fileExists(inDir)) return inDir;
  throw new ConfigError(`No ${CONFIG_FILENAME} at ${abs}`);
}

export function readJsonFile(file: string): unknown {
  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch (err) {
    throw new ConfigError(`Cannot read ${file}: ${(err as Error).message}`);
  }
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new ConfigError(`Invalid JSON in ${file}: ${(err as Error).message}`);
  }
}

export function loadProject(configPath: string): Project {
  const abs = path.resolve(configPath);
  const root = path.dirname(abs);
  const raw = readJsonFile(abs);
  const parsed = projectConfigSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = new IssueList();
    for (const msg of formatZodError(parsed.error)) {
      issues.error("config.schema", msg, { file: CONFIG_FILENAME });
    }
    throw new ConfigError(`Invalid ${CONFIG_FILENAME}:\n- ${formatZodError(parsed.error).join("\n- ")}`, issues);
  }
  const config = parsed.data;

  const semantic = validateConfigSemantics(config);
  if (semantic.hasErrors) {
    throw new ConfigError(
      `Invalid ${CONFIG_FILENAME}:\n- ${semantic.errors.map((i) => i.message).join("\n- ")}`,
      semantic,
    );
  }

  const p = config.paths;
  const paths: ProjectPaths = {
    manifest: resolveWithin(root, p.manifest),
    content: resolveWithin(root, p.content),
    raw: resolveWithin(root, p.raw),
    assets: resolveWithin(root, p.assets),
    outputScreenshots: resolveWithin(root, p.outputScreenshots),
    outputPlay: resolveWithin(root, p.outputPlay),
    metadata: resolveWithin(root, p.metadata),
    generated: resolveWithin(root, p.generated),
    appJson: path.join(root, "app.json"),
  };

  return { root, configPath: abs, config, paths };
}

/** Cross-field rules that Zod cannot express cleanly. */
export function validateConfigSemantics(config: ProjectConfig): IssueList {
  const issues = new IssueList();
  if (!config.locales.includes(config.defaultLocale)) {
    issues.error("config.default-locale", `defaultLocale "${config.defaultLocale}" is not in locales`, {
      file: CONFIG_FILENAME,
    });
  }
  const dupes = config.locales.filter((l, i) => config.locales.indexOf(l) !== i);
  if (dupes.length) {
    issues.error("config.duplicate-locale", `duplicate locales: ${[...new Set(dupes)].join(", ")}`, {
      file: CONFIG_FILENAME,
    });
  }
  const dupeTargets = config.targets.filter((t, i) => config.targets.indexOf(t) !== i);
  if (dupeTargets.length) {
    issues.error("config.duplicate-target", `duplicate targets: ${[...new Set(dupeTargets)].join(", ")}`, {
      file: CONFIG_FILENAME,
    });
  }
  for (const t of Object.keys(config.sourceDevices)) {
    if (!config.targets.includes(t)) {
      issues.warn("config.source-device-unused", `sourceDevices entry "${t}" is not in targets`, {
        file: CONFIG_FILENAME,
      });
    }
  }
  const spt = config.validation.screensPerTarget;
  if (spt.min > spt.max) {
    issues.error("config.screens-per-target", `validation.screensPerTarget.min (${spt.min}) > max (${spt.max})`, {
      file: CONFIG_FILENAME,
    });
  }
  return issues;
}

/** Raw-capture device folder for a target (config override, else target family). */
export function sourceDeviceFor(project: Project, targetId: string): string {
  return project.config.sourceDevices[targetId] ?? defaultSourceDevice(targetId);
}

function defaultSourceDevice(targetId: string): string {
  // family is the first dash-separated token of every registry id.
  return targetId.split("-")[0];
}

/** Read app.json (Expo shape {expo: {...}} or flat). Missing file -> undefined. */
export function readAppJson(project: Project): Record<string, unknown> | undefined {
  if (!fileExists(project.paths.appJson)) return undefined;
  const raw = readJsonFile(project.paths.appJson);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new ConfigError(`app.json must be a JSON object (${project.paths.appJson})`);
  }
  const obj = raw as Record<string, unknown>;
  const expo = "expo" in obj ? obj.expo : obj;
  if (!expo || typeof expo !== "object" || Array.isArray(expo)) {
    throw new ConfigError(`app.json "expo" must be an object (${project.paths.appJson})`);
  }
  return expo as Record<string, unknown>;
}
