import { handle, json } from "@/lib/server/http";
import { THEMES } from "@/lib/themes";

export const dynamic = "force-dynamic";

/** GET -> the starter themes, for the editors' pickers. */
export async function GET() {
  return handle(() =>
    json({
      themes: THEMES.map((t) => ({
        id: t.id,
        name: t.name,
        description: t.description,
        headlineFont: t.headlineFont.family,
      })),
    }),
  );
}
