import Link from "next/link";
import { notFound } from "next/navigation";
import { listProjects } from "@/lib/registry";
import { readinessReport } from "@/lib/readiness";
import { validateProject } from "@/lib/validate";
import { formatIssue } from "@/lib/issues";
import styles from "../../../page.module.css";

export const dynamic = "force-dynamic";

export default async function ProjectPage({ params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const found = listProjects().find((p) => p.name === decodeURIComponent(name));
  if (!found?.project) notFound();
  const project = found.project;
  const report = readinessReport(project);
  const validation = validateProject(project);
  return (
    <main className={styles.main}>
      <p>
        <Link href="/">← all projects</Link> · <Link href={`/projects/${encodeURIComponent(name)}`}>editor</Link>
      </p>
      <h1>{project.config.projectName}</h1>
      <p className={styles.muted}>
        <code>{found.root}</code>
      </p>

      <h2>Readiness</h2>
      <ul className={styles.checks}>
        {report.checks.map((c) => (
          <li key={c.id}>
            <span className={`${styles.dot} ${styles[c.status]}`} /> {c.title}
            {c.details.length > 0 && (
              <ul>
                {c.details.map((d) => (
                  <li key={d} className={styles.muted}>
                    {d}
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>

      <h2>Validation</h2>
      <p className={styles.muted}>
        {validation.issues.errors.length} error(s), {validation.issues.warnings.length} warning(s),{" "}
        {validation.plan.length} render job(s)
      </p>
      <pre>{validation.issues.items.map(formatIssue).join("\n\n") || "No issues."}</pre>
    </main>
  );
}
