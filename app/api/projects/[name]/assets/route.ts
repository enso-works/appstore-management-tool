import { handle, json } from "@/lib/server/http";
import { HttpError, listBackgroundAssets, requireProject, saveBackgroundAsset } from "@/lib/server/projects";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ name: string }> };

/** Background images under store/assets/backgrounds/. */
export async function GET(_req: Request, ctx: Ctx) {
  return handle(async () => {
    const { name } = await ctx.params;
    return json({ assets: listBackgroundAssets(requireProject(name)) });
  });
}

/** POST { fileName, dataBase64 } -> save an image into store/assets/backgrounds/. */
export async function POST(req: Request, ctx: Ctx) {
  return handle(async () => {
    const { name } = await ctx.params;
    const project = requireProject(name);
    const body = (await req.json()) as { fileName?: string; dataBase64?: string };
    if (!body.fileName || !body.dataBase64) throw new HttpError(400, "fileName and dataBase64 required");
    const asset = saveBackgroundAsset(project, body.fileName, Buffer.from(body.dataBase64, "base64"));
    return json({ asset, assets: listBackgroundAssets(project) });
  });
}
