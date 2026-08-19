import path from "node:path";
import { handle } from "@/lib/server/http";
import { HttpError, requireProject } from "@/lib/server/projects";
import { previewHtml, type PreviewRequest } from "@/lib/render/preview";
import { appFontsDir, bundledFontsDir } from "@/lib/fonts";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ name: string }> };

/** POST a draft (target, locale, screen, fields) -> the artwork HTML for an iframe. */
export async function POST(req: Request, ctx: Ctx) {
  return handle(async () => {
    const { name } = await ctx.params;
    const project = requireProject(name);
    const body = (await req.json()) as PreviewRequest;
    if (!body || typeof body.targetId !== "string" || typeof body.locale !== "string")
      throw new HttpError(400, "targetId and locale are required");
    const base = `/api/projects/${encodeURIComponent(name)}/file`;
    const appFonts = appFontsDir(project);
    const bundled = bundledFontsDir();
    let result;
    try {
      result = previewHtml(project, body, {
        sourceImage: (abs) =>
          `${base}?kind=raw&path=${encodeURIComponent(path.relative(project.paths.raw, abs).split(path.sep).join("/"))}`,
        assetUrl: (rel) => `${base}?kind=asset&path=${encodeURIComponent(rel)}`,
        fontUrl: (abs) => {
          const inApp = !path.relative(appFonts, abs).startsWith("..");
          const root = inApp ? appFonts : bundled;
          return `${base}?kind=font&src=${inApp ? "app" : "bundled"}&path=${encodeURIComponent(path.relative(root, abs).split(path.sep).join("/"))}`;
        },
      });
    } catch (err) {
      throw new HttpError(422, (err as Error).message);
    }
    return new Response(result.html, {
      headers: {
        "content-type": "text/html; charset=utf-8",
        "x-store-shots-job": encodeURIComponent(JSON.stringify(result.job)),
      },
    });
  });
}
