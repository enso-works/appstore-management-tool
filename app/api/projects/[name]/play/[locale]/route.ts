import { handle, json } from "@/lib/server/http";
import { HttpError, requireProject } from "@/lib/server/projects";
import { PLAY_FIELDS, readPlayLocale, writePlayField, type PlayField } from "@/lib/metadata";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ name: string; locale: string }> };

/** PUT { fields: { title?, short_description?, full_description? } } for one Play locale. */
export async function PUT(req: Request, ctx: Ctx) {
  return handle(async () => {
    const { name, locale: raw } = await ctx.params;
    const locale = decodeURIComponent(raw);
    const project = requireProject(name);
    const body = (await req.json()) as { fields: Record<string, string> };
    if (!body?.fields) throw new HttpError(400, "fields required");
    const results: Record<string, { length: number; overLimit: boolean }> = {};
    for (const [field, value] of Object.entries(body.fields)) {
      if (!(PLAY_FIELDS as readonly string[]).includes(field))
        throw new HttpError(400, `Unknown Play field "${field}"`);
      if (typeof value !== "string") throw new HttpError(422, `${field} must be a string`);
      results[field] = writePlayField(project, locale, field as PlayField, value);
    }
    return json({ results, state: readPlayLocale(project, locale) });
  });
}
