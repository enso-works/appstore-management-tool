// Copies the repo's docs images (docs/images, retaken by scripts like mac/docs-shots.sh) into
// public/images, so pages and the README show the same files and neither keeps a copy in git.
import { cpSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const site = join(dirname(fileURLToPath(import.meta.url)), "..");
const from = join(site, "..", "docs", "images");
const to = join(site, "public", "images");

rmSync(to, { recursive: true, force: true });
mkdirSync(to, { recursive: true });
const files = readdirSync(from).filter((f) => /\.(png|jpe?g|webp|svg)$/i.test(f));
for (const f of files) cpSync(join(from, f), join(to, f));
console.log(`${files.length} images from docs/images`);
