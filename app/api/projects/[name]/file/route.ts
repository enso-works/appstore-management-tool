import fs from "node:fs";
import path from "node:path";
import { handle } from "@/lib/server/http";
import { HttpError, requireProject } from "@/lib/server/projects";
import { appFontsDir, bundledFontsDir } from "@/lib/fonts";
import { framesDir } from "@/lib/frames";
import { fileExists, resolveWithin } from "@/lib/paths";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ name: string }> };

const MIME: Record<string, string> = {
  ".png": "image/png",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

/**
 * Serve a raw capture or a font file to the preview. Only two roots are
 * reachable (the app's store/raw and the fonts dirs) and every path is
 * resolved inside them; anything else is 404.
 *   ?kind=raw&path=iphone/en-US/01-home.png
 *   ?kind=asset&path=backgrounds/waves.png
 *   ?kind=font&src=app|bundled&path=inter/inter-400.ttf
 */
export async function GET(req: Request, ctx: Ctx) {
  return handle(async () => {
    const { name } = await ctx.params;
    const project = requireProject(name);
    const url = new URL(req.url);
    const kind = url.searchParams.get("kind");
    const rel = url.searchParams.get("path") ?? "";
    let root: string;
    if (kind === "raw") root = project.paths.raw;
    else if (kind === "asset") root = project.paths.assets;
    else if (kind === "devframe") root = framesDir();
    else if (kind === "font")
      root = url.searchParams.get("src") === "bundled" ? bundledFontsDir() : appFontsDir(project);
    else throw new HttpError(400, "kind must be raw, asset, font or devframe");
    let abs: string;
    try {
      abs = resolveWithin(root, rel);
    } catch {
      throw new HttpError(404, "not found");
    }
    if (!fileExists(abs)) throw new HttpError(404, "not found");
    const type = MIME[path.extname(abs).toLowerCase()];
    if (!type) throw new HttpError(404, "not found");
    const body = fs.readFileSync(abs);
    // Fonts are content-addressed by the lock file and never change in place; captures do.
    const cache = kind === "font" || kind === "devframe" ? "private, max-age=3600" : "no-store";
    return new Response(body, { headers: { "content-type": type, "cache-control": cache } });
  });
}
