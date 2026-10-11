/**
 * The docs' theme images: each theme on a real app's captures and copy, three
 * screens side by side, in docs/images/theme-<id>.png. Reads the app, writes
 * nothing to it.
 *
 *   npm run theme-shots -- [path/to/app] [--accent "#hex"]
 *
 * The default app is hush's iOS app (a checkout next to this workspace): no art
 * layers, so each theme shows as it is.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { accentOf } from "../lib/accent";
import { loadProject } from "../lib/config";
import { ExportRenderer } from "../lib/render/export";
import { themePreview } from "../lib/theme-preview";
import { THEMES } from "../lib/themes";

async function main() {
  const root = path.resolve(import.meta.dirname, "..");
  const args = process.argv.slice(2);
  const accentArg = args.indexOf("--accent");
  const app = path.resolve(
    args.find((a, i) => !a.startsWith("--") && i !== accentArg + 1) ??
      path.join(root, "..", "..", "..", "hush", "ios-app"),
  );
  const project = loadProject(path.join(app, "store-shots.config.json"));
  const accent = accentArg >= 0 ? args[accentArg + 1] : (await accentOf(app)).hex;
  const outDir = path.join(root, "docs", "images");

  const renderer = new ExportRenderer();
  try {
    for (const theme of THEMES) {
      const png = await themePreview(renderer, { theme: theme.id, accent, project, height: 900 });
      const file = path.join(outDir, `theme-${theme.id}.png`);
      fs.writeFileSync(file, png);
      try {
        execFileSync("pngquant", ["--force", "--quality", "70-95", "--output", file, file]);
      } catch {
        // pngquant is optional: the file is just larger without it
      }
      console.log(`${path.relative(root, file)}  ${(fs.statSync(file).size / 1024).toFixed(0)} KB`);
    }
  } finally {
    await renderer.close();
  }
}

void main();
