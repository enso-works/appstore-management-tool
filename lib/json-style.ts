import fs from "node:fs";
import path from "node:path";
import { CONFIG_FILENAME } from "./config";

/**
 * JSON the way the app formats it. Apps that run Prettier over their files
 * (and check it before a push) would fail on JSON.stringify's layout the moment
 * the editor saves: Prettier puts a short array on one line. So for those apps
 * the tool writes what Prettier would: objects expanded, arrays on one line
 * when they fit the app's printWidth, numbers filled across lines when they
 * do not. Apps without Prettier keep JSON.stringify's layout.
 */

export interface JsonStyle {
  printWidth: number;
  indent: string;
}

const STRINGIFY: JsonStyle | undefined = undefined;

/** The Prettier style of the app that owns `file` (found by walking up to its config), if it uses Prettier. */
export function jsonStyleFor(file: string): JsonStyle | undefined {
  let dir = path.dirname(path.resolve(file));
  for (let i = 0; i < 6; i++) {
    if (fs.existsSync(path.join(dir, CONFIG_FILENAME))) return appJsonStyle(dir);
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return STRINGIFY;
}

/** Prettier's printWidth/tabWidth/useTabs from the app's JSON config or package.json, when it uses Prettier. */
export function appJsonStyle(root: string): JsonStyle | undefined {
  const pkg = readJson(path.join(root, "package.json")) as
    { prettier?: unknown; dependencies?: Record<string, string>; devDependencies?: Record<string, string> } | undefined;
  const configFiles = [".prettierrc", ".prettierrc.json", ".prettierrc.json5"];
  let options: Record<string, unknown> | undefined;
  for (const name of configFiles) {
    const value = readJson(path.join(root, name));
    if (value && typeof value === "object") {
      options = value as Record<string, unknown>;
      break;
    }
  }
  if (!options && pkg?.prettier && typeof pkg.prettier === "object") options = pkg.prettier as Record<string, unknown>;
  const usesPrettier =
    options !== undefined ||
    ["prettier.config.js", "prettier.config.mjs", "prettier.config.cjs", ".prettierrc.js", ".prettierrc.yaml"].some(
      (f) => fs.existsSync(path.join(root, f)),
    ) ||
    Boolean(pkg?.devDependencies?.prettier ?? pkg?.dependencies?.prettier);
  if (!usesPrettier) return STRINGIFY;
  const json = jsonOverride(options);
  const width = Number(json.printWidth ?? options?.printWidth ?? 80);
  const tab = Number(json.tabWidth ?? options?.tabWidth ?? 2);
  const tabs = Boolean(json.useTabs ?? options?.useTabs ?? false);
  return { printWidth: Number.isFinite(width) ? width : 80, indent: tabs ? "\t" : " ".repeat(tab) };
}

/** A Prettier `overrides` entry for *.json files, if the config has one. */
function jsonOverride(options: Record<string, unknown> | undefined): Record<string, unknown> {
  const overrides = Array.isArray(options?.overrides) ? options.overrides : [];
  for (const o of overrides as { files?: unknown; options?: Record<string, unknown> }[]) {
    const files = Array.isArray(o.files) ? o.files : [o.files];
    if (files.some((f) => typeof f === "string" && /\.json\b|\*\.json/.test(f))) return o.options ?? {};
  }
  return {};
}

function readJson(file: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return undefined;
  }
}

/** Serialize with a trailing newline, in the given style (JSON.stringify's when there is none). */
export function formatJson(value: unknown, style?: JsonStyle): string {
  if (!style) return JSON.stringify(value, null, 2) + "\n";
  return print(value, "", 0, false, style) + "\n";
}

/**
 * `column` is where the value starts on its line; `comma` whether a comma
 * follows it there, which counts against the width as it does in Prettier.
 */
function print(value: unknown, indent: string, column: number, comma: boolean, style: JsonStyle): string {
  if (Array.isArray(value)) return printArray(value, indent, column, comma, style);
  if (value !== null && typeof value === "object") return printObject(value as Record<string, unknown>, indent, style);
  return JSON.stringify(value) ?? "null";
}

function printObject(obj: Record<string, unknown>, indent: string, style: JsonStyle): string {
  const entries = Object.entries(obj).filter(([, v]) => v !== undefined);
  if (entries.length === 0) return "{}";
  const inner = indent + style.indent;
  const lines = entries.map(([k, v], i) => {
    const key = `${JSON.stringify(k)}: `;
    const last = i === entries.length - 1;
    return inner + key + print(v, inner, width(inner) + key.length, !last, style) + (last ? "" : ",");
  });
  return `{\n${lines.join("\n")}\n${indent}}`;
}

function printArray(arr: unknown[], indent: string, column: number, comma: boolean, style: JsonStyle): string {
  if (arr.length === 0) return "[]";
  const inner = indent + style.indent;
  const isObject = (v: unknown) => v !== null && typeof v === "object";
  // Prettier breaks an array of several objects (or arrays) even when it would fit.
  const composite = arr.some(isObject);
  if (!composite) {
    const flat = `[${arr.map((v) => JSON.stringify(v)).join(", ")}]`;
    if (column + flat.length + (comma ? 1 : 0) <= style.printWidth) return flat;
    if (arr.every((v) => typeof v === "number")) return fillNumbers(arr as number[], indent, style);
  }
  const lines = arr.map((v, i) => {
    const last = i === arr.length - 1;
    return inner + print(v, inner, width(inner), !last, style) + (last ? "" : ",");
  });
  return `[\n${lines.join("\n")}\n${indent}]`;
}

/** Numbers fill each line up to the width, as Prettier prints a long array of numbers. */
function fillNumbers(arr: number[], indent: string, style: JsonStyle): string {
  const inner = indent + style.indent;
  const lines: string[] = [];
  let line = "";
  arr.forEach((n, i) => {
    const item = JSON.stringify(n) + (i === arr.length - 1 ? "" : ",");
    const next = line ? `${line} ${item}` : item;
    if (line && width(inner) + next.length > style.printWidth) {
      lines.push(line);
      line = item;
    } else {
      line = next;
    }
  });
  if (line) lines.push(line);
  return `[\n${lines.map((l) => inner + l).join("\n")}\n${indent}]`;
}

function width(indent: string): number {
  // Prettier counts a tab as tabWidth columns; the tool only writes spaces or one tab per level.
  return indent.replaceAll("\t", "  ").length;
}
