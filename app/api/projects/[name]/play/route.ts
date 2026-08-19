import { handle, json } from "@/lib/server/http";
import { requireProject } from "@/lib/server/projects";
import { PLAY_LIMITS, readPlayLocale } from "@/lib/metadata";
import { playLocaleFor } from "@/lib/targets";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ name: string }> };

/** Play text metadata for every configured locale (supply layout). */
export async function GET(_req: Request, ctx: Ctx) {
  return handle(async () => {
    const { name } = await ctx.params;
    const project = requireProject(name);
    const locales: Record<string, unknown> = {};
    for (const locale of project.config.locales) {
      const pl = playLocaleFor(locale);
      locales[pl] = readPlayLocale(project, pl);
    }
    return json({ locales, limits: PLAY_LIMITS });
  });
}
