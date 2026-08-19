#!/usr/bin/env node
// Runs the TypeScript CLI through tsx so the tool needs no build step.
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const tsxCli = require.resolve("tsx/cli");
const root = path.join(here, "..");
const cli = path.join(root, "cli", "index.ts");

// Pin the tool's tsconfig: tsx otherwise resolves it from the cwd, and running
// from an app directory would lose `jsx: react-jsx` (templates are .tsx).
const result = spawnSync(
  process.execPath,
  [tsxCli, "--tsconfig", path.join(root, "tsconfig.json"), cli, ...process.argv.slice(2)],
  { stdio: "inherit" },
);
process.exit(result.status ?? 1);
