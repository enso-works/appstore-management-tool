import { handle, json } from "@/lib/server/http";
import { addScreenFromTemplate, HttpError, requireProject } from "@/lib/server/projects";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ name: string }> };

/** POST { templateId, id?, ifMatch? } -> add a screen using that template. */
export async function POST(req: Request, ctx: Ctx) {
  return handle(async () => {
    const { name } = await ctx.params;
    const project = requireProject(name);
    const body = (await req.json()) as { templateId?: string; id?: string; ifMatch?: string };
    if (!body || typeof body.templateId !== "string") throw new HttpError(400, "templateId is required");
    const r = addScreenFromTemplate(project, body.templateId, body.id, body.ifMatch);
    return json(r);
  });
}
