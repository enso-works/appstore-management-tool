import { handle, json } from "@/lib/server/http";
import { SUGGESTED_ACCENTS } from "@/lib/color";
import { THEMES } from "@/lib/themes";

export const dynamic = "force-dynamic";

/** GET -> the starter themes and the suggested accents, for the editors' pickers. */
export async function GET() {
  return handle(() =>
    json({
      themes: THEMES.map((t) => ({
        id: t.id,
        name: t.name,
        description: t.description,
        headlineFont: t.headlineFont.family,
      })),
      swatches: SUGGESTED_ACCENTS,
    }),
  );
}
