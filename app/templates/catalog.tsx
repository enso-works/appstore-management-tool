"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import styles from "./templates.module.css";

export interface CatalogTemplate {
  id: string;
  name: string;
  summary: string;
  strip: boolean;
  usesCapture: boolean;
  families: string[];
  requiredFields: string[];
  optionalFields: string[];
  /** Override keys beyond the shared set. */
  ownKeys: string[];
}

type Filter = "all" | "screen" | "strip";

/**
 * The template catalogue: pick the app, then the template. "Use" adds a screen
 * with that template to the chosen project and opens the editor on it, so the
 * page is a real starting point rather than a reference sheet.
 */
export default function Catalog({
  templates,
  projects,
  initialProject,
}: {
  templates: CatalogTemplate[];
  projects: { name: string; label: string }[];
  initialProject?: string;
}) {
  const router = useRouter();
  const [project, setProject] = useState(initialProject ?? projects[0]?.name ?? "");
  const [filter, setFilter] = useState<Filter>("all");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  const shown = templates.filter((t) => (filter === "all" ? true : filter === "strip" ? t.strip : !t.strip));

  async function use(template: CatalogTemplate) {
    if (!project) return;
    setBusy(template.id);
    setError("");
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(project)}/screens`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ templateId: template.id }),
      });
      const body = (await res.json()) as { id?: string; error?: string };
      if (!res.ok) throw new Error(body.error ?? `${res.status}`);
      router.push(`/projects/${encodeURIComponent(project)}?screen=${encodeURIComponent(body.id!)}`);
    } catch (err) {
      setError(`Could not add the screen: ${(err as Error).message}`);
      setBusy("");
    }
  }

  return (
    <>
      <div className={styles.bar}>
        <label className={styles.field}>
          <span>App</span>
          {projects.length === 0 ? (
            <span className={styles.muted}>no projects found</span>
          ) : (
            <select value={project} onChange={(e) => setProject(e.target.value)} className={styles.select}>
              {projects.map((p) => (
                <option key={p.name} value={p.name}>
                  {p.label}
                </option>
              ))}
            </select>
          )}
        </label>
        <span className={styles.tabs}>
          {(
            [
              ["all", `All ${templates.length}`],
              ["screen", "Single screen"],
              ["strip", "Full strip"],
            ] as [Filter, string][]
          ).map(([value, label]) => (
            <button
              key={value}
              className={`${styles.tab} ${filter === value ? styles.tabActive : ""}`}
              onClick={() => setFilter(value)}
            >
              {label}
            </button>
          ))}
        </span>
        {project && (
          <Link className={styles.openLink} href={`/projects/${encodeURIComponent(project)}`}>
            open the editor →
          </Link>
        )}
      </div>

      {error && <p className={styles.error}>{error}</p>}

      <ul className={styles.grid}>
        {shown.map((t) => (
          <li key={t.id} className={`${styles.card} ${t.strip ? styles.wide : ""}`}>
            <div className={styles.shotWrap}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                className={styles.shot}
                src={`/template-previews/${t.id}.jpg`}
                alt={`${t.name} example`}
                loading="lazy"
              />
              {/* Where the wide artwork is cut into separate store screenshots. */}
              {t.strip && <span className={styles.seams} aria-hidden />}
            </div>
            <div className={styles.body}>
              <div className={styles.titleRow}>
                <h2>{t.name}</h2>
                <code className={styles.id}>{t.id}</code>
                {t.strip && <span className={styles.badge}>3 screenshots</span>}
                {!t.usesCapture && <span className={styles.badge}>no capture</span>}
                {t.families.length === 1 && <span className={styles.badge}>{t.families[0]}</span>}
              </div>
              <p className={styles.summary}>{t.summary}</p>
              <dl className={styles.meta}>
                <dt>Copy</dt>
                <dd>
                  <ul className={styles.chips}>
                    {t.requiredFields.map((f) => (
                      <li key={f} className={styles.req} title="required">
                        {f}
                      </li>
                    ))}
                    {t.optionalFields.map((f) => (
                      <li key={f}>{f}</li>
                    ))}
                  </ul>
                </dd>
                {t.ownKeys.length > 0 && (
                  <>
                    <dt>Controls</dt>
                    <dd>
                      <ul className={styles.chips}>
                        {t.ownKeys.map((k) => (
                          <li key={k}>{k}</li>
                        ))}
                      </ul>
                    </dd>
                  </>
                )}
              </dl>
              <div className={styles.actions}>
                <button className={styles.use} onClick={() => void use(t)} disabled={!project || busy !== ""}>
                  {busy === t.id ? "Adding…" : `Use in ${projects.find((p) => p.name === project)?.label ?? "…"}`}
                </button>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}
