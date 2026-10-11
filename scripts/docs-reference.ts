/**
 * Writes the docs site's reference pages (scripts/docs-reference-lib.ts) into
 * site/content/docs/reference/, which is not committed: the site builds it.
 *
 *   npm run docs:reference
 */
import fs from "node:fs";
import path from "node:path";
import { cliPage, devicesPage, filesPage, root, shortcutsPage } from "./docs-reference-lib";

const out = path.join(root, "site", "content", "docs", "reference");
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, "cli.mdx"), cliPage());
fs.writeFileSync(path.join(out, "files.mdx"), filesPage());
fs.writeFileSync(path.join(out, "devices.mdx"), devicesPage());
fs.writeFileSync(path.join(out, "shortcuts.mdx"), shortcutsPage());
fs.writeFileSync(
  path.join(out, "meta.json"),
  JSON.stringify({ title: "Reference", pages: ["cli", "files", "devices", "shortcuts"] }, null, 2) + "\n",
);
console.log(`reference: ${fs.readdirSync(out).length - 1} pages in ${path.relative(root, out)}`);
