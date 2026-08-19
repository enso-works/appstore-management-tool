import { handle, json } from "@/lib/server/http";
import { requireProject, savePresets } from "@/lib/server/projects";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ name: string }> };

/** PUT { presets, ifMatch? } -> save the presets block of store-shots.config.json. */
export async function PUT(req: Request, ctx: Ctx) {
  return handle(async () => {
    const { name } = await ctx.params;
    const project = requireProject(name);
    const body = (await req.json()) as { presets: Record<string, Record<string, unknown>>; ifMatch?: string };
    const r = savePresets(project, body.presets ?? {}, body.ifMatch);
    return json({ etag: r.etag });
  });
}
