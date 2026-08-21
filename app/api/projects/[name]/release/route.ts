import { handle, json } from "@/lib/server/http";
import { HttpError, requireProject } from "@/lib/server/projects";
import { releaseStatus, setSignoff } from "@/lib/release";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ name: string }> };

/** Release review: per target x locale shot status plus the sign-off state. */
export async function GET(_req: Request, ctx: Ctx) {
  return handle(async () => {
    const { name } = await ctx.params;
    const project = requireProject(name);
    return json({ release: releaseStatus(project) });
  });
}

/** Mark or clear one locale's review: { locale, reviewed }. */
export async function POST(req: Request, ctx: Ctx) {
  return handle(async () => {
    const { name } = await ctx.params;
    const project = requireProject(name);
    const body = (await req.json()) as { locale?: string; reviewed?: boolean };
    if (!body.locale || !project.config.locales.includes(body.locale)) {
      throw new HttpError(400, `locale must be one of: ${project.config.locales.join(", ")}`);
    }
    setSignoff(project, body.locale, body.reviewed !== false);
    return json({ release: releaseStatus(project) });
  });
}
