import { handle, json } from "@/lib/server/http";
import { requireProject, saveContent } from "@/lib/server/projects";
import { validateProject } from "@/lib/validate";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ name: string; locale: string }> };

/** Save one locale's copy. Body: { content: LocaleContent, ifMatch?: string }. */
export async function PUT(req: Request, ctx: Ctx) {
  return handle(async () => {
    const { name, locale } = await ctx.params;
    const project = requireProject(name);
    const body = (await req.json()) as { content: unknown; ifMatch?: string };
    const result = saveContent(project, decodeURIComponent(locale), body.content, body.ifMatch);
    const validation = validateProject(project);
    return json({ etag: result.etag, issues: validation.issues.items });
  });
}
