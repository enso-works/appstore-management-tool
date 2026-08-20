import { handle, json } from "@/lib/server/http";
import { requireProject, saveBrandBackground } from "@/lib/server/projects";
import type { BackgroundValues } from "@/lib/schema";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ name: string }> };

/** PUT { values: BackgroundValues | null, ifMatch? } -> set/clear the project-wide default background. */
export async function PUT(req: Request, ctx: Ctx) {
  return handle(async () => {
    const { name } = await ctx.params;
    const project = requireProject(name);
    const body = (await req.json()) as { values: BackgroundValues | null; ifMatch?: string };
    const r = saveBrandBackground(project, body.values ?? null, body.ifMatch);
    return json({ etag: r.etag });
  });
}
