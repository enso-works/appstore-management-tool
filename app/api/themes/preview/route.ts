import { handle } from "@/lib/server/http";
import { HttpError, requireProject } from "@/lib/server/projects";
import { previewRenderer, themeChoice } from "@/lib/server/themes";
import { themePreview } from "@/lib/theme-preview";

export const dynamic = "force-dynamic";

/**
 * GET ?theme=&accent=&project=&orientation= -> a PNG of the first screens in that
 * theme: the app's own when `project` names one, else the demo app's.
 */
export async function GET(req: Request) {
  return handle(async () => {
    const q = new URL(req.url).searchParams;
    const { theme, accent } = themeChoice(q.get("theme"), q.get("accent"));
    const name = q.get("project");
    const orientation = q.get("orientation") === "landscape" ? "landscape" : "portrait";
    let png: Buffer;
    try {
      png = await themePreview(await previewRenderer(), {
        theme,
        accent,
        project: name ? requireProject(name) : undefined,
        orientation,
        height: Number(q.get("height")) || undefined,
      });
    } catch (err) {
      if (err instanceof HttpError) throw err;
      throw new HttpError(422, (err as Error).message);
    }
    return new Response(new Uint8Array(png), { headers: { "content-type": "image/png", "cache-control": "no-store" } });
  });
}
