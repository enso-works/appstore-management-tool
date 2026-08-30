import { handle, json } from "@/lib/server/http";
import { listProjects } from "@/lib/registry";
import { readinessReport } from "@/lib/readiness";

export const dynamic = "force-dynamic";

export async function GET() {
  return handle(() =>
    json(
      listProjects().map((p) => ({
        name: p.name,
        root: p.root,
        projectName: p.project?.config.projectName,
        locales: p.project?.config.locales,
        targets: p.project?.config.targets,
        readiness: p.project ? readinessReport(p.project).status : undefined,
        error: p.error,
      })),
    ),
  );
}
