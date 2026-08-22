import { handle, json } from "@/lib/server/http";
import { HttpError, requireProject, saveBrandFonts } from "@/lib/server/projects";
import { addGoogleFont, appFontsDir, listFonts, resolveFontStack } from "@/lib/fonts";
import type { Project } from "@/lib/config";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ name: string }> };

/** The editor's fonts block: resolved stack, missing families, local families to pick from. */
function fontsPayload(project: Project) {
  const { stack, missing } = resolveFontStack(project);
  return {
    stack: stack.map((f) => ({ family: f.family, source: f.source })),
    missing,
    available: listFonts(project),
  };
}

/** POST { family, weights? } -> download a Google Fonts family into store/assets/fonts/. */
export async function POST(req: Request, ctx: Ctx) {
  return handle(async () => {
    const { name } = await ctx.params;
    const project = requireProject(name);
    const body = (await req.json()) as { family?: string; weights?: number[] };
    if (!body.family?.trim()) throw new HttpError(422, "family is required");
    const added = await addGoogleFont({
      family: body.family,
      weights: body.weights,
      destDir: appFontsDir(project),
      // The UI cannot know a family's weights up front; keep the ones that exist.
      allowMissingWeights: true,
    });
    return json({ family: added.family, count: added.files.length, fonts: fontsPayload(project) });
  });
}

/** PUT { font?, headlineFont? | null, ifMatch? } -> set the brand font families. */
export async function PUT(req: Request, ctx: Ctx) {
  return handle(async () => {
    const { name } = await ctx.params;
    const project = requireProject(name);
    const body = (await req.json()) as {
      font?: { family: string };
      headlineFont?: { family: string } | null;
      ifMatch?: string;
    };
    const r = saveBrandFonts(project, { font: body.font, headlineFont: body.headlineFont }, body.ifMatch);
    const fresh = requireProject(name); // re-read so config and the resolved stack reflect the write
    return json({ etag: r.etag, config: fresh.config, fonts: fontsPayload(fresh) });
  });
}
