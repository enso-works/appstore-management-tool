import fs from "node:fs";
import path from "node:path";
import sharp, { type OverlayOptions } from "sharp";
import type { Project } from "./config";
import { readGeneratedManifest } from "./generated-manifest";
import { getTarget } from "./targets";

/**
 * Contact sheets (roadmap #5): one PNG per target x locale showing the
 * generated screenshots side by side, for review in Slack/PRs. Reads only the
 * files recorded in the generated manifest; writes under store/generated/sheets/.
 */
export interface SheetResult {
  target: string;
  locale: string;
  file: string;
  count: number;
}

export interface SheetOptions {
  /** Width of each thumbnail in px (default 330). */
  thumbWidth?: number;
  locales?: string[];
  targets?: string[];
  /** Dark App Store-like background (default) or light. */
  theme?: "dark" | "light";
}

export async function writeContactSheets(project: Project, opts: SheetOptions = {}): Promise<SheetResult[]> {
  const manifest = readGeneratedManifest(project);
  if (!manifest || manifest.files.length === 0) return [];
  const thumbW = opts.thumbWidth ?? 330;
  const bg = opts.theme === "light" ? "#f2f2f7" : "#1c1c1e";
  const outDir = path.join(project.paths.generated, "sheets");
  fs.mkdirSync(outDir, { recursive: true });

  const groups = new Map<string, typeof manifest.files>();
  for (const f of manifest.files) {
    if (opts.locales && !opts.locales.includes(f.locale)) continue;
    if (opts.targets && !opts.targets.includes(f.target)) continue;
    const k = `${f.target}|${f.locale}`;
    groups.set(k, [...(groups.get(k) ?? []), f]);
  }

  const results: SheetResult[] = [];
  for (const [k, files] of groups) {
    const [targetId, locale] = k.split("|");
    const target = getTarget(targetId);
    if (!target) continue;
    const sorted = [...files].sort((a, b) => a.path.localeCompare(b.path));
    const thumbH = Math.round((thumbW * target.height) / target.width);
    const gap = Math.round(thumbW * 0.06);
    const pad = Math.round(thumbW * 0.08);
    const labelH = Math.round(thumbW * 0.12);
    const width = pad * 2 + sorted.length * thumbW + (sorted.length - 1) * gap;
    const height = pad * 2 + labelH + thumbH;
    const composites: OverlayOptions[] = [];
    for (let i = 0; i < sorted.length; i++) {
      const abs = path.join(project.root, sorted[i].path);
      if (!fs.existsSync(abs)) continue;
      const buf = await sharp(abs).resize({ width: thumbW, height: thumbH, fit: "cover" }).png().toBuffer();
      composites.push({ input: buf, left: pad + i * (thumbW + gap), top: pad + labelH });
    }
    const title = `${project.config.projectName} · ${locale} · ${target.displayClass} (${target.width}×${target.height}) · ${sorted.length} screenshot(s)`;
    const svg = Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${labelH + pad}"><text x="${pad}" y="${pad + labelH * 0.65}" font-family="system-ui, -apple-system, Helvetica, Arial, sans-serif" font-size="${Math.round(labelH * 0.55)}" fill="${opts.theme === "light" ? "#111" : "#eee"}">${escapeXml(title)}</text></svg>`,
    );
    composites.unshift({ input: svg, left: 0, top: 0 });
    const file = path.join(outDir, `${locale}_${target.fileToken}.png`);
    await sharp({ create: { width, height, channels: 3, background: bg } })
      .composite(composites)
      .png()
      .toFile(file);
    results.push({ target: targetId, locale, file, count: sorted.length });
  }
  return results;
}

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
