import { handle, json } from "@/lib/server/http";
import { projectSnapshot, requireProject } from "@/lib/server/projects";
import { validateProject } from "@/lib/validate";
import { readinessReport } from "@/lib/readiness";
import { templateModules } from "@/templates";
import { targetProfiles } from "@/lib/targets";
import { listFonts, resolveFontStack } from "@/lib/fonts";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ name: string }> };

/** Everything the editor needs on load: config, manifest, all locale content, validation, readiness, templates, targets, fonts. */
export async function GET(_req: Request, ctx: Ctx) {
  return handle(async () => {
    const { name } = await ctx.params;
    const project = requireProject(name);
    const snap = projectSnapshot(project);
    const validation = validateProject(project);
    const { stack, missing } = resolveFontStack(project);
    return json({
      name,
      root: project.root,
      config: project.config,
      manifest: snap.manifest,
      manifestEtag: snap.manifestEtag,
      content: snap.content,
      contentEtags: snap.contentEtags,
      validation: { issues: validation.issues.items, planKeys: validation.plan.map((j) => j.key) },
      readiness: readinessReport(project),
      templates: Object.values(templateModules).map((m) => m.descriptor),
      targets: project.config.targets.map((id) => targetProfiles[id as keyof typeof targetProfiles]),
      fonts: {
        stack: stack.map((f) => ({ family: f.family, source: f.source })),
        missing,
        available: listFonts(project),
      },
    });
  });
}
