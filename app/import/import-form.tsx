"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import type { AppProposal, ImportCandidate, ImportResult } from "@/lib/import";
import { APP_STORE_LOCALES } from "@/lib/locales";
import { getTarget, targetsFor, type Orientation } from "@/lib/targets";
import styles from "./import.module.css";

interface Choices {
  projectName: string;
  locales: string[];
  defaultLocale: string;
  orientation: Orientation;
  ipad: boolean;
  play: boolean;
}

const KIND_LABEL: Record<AppProposal["kind"], string> = {
  expo: "Expo app",
  capacitor: "Capacitor app",
  "native-ios": "iOS app",
  unknown: "app",
};

function choicesFrom(p: AppProposal): Choices {
  return {
    projectName: p.projectName,
    locales: p.locales,
    defaultLocale: p.defaultLocale,
    orientation: p.orientation,
    ipad: p.ipad,
    play: p.play,
  };
}

export default function ImportForm({
  initialPath,
  initialProposal,
  initialError,
  workspace,
  candidates,
}: {
  initialPath: string;
  initialProposal?: AppProposal;
  initialError: string;
  workspace: string;
  candidates: ImportCandidate[];
}) {
  const router = useRouter();
  const [path, setPath] = useState(initialProposal?.root ?? initialPath);
  const [proposal, setProposal] = useState(initialProposal);
  const [choices, setChoices] = useState(initialProposal && choicesFrom(initialProposal));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(initialError);

  async function inspect(dir: string) {
    if (!dir.trim()) return;
    setBusy(true);
    setError("");
    setProposal(undefined);
    try {
      const res = await fetch(`/api/import?path=${encodeURIComponent(dir.trim())}`);
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      const p = body as AppProposal;
      setProposal(p);
      setPath(p.root);
      setChoices(choicesFrom(p));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function submit() {
    if (!proposal || !choices) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ root: proposal.root, ...choices }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      router.push(`/projects/${encodeURIComponent((body as ImportResult).entry.name)}`);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  const update = (patch: Partial<Choices>) => setChoices((c) => (c ? { ...c, ...patch } : c));
  const removeLocale = (locale: string) =>
    setChoices((c) => {
      if (!c || c.locales.length === 1) return c;
      const locales = c.locales.filter((l) => l !== locale);
      return { ...c, locales, defaultLocale: c.defaultLocale === locale ? locales[0] : c.defaultLocale };
    });
  const targets = choices ? targetsFor(choices) : [];

  return (
    <main className={styles.main}>
      <Link href="/" className={styles.back}>
        ← All apps
      </Link>
      <h1>Import an app</h1>
      <p className={styles.muted}>
        Point at an app folder (Expo, Capacitor or a native iOS project). The tool reads what the app already says about
        itself, proposes a setup, and writes <code>store-shots.config.json</code> and <code>store/</code> once you
        import. Nothing else in the app changes.
      </p>

      <form
        className={styles.pathRow}
        onSubmit={(e) => {
          e.preventDefault();
          void inspect(path);
        }}
      >
        <input
          className={styles.input}
          value={path}
          onChange={(e) => setPath(e.target.value)}
          placeholder="/Users/you/apps/my-app"
          spellCheck={false}
          aria-label="App folder"
        />
        <button className={styles.button} type="submit" disabled={busy || !path.trim()}>
          Read app
        </button>
      </form>
      {error && <p className={styles.error}>{error}</p>}

      {!proposal && candidates.length > 0 && (
        <section className={styles.card}>
          <strong>Found next to the tool</strong>
          <span className={styles.small}> in {workspace}</span>
          <ul className={styles.candidates}>
            {candidates.map((c) => (
              <li key={c.root}>
                <button className={styles.candidate} onClick={() => void inspect(c.root)}>
                  <span>{c.name}</span>
                  <span className={styles.small}>
                    {KIND_LABEL[c.kind]}
                    {c.hasConfig ? " · already set up" : ""}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {proposal && choices && (
        <section className={styles.card}>
          <div className={styles.small}>
            {KIND_LABEL[proposal.kind]}
            {proposal.bundleId ? ` · ${proposal.bundleId}` : ""}
          </div>

          {proposal.registeredAs ? (
            <p>
              Already in your list as <strong>{proposal.registeredAs}</strong>.{" "}
              <Link href={`/projects/${encodeURIComponent(proposal.registeredAs)}`}>Open it</Link>
            </p>
          ) : proposal.hasConfig ? (
            <p>This app is already set up. Importing adds it to your list and changes nothing in it.</p>
          ) : (
            <>
              <Field label="Name" source={proposal.sources.projectName}>
                <input
                  className={styles.input}
                  value={choices.projectName}
                  onChange={(e) => update({ projectName: e.target.value })}
                />
              </Field>

              <Field label="Locales" source={proposal.sources.locales}>
                <div className={styles.chips}>
                  {choices.locales.map((l) => (
                    <span key={l} className={styles.chip}>
                      {l}
                      <button
                        className={styles.chipRemove}
                        onClick={() => removeLocale(l)}
                        disabled={choices.locales.length === 1}
                        aria-label={`Remove ${l}`}
                      >
                        ×
                      </button>
                    </span>
                  ))}
                  <select
                    className={styles.select}
                    value=""
                    onChange={(e) => e.target.value && update({ locales: [...choices.locales, e.target.value] })}
                    aria-label="Add a locale"
                  >
                    <option value="">Add…</option>
                    {APP_STORE_LOCALES.filter((l) => !choices.locales.includes(l)).map((l) => (
                      <option key={l} value={l}>
                        {l}
                      </option>
                    ))}
                  </select>
                </div>
              </Field>

              <Field label="Default locale">
                <select
                  className={styles.select}
                  value={choices.defaultLocale}
                  onChange={(e) => update({ defaultLocale: e.target.value })}
                >
                  {choices.locales.map((l) => (
                    <option key={l}>{l}</option>
                  ))}
                </select>
              </Field>

              <Field label="Orientation" source={proposal.sources.orientation}>
                <div className={styles.segmented}>
                  {(["portrait", "landscape"] as const).map((o) => (
                    <button key={o} aria-pressed={choices.orientation === o} onClick={() => update({ orientation: o })}>
                      {o === "portrait" ? "Portrait" : "Landscape"}
                    </button>
                  ))}
                </div>
              </Field>

              <Field label="Devices">
                <div className={styles.stack}>
                  <label className={styles.check}>
                    <input type="checkbox" checked disabled /> iPhone (6.9&quot; and 6.1&quot;)
                  </label>
                  <label className={styles.check}>
                    <input
                      type="checkbox"
                      checked={choices.ipad}
                      onChange={(e) => update({ ipad: e.target.checked })}
                    />{" "}
                    iPad 13&quot; <span className={styles.small}>· from {proposal.sources.ipad}</span>
                  </label>
                  <label className={styles.check}>
                    <input
                      type="checkbox"
                      checked={choices.play}
                      onChange={(e) => update({ play: e.target.checked })}
                    />{" "}
                    Google Play phone <span className={styles.small}>· {proposal.sources.play}</span>
                  </label>
                </div>
              </Field>

              <Field label="Screenshot sets">
                <div className={styles.targets}>
                  {targets.map((t) => {
                    const p = getTarget(t)!;
                    return (
                      <div key={t}>
                        {t}{" "}
                        <span className={styles.small}>
                          · {p.width}×{p.height}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </Field>
            </>
          )}

          {proposal.notes.length > 0 && (
            <ul className={styles.notes}>
              {proposal.notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          )}

          {!proposal.registeredAs && (
            <div className={styles.actions}>
              <button
                className={`${styles.button} ${styles.primary}`}
                onClick={() => void submit()}
                disabled={busy || (!proposal.hasConfig && !choices.projectName.trim())}
              >
                {proposal.hasConfig ? "Add to list" : "Import"}
              </button>
              <span className={styles.small}>{proposal.root}</span>
            </div>
          )}
        </section>
      )}
    </main>
  );
}

function Field({ label, source, children }: { label: string; source?: string; children: ReactNode }) {
  return (
    <div className={styles.field}>
      <div>
        <div className={styles.label}>{label}</div>
        {source && <div className={styles.small}>from {source}</div>}
      </div>
      <div>{children}</div>
    </div>
  );
}
