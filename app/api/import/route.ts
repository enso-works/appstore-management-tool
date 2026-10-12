import {
  findImportCandidates,
  importApp,
  ImportError,
  inspectApp,
  resolveAppPath,
  type ImportChoices,
} from "@/lib/import";
import { accentChoices } from "@/lib/accent";
import { ScaffoldError } from "@/lib/init";
import { defaultWorkspaceRoot } from "@/lib/registry";
import { handle, json } from "@/lib/server/http";
import { HttpError } from "@/lib/server/projects";
import { themeChoice } from "@/lib/server/themes";

export const dynamic = "force-dynamic";

/**
 * GET ?path=<app dir> -> the proposed config for that app.
 * GET              -> apps near the tool that are not in the list yet.
 */
export async function GET(req: Request) {
  return handle(async () => {
    const dir = new URL(req.url).searchParams.get("path");
    if (!dir) {
      const workspace = defaultWorkspaceRoot();
      return json({ workspace, candidates: findImportCandidates(workspace) });
    }
    const proposal = guard(() => inspectApp(resolveAppPath(dir)));
    // The colours a starter theme could draw in: what the app states, then its icon's; the first is the guess.
    const accents = await accentChoices(proposal.root);
    return json({ ...proposal, accent: accents[0], accents });
  });
}

/** POST { root, name?, projectName?, locales?, defaultLocale?, orientation?, ipad?, play?, theme?, accent? } -> import it. */
export async function POST(req: Request) {
  return handle(async () => {
    const body = (await req.json()) as Partial<ImportChoices> & { theme?: unknown; accent?: unknown };
    if (typeof body.root !== "string" || !body.root) throw new HttpError(400, "root (the app directory) is required");
    if (
      body.locales !== undefined &&
      !(Array.isArray(body.locales) && body.locales.every((l) => typeof l === "string"))
    ) {
      throw new HttpError(400, "locales must be a list of locale codes");
    }
    if (body.orientation !== undefined && body.orientation !== "portrait" && body.orientation !== "landscape") {
      throw new HttpError(400, 'orientation must be "portrait" or "landscape"');
    }
    const root = body.root;
    const theme = body.theme ? themeChoice(body.theme, body.accent) : undefined;
    const result = guard(() =>
      importApp({
        root: resolveAppPath(root),
        name: str(body.name),
        projectName: str(body.projectName),
        locales: body.locales,
        defaultLocale: str(body.defaultLocale),
        orientation: body.orientation,
        ipad: typeof body.ipad === "boolean" ? body.ipad : undefined,
        play: typeof body.play === "boolean" ? body.play : undefined,
        theme: theme && { id: theme.theme, accent: theme.accent },
      }),
    );
    return json(result);
  });
}

/** Problems with the chosen folder or choices are the caller's to fix (422), not server errors. */
function guard<T>(fn: () => T): T {
  try {
    return fn();
  } catch (err) {
    if (err instanceof ImportError || err instanceof ScaffoldError) {
      throw new HttpError(422, err.message);
    }
    throw err;
  }
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}
