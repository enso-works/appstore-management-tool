import Link from "next/link";
import { listProjects } from "@/lib/registry";
import { readinessReport } from "@/lib/readiness";
import styles from "./page.module.css";

export const dynamic = "force-dynamic";

export default function HomePage() {
  const projects = listProjects();
  return (
    <main className={styles.main}>
      <h1>store-shots</h1>
      <p className={styles.muted}>
        Apps in this workspace with a <code>store-shots.config.json</code>. Run{" "}
        <code>npx store-shots init --project &lt;app&gt;</code> to add one.
      </p>
      {projects.length === 0 && <p>No projects found.</p>}
      <ul className={styles.list}>
        {projects.map((p) => {
          const report = p.project ? readinessReport(p.project) : undefined;
          return (
            <li key={p.root} className={styles.card}>
              <div className={styles.row}>
                <strong>{p.project?.config.projectName ?? p.name}</strong>
                <span className={styles.muted}>{p.name}</span>
                {report && <span className={`${styles.badge} ${styles[report.status]}`}>{report.status}</span>}
              </div>
              {p.error && <p className={styles.fail}>{p.error}</p>}
              {p.project && (
                <p className={styles.muted}>
                  {p.project.config.locales.length} locales · {p.project.config.targets.length} targets ·{" "}
                  <Link href={`/projects/${encodeURIComponent(p.name)}`}>open</Link>
                </p>
              )}
              {report && (
                <ul className={styles.checks}>
                  {report.checks.map((c) => (
                    <li key={c.id}>
                      <span className={`${styles.dot} ${styles[c.status]}`} /> {c.title}
                      {c.details.length > 0 && <span className={styles.muted}> — {c.details.length} finding(s)</span>}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </main>
  );
}
