import { handle, json } from "@/lib/server/http";
import { bootstrapLocaleContent, requireProject } from "@/lib/server/projects";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ name: string }> };

/** POST -> create missing locale content files, prefilled from the default locale (drafts to translate). */
export async function POST(_req: Request, ctx: Ctx) {
  return handle(async () => {
    const { name } = await ctx.params;
    return json(bootstrapLocaleContent(requireProject(name)));
  });
}
