import { accentChoices } from "@/lib/accent";
import { handle, json } from "@/lib/server/http";
import { requireProject } from "@/lib/server/projects";
import { applyThemeToProject, restoreTheme, themeChoice } from "@/lib/server/themes";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ name: string }> };

/** GET -> the app's own colours (what it states, then its icon's), best guess as `accent`, for the theme picker. */
export async function GET(_req: Request, ctx: Ctx) {
  return handle(async () => {
    const { name } = await ctx.params;
    const project = requireProject(name);
    const accents = await accentChoices(project.root);
    return json({ accent: accents[0], accents });
  });
}

/** POST { theme, accent } -> apply it; answers with the config and manifest from before, for undo. */
export async function POST(req: Request, ctx: Ctx) {
  return handle(async () => {
    const { name } = await ctx.params;
    const project = requireProject(name);
    const body = (await req.json()) as { theme?: unknown; accent?: unknown };
    const { theme, accent } = themeChoice(body.theme, body.accent);
    return json(applyThemeToProject(project, theme, accent));
  });
}

/** PUT { config, manifest } -> put back what a theme replaced (the editors' undo). */
export async function PUT(req: Request, ctx: Ctx) {
  return handle(async () => {
    const { name } = await ctx.params;
    const project = requireProject(name);
    const body = (await req.json()) as { config?: unknown; manifest?: unknown };
    return json({ etags: restoreTheme(project, body.config, body.manifest) });
  });
}
