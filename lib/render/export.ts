import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { chromium, type Browser, type BrowserContext } from "playwright";
import sharp from "sharp";
import type { TargetProfile } from "../targets";
import { IN_PAGE_CHECKS_SOURCE, type InPageResult } from "./checks";
import { FIT_SOURCE, type FitResult } from "./fit";

export interface ExportOptions {
  /** Hex colour the PNG is flattened onto (alpha removed). */
  backgroundColor: string;
  /** Where to write the HTML page the browser loads (must be a real file for file:// assets). */
  workDir: string;
  /** Artwork width when it differs from target.width (panoramas). */
  canvasWidth?: number;
}

export interface ExportResult {
  png: Buffer;
  width: number;
  height: number;
  channels: number;
  checks: InPageResult;
  fits: FitResult[];
  htmlPath: string;
}

/**
 * One Chromium for many jobs (plan §10.2). Every job gets a fresh context:
 * isolated state, exact viewport, device scale factor 1, fixed timezone and
 * locale, animations disabled by the page CSS.
 */
export class ExportRenderer {
  private browser?: Browser;

  async start(): Promise<void> {
    if (this.browser) return;
    this.browser = await chromium.launch({ headless: true });
  }

  async close(): Promise<void> {
    await this.browser?.close();
    this.browser = undefined;
  }

  async render(jobKey: string, html: string, target: TargetProfile, opts: ExportOptions): Promise<ExportResult> {
    if (!this.browser) await this.start();
    fs.mkdirSync(opts.workDir, { recursive: true });
    const htmlPath = path.join(opts.workDir, `${jobKey.replaceAll("/", "__")}.html`);
    fs.writeFileSync(htmlPath, html, "utf8");

    const canvasWidth = opts.canvasWidth ?? target.width;
    const context: BrowserContext = await this.browser!.newContext({
      viewport: { width: canvasWidth, height: target.height },
      deviceScaleFactor: 1,
      timezoneId: "UTC",
      locale: "en-US",
      reducedMotion: "reduce",
      colorScheme: "light",
    });
    try {
      const page = await context.newPage();
      await page.goto(pathToFileURL(htmlPath).href, { waitUntil: "load" });
      await page.evaluate(() => document.fonts.ready);
      await page.evaluate(() =>
        Promise.all(Array.from(document.images).map((img) => img.decode().catch(() => undefined))),
      );
      const fits = (await page.evaluate(FIT_SOURCE)) as FitResult[];
      const checks = (await page.evaluate(IN_PAGE_CHECKS_SOURCE)) as InPageResult;
      if (!checks.artworkFound) throw new Error("template did not render a [data-artwork] root");
      if (
        checks.artworkSize &&
        (checks.artworkSize.width !== canvasWidth || checks.artworkSize.height !== target.height)
      ) {
        throw new Error(
          `artwork root is ${checks.artworkSize.width}x${checks.artworkSize.height}, expected ${canvasWidth}x${target.height}`,
        );
      }
      const raw = await page
        .locator("[data-artwork]")
        .first()
        .screenshot({ type: "png", animations: "disabled", scale: "css" });
      const flattened = await sharp(raw)
        .flatten({ background: opts.backgroundColor })
        .removeAlpha()
        .png({ compressionLevel: 9, adaptiveFiltering: false })
        .toBuffer();
      const meta = await sharp(flattened).metadata();
      return {
        png: flattened,
        width: meta.width ?? 0,
        height: meta.height ?? 0,
        channels: meta.channels ?? 0,
        checks,
        fits,
        htmlPath,
      };
    } finally {
      await context.close();
    }
  }
}

/** Inspect a written PNG the same way readiness does, but with Sharp (decodes fully). */
export async function inspectPng(
  file: string,
): Promise<{ width: number; height: number; channels: number; hasAlpha: boolean; format: string }> {
  const meta = await sharp(file).metadata();
  return {
    width: meta.width ?? 0,
    height: meta.height ?? 0,
    channels: meta.channels ?? 0,
    hasAlpha: !!meta.hasAlpha,
    format: meta.format ?? "unknown",
  };
}

/** Cut a wide panorama PNG into `slices` equal-width PNGs. */
export async function slicePng(png: Buffer, slices: number, sliceWidth: number, height: number): Promise<Buffer[]> {
  const out: Buffer[] = [];
  for (let i = 0; i < slices; i++) {
    out.push(
      await sharp(png)
        .extract({ left: i * sliceWidth, top: 0, width: sliceWidth, height })
        .png({ compressionLevel: 9, adaptiveFiltering: false })
        .toBuffer(),
    );
  }
  return out;
}
