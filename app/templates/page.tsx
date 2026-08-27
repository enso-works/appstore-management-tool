import Link from "next/link";
import { discoverProjects } from "@/lib/registry";
import { templateModules } from "@/templates";
import type { TemplateDescriptor } from "@/templates/types";
import { COMMON_OVERRIDE_KEYS } from "@/templates/shared";
import Catalog, { type CatalogTemplate } from "./catalog";
import styles from "./templates.module.css";

export const dynamic = "force-dynamic";

/** Templates a screen can never use on its own — the strip ones cover 2-3 screenshots. */
function toCatalog(d: TemplateDescriptor): CatalogTemplate {
  return {
    id: d.id,
    name: d.name,
    summary: d.summary ?? "",
    strip: d.strip === true,
    usesCapture: d.usesCapture !== false,
    families: d.families,
    requiredFields: d.requiredFields,
    optionalFields: d.optionalFields,
    ownKeys: d.overrideKeys.filter((k) => !COMMON_OVERRIDE_KEYS.includes(k)),
  };
}

export default async function TemplatesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const requested = typeof query.project === "string" ? query.project : undefined;
  const templates = Object.values(templateModules).map((m) => toCatalog(m.descriptor));
  const projects = discoverProjects()
    .filter((p) => p.project)
    .map((p) => ({ name: p.name, label: p.project!.config.projectName || p.name }));

  return (
    <main className={styles.main}>
      <header className={styles.head}>
        <Link href="/" className={styles.back}>
          ← projects
        </Link>
        <h1>Templates</h1>
        <p className={styles.lede}>
          Every layout the generator can render. Pick an app and a template to start a screen with it — the editor opens
          on the new screen, ready for its copy. Examples are rendered by the real pipeline against a demo app.
        </p>
      </header>
      <Catalog
        templates={templates}
        projects={projects}
        initialProject={projects.some((p) => p.name === requested) ? requested : undefined}
      />
    </main>
  );
}
