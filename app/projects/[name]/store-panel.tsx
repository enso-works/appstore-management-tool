"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReadinessReport } from "@/lib/readiness";
import type { KeywordAnalysis } from "@/lib/metadata";
import styles from "./editor.module.css";

interface FieldState {
  field: string;
  present: boolean;
  value: string;
  length: number;
  limit: number;
  overLimit: boolean;
  etag: string;
}

interface MetadataSnapshot {
  locales: Record<string, { dirExists: boolean; fields: FieldState[]; keywords: KeywordAnalysis }>;
  onDisk: string[];
  limits: Record<string, number>;
  managedFields: string[];
  defaultLocale: string;
}

type LaneKey = "validate" | "metadata" | "screenshots";

const LANE_LABELS: Record<LaneKey, string> = {
  validate: "Validate metadata (no upload)",
  metadata: "Upload metadata",
  screenshots: "Upload screenshots",
};

/** Code-point length like the Fastfile lane (Ruby strip + length). */
function len(text: string): number {
  return Array.from(text.replace(/^[ \t\n\v\f\r\0]+/, "").replace(/[ \t\n\v\f\r\0]+$/, "")).length;
}

export default function StorePanel({
  name,
  locales,
  readiness,
  onReadiness,
}: {
  name: string;
  locales: string[];
  readiness: ReadinessReport;
  onReadiness: (r: ReadinessReport) => void;
}) {
  const [meta, setMeta] = useState<MetadataSnapshot | null>(null);
  const [locale, setLocale] = useState(locales[0]);
  const [drafts, setDrafts] = useState<Record<string, Record<string, string>>>({});
  const [status, setStatus] = useState("");
  const [lane, setLane] = useState<{ running?: LaneKey; lines: { s: string; t: string }[]; exit?: number | null }>({
    lines: [],
  });
  const [preflight, setPreflight] = useState<
    Record<string, { command: string; uploads: boolean; blocked: boolean; reasons: string[] }>
  >({});
  const [override, setOverride] = useState("");
  const logRef = useRef<HTMLPreElement>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/projects/${encodeURIComponent(name)}/metadata`, { cache: "no-store" });
    if (res.ok) {
      const data = (await res.json()) as MetadataSnapshot;
      setMeta(data);
      setDrafts({});
    }
    const pf: typeof preflight = {};
    for (const key of ["validate", "metadata", "screenshots"] as LaneKey[]) {
      const r = await fetch(`/api/projects/${encodeURIComponent(name)}/lane?key=${key}`, { cache: "no-store" });
      if (r.ok) pf[key] = await r.json();
    }
    setPreflight(pf);
  }, [name]);

  useEffect(() => {
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load]);

  const current = meta?.locales[locale];
  const draft = useMemo(() => drafts[locale] ?? {}, [drafts, locale]);
  const dirtyFields = useMemo(
    () => Object.keys(draft).filter((f) => draft[f] !== current?.fields.find((x) => x.field === f)?.value),
    [draft, current],
  );

  function setField(field: string, value: string) {
    setDrafts((d) => ({ ...d, [locale]: { ...(d[locale] ?? {}), [field]: value } }));
  }

  async function save() {
    if (!current || dirtyFields.length === 0) return;
    setStatus("Saving…");
    const fields: Record<string, string> = {};
    const ifMatch: Record<string, string> = {};
    for (const f of dirtyFields) {
      fields[f] = draft[f];
      ifMatch[f] = current.fields.find((x) => x.field === f)?.etag ?? "missing";
    }
    const res = await fetch(`/api/projects/${encodeURIComponent(name)}/metadata/${encodeURIComponent(locale)}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ fields, ifMatch }),
    });
    const body = await res.json();
    if (!res.ok) {
      setStatus(`Save failed: ${body.error}`);
      return;
    }
    onReadiness(body.readiness);
    await load();
    setStatus("Saved");
    setTimeout(() => setStatus(""), 1500);
  }

  async function createLocale() {
    const res = await fetch(`/api/projects/${encodeURIComponent(name)}/metadata/${encodeURIComponent(locale)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ seedFrom: meta?.defaultLocale }),
    });
    if (!res.ok) setStatus(`Could not create: ${(await res.json()).error}`);
    await load();
  }

  function copyReleaseNotesToAll() {
    const value = draft.release_notes ?? current?.fields.find((f) => f.field === "release_notes")?.value ?? "";
    if (!value || !confirm(`Set release_notes to this text in every locale that has a metadata directory?\n\n${value}`))
      return;
    setDrafts((d) => {
      const next = { ...d };
      for (const l of locales) if (meta?.locales[l]?.dirExists) next[l] = { ...(next[l] ?? {}), release_notes: value };
      return next;
    });
  }

  async function saveAllDirtyLocales() {
    for (const l of locales) {
      const d = drafts[l];
      const cur = meta?.locales[l];
      if (!d || !cur) continue;
      const fields: Record<string, string> = {};
      const ifMatch: Record<string, string> = {};
      for (const [f, v] of Object.entries(d)) {
        if (v !== cur.fields.find((x) => x.field === f)?.value) {
          fields[f] = v;
          ifMatch[f] = cur.fields.find((x) => x.field === f)?.etag ?? "missing";
        }
      }
      if (Object.keys(fields).length === 0) continue;
      const res = await fetch(`/api/projects/${encodeURIComponent(name)}/metadata/${encodeURIComponent(l)}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ fields, ifMatch }),
      });
      if (!res.ok) {
        setStatus(`${l}: ${(await res.json()).error}`);
        return;
      }
    }
    await load();
    setStatus("Saved all");
    setTimeout(() => setStatus(""), 1500);
  }

  async function runLane(key: LaneKey) {
    const pf = preflight[key];
    if (!pf) return;
    if (pf.uploads) {
      const msg = `Run \`${pf.command}\` for ${name}?\n\nThis uploads to App Store Connect using the app's own fastlane credentials.${pf.blocked ? `\n\nREADINESS IS FAILING: ${pf.reasons.join("; ")}\nOverride reason: ${override || "(none — will be refused)"}` : ""}`;
      if (!confirm(msg)) return;
    }
    setLane({ running: key, lines: [] });
    const res = await fetch(`/api/projects/${encodeURIComponent(name)}/lane`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ key, confirmed: true, overrideReason: override || undefined }),
    });
    if (!res.ok || !res.body) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      setLane({ lines: [{ s: "meta", t: `error: ${err.error}` }], exit: null });
      return;
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let i: number;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 1);
        if (!line) continue;
        const obj = JSON.parse(line) as { stream?: string; line?: string; done?: boolean; exitCode?: number | null };
        if (obj.done) {
          setLane((l) => ({ ...l, running: undefined, exit: obj.exitCode ?? null }));
        } else {
          setLane((l) => ({ ...l, lines: [...l.lines, { s: obj.stream ?? "stdout", t: obj.line ?? "" }] }));
        }
        logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
      }
    }
    await load();
    const r = await fetch(`/api/projects/${encodeURIComponent(name)}/readiness`, { cache: "no-store" });
    if (r.ok) onReadiness((await r.json()).readiness);
  }

  return (
    <div className={styles.store}>
      <section className={styles.storeCol}>
        <div className={styles.sectionTitle}>
          Readiness <span className={`${styles.badge} ${styles[readiness.status]}`}>{readiness.status}</span>
        </div>
        <ul className={styles.checks}>
          {readiness.checks.map((c) => (
            <li key={c.id}>
              <span
                className={`${styles.dot} ${styles[c.status === "pass" ? "ok" : c.status === "fail" ? "error" : c.status]}`}
              />{" "}
              {c.title}
              {c.details.length > 0 && (
                <ul className={styles.details}>
                  {c.details.slice(0, 8).map((d) => (
                    <li key={d}>{d}</li>
                  ))}
                  {c.details.length > 8 && <li className={styles.muted}>… {c.details.length - 8} more</li>}
                </ul>
              )}
              {c.status !== "pass" && c.status !== "skip" && c.hint && (
                <div className={styles.small}>hint: {c.hint}</div>
              )}
            </li>
          ))}
        </ul>

        <div className={styles.sectionTitle}>Fastlane</div>
        {(["validate", "metadata", "screenshots"] as LaneKey[]).map((key) => {
          const pf = preflight[key];
          return (
            <div key={key} className={styles.laneRow}>
              <button
                className={pf?.uploads ? styles.btnDangerSolid : styles.btn}
                disabled={!pf || !!lane.running || (pf.blocked && pf.uploads && !override)}
                onClick={() => runLane(key)}
              >
                {LANE_LABELS[key]}
              </button>
              <span className={styles.small}>
                {pf ? pf.command : "…"}
                {pf?.blocked ? ` — blocked: ${pf.reasons.join("; ")}` : ""}
              </span>
            </div>
          );
        })}
        <label className={styles.row}>
          <span>Override reason</span>
          <input
            className={styles.input}
            value={override}
            onChange={(e) => setOverride(e.target.value)}
            placeholder="only to upload despite failing readiness"
          />
        </label>
        <pre ref={logRef} className={styles.laneLog}>
          {lane.lines.length === 0 && !lane.running && "No lane run yet in this session."}
          {lane.lines.map((l, i) => (
            <span key={i} className={l.s === "stderr" ? styles.warn : l.s === "meta" ? styles.muted : undefined}>
              {l.t + "\n"}
            </span>
          ))}
          {lane.exit !== undefined && !lane.running && (
            <span className={lane.exit === 0 ? styles.ok : styles.error}>
              {lane.exit === 0 ? "done" : `exit ${lane.exit}`}
            </span>
          )}
        </pre>
      </section>

      <section className={styles.storeCol}>
        <div className={styles.sectionTitle}>
          Metadata
          <select className={styles.select} value={locale} onChange={(e) => setLocale(e.target.value)}>
            {locales.map((l) => (
              <option key={l} value={l}>
                {l}
                {meta && !meta.locales[l]?.dirExists ? " (no dir)" : ""}
                {drafts[l] && Object.keys(drafts[l]).length ? " *" : ""}
              </option>
            ))}
          </select>
          <span className={styles.spacer} />
          <span className={styles.status}>{status}</span>
          <button className={styles.btn} onClick={save} disabled={dirtyFields.length === 0}>
            Save {locale}
          </button>
          <button
            className={styles.btn}
            onClick={saveAllDirtyLocales}
            disabled={!Object.values(drafts).some((d) => Object.keys(d).length)}
          >
            Save all
          </button>
        </div>
        {!meta && <p className={styles.muted}>Loading…</p>}
        {meta && current && !current.dirExists && (
          <p>
            No <code>fastlane/metadata/{locale}/</code> yet.{" "}
            <button className={styles.btn} onClick={createLocale}>
              Create it
            </button>
            <span className={styles.small}>
              {" "}
              (URL fields copied from {meta.defaultLocale}; text must be written per market)
            </span>
          </p>
        )}
        {meta &&
          current &&
          current.dirExists &&
          current.fields.map((f) => {
            const value = draft[f.field] ?? f.value;
            const n = len(value);
            const over = n > f.limit;
            const multiline = f.field === "description" || f.field === "release_notes";
            const kw = f.field === "keywords" ? current.keywords : undefined;
            const ref = meta.locales[meta.defaultLocale]?.fields.find((x) => x.field === f.field)?.value;
            return (
              <div key={f.field} className={styles.field}>
                <div className={styles.fieldHead}>
                  <span>{f.field}</span>
                  {f.field === "release_notes" && (
                    <button className={styles.link} onClick={copyReleaseNotesToAll}>
                      apply to all locales
                    </button>
                  )}
                  <span className={over ? styles.error : styles.muted}>
                    {n}/{f.limit}
                  </span>
                </div>
                <textarea
                  className={`${styles.textarea} ${over ? styles.textareaOver : ""}`}
                  rows={multiline ? 8 : 2}
                  value={value}
                  onChange={(e) => setField(f.field, e.target.value)}
                  placeholder={f.present ? "" : "missing"}
                />
                {kw && (
                  <div className={styles.small}>
                    {kw.keywords.length} keywords
                    {kw.spacesAfterCommas && (
                      <span className={styles.warn}> · spaces after commas waste characters</span>
                    )}
                    {kw.duplicates.length > 0 && (
                      <span className={styles.warn}> · duplicates: {kw.duplicates.join(", ")}</span>
                    )}
                    {kw.redundantWithTitle.length > 0 && (
                      <span className={styles.warn}>
                        {" "}
                        · already in name/subtitle (Apple ignores): {kw.redundantWithTitle.join(", ")}
                      </span>
                    )}
                  </div>
                )}
                {locale !== meta.defaultLocale && ref && !multiline && (
                  <div className={styles.ref}>
                    {meta.defaultLocale}: {ref}
                  </div>
                )}
              </div>
            );
          })}
      </section>
    </div>
  );
}
