import { handle, json } from "@/lib/server/http";
import { duplicateScreen, requireProject } from "@/lib/server/projects";
import { validateProject } from "@/lib/validate";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ name: string }> };

/** POST { sourceId, newId, ifMatch? } -> duplicate a screen incl. all locales' copy. */
export async function POST(req: Request, ctx: Ctx) {
  return handle(async () => {
    const { name } = await ctx.params;
    const project = requireProject(name);
    const body = (await req.json()) as {
      sourceId: string;
      newId: string;
      ifMatch?: { manifest?: string; content?: Record<string, string> };
    };
    const r = duplicateScreen(project, body.sourceId, body.newId, body.ifMatch);
    const validation = validateProject(project);
    return json({ ...r, issues: validation.issues.items });
  });
}
