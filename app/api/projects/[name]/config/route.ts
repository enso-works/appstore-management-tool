import { handle, json, requireSameOrigin } from "@/lib/server/http";
import { requireProject, saveConfigPatch, type ConfigPatch } from "@/lib/server/projects";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ name: string }> };

/** PUT { targets?, locales?, defaultLocale?, brand?, ifMatch? } -> { etag, config }: the settings the Mac app edits. */
export async function PUT(req: Request, ctx: Ctx) {
  return handle(async () => {
    requireSameOrigin(req);
    const { name } = await ctx.params;
    const project = requireProject(name);
    const body = (await req.json()) as ConfigPatch & { ifMatch?: string };
    const { ifMatch, ...patch } = body;
    return json(saveConfigPatch(project, patch, ifMatch));
  });
}
