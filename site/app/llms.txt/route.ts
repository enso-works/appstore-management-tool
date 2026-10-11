import { docsLlms } from "@/lib/source";
import { appName, siteUrl, summary } from "@/lib/shared";

export const revalidate = false;

/** llms.txt as llmstxt.org has it: the name as the H1, a one-line summary, then every page with an absolute link. */
export async function GET() {
  const index = (await docsLlms.index()).replace(/^# .*\n/, "").replace(/\]\(\//g, `](${siteUrl}/`);
  return new Response(`# ${appName}\n\n> ${summary}\n${index}`, {
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}
