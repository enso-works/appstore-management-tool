import { handle, json } from "@/lib/server/http";
import { requireProject } from "@/lib/server/projects";
import { readinessReport } from "@/lib/readiness";
import { validateProject } from "@/lib/validate";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ name: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  return handle(async () => {
    const { name } = await ctx.params;
    const project = requireProject(name);
    const validation = validateProject(project);
    return json({
      readiness: readinessReport(project),
      issues: validation.issues.items,
      planKeys: validation.plan.map((j) => j.key),
    });
  });
}
