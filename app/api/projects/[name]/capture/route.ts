import { handle, json, requireSameOrigin } from "@/lib/server/http";
import { captureTarget, HttpError, requireProject, saveCapture } from "@/lib/server/projects";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ name: string }> };

/** GET ?screenId&targetId&locale -> where that capture lives, whether it exists, and what else reads it. */
export async function GET(req: Request, ctx: Ctx) {
  return handle(async () => {
    const { name } = await ctx.params;
    const q = new URL(req.url).searchParams;
    const [screenId, targetId, locale] = [q.get("screenId"), q.get("targetId"), q.get("locale")];
    if (!screenId || !targetId || !locale) throw new HttpError(400, "screenId, targetId and locale are required");
    return json(captureTarget(requireProject(name), screenId, targetId, locale).info);
  });
}

/** POST { screenId, targetId, locale, dataBase64 } -> the capture saved where that screen reads it. */
export async function POST(req: Request, ctx: Ctx) {
  return handle(async () => {
    requireSameOrigin(req);
    const { name } = await ctx.params;
    const project = requireProject(name);
    const body = (await req.json()) as { screenId?: string; targetId?: string; locale?: string; dataBase64?: string };
    if (!body.screenId || !body.targetId || !body.locale || !body.dataBase64) {
      throw new HttpError(400, "screenId, targetId, locale and dataBase64 are required");
    }
    return json(
      saveCapture(project, body.screenId, body.targetId, body.locale, Buffer.from(body.dataBase64, "base64")),
    );
  });
}
