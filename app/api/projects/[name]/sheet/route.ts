import path from "node:path";
import { handle, json } from "@/lib/server/http";
import { requireProject } from "@/lib/server/projects";
import { writeContactSheets } from "@/lib/sheet";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ name: string }> };

/** POST { locales?, targets?, theme? } -> contact sheets written under store/generated/sheets/. */
export async function POST(req: Request, ctx: Ctx) {
  return handle(async () => {
    const { name } = await ctx.params;
    const project = requireProject(name);
    const body = (await req.json().catch(() => ({}))) as {
      locales?: string[];
      targets?: string[];
      theme?: "dark" | "light";
    };
    const results = await writeContactSheets(project, body);
    return json({ sheets: results.map((r) => ({ ...r, file: path.relative(project.root, r.file) })) });
  });
}
