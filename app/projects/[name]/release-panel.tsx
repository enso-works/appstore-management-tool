"use client";

import { useCallback, useEffect, useState } from "react";
import type { ReadinessReport } from "@/lib/readiness";
import type { ReleaseStatus, ShotState } from "@/lib/release";
import styles from "./editor.module.css";

interface MetadataSnapshot {
  locales: Record<string, { dirExists: boolean; fields: { field: string; value: string }[] }>;
}

const STATE_BADGE: Record<ShotState, "pass" | "warn" | "fail"> = {
  ok: "pass",
  stale: "warn",
  missing: "fail",
  blocked: "fail",
};

/**
 * Release sign-off: the actual generated PNGs per locale and target (the files
 * an upload would ship), each checked against the renderer's inputs hash, next
 * to a metadata summary and a per-locale reviewed checkbox persisted in
 * store/release-signoff.json.
 */
export default function ReleasePanel({
  name,
  locales,
  readiness,
}: {
  name: string;
  locales: string[];
  readiness: ReadinessReport;
}) {
  const [release, setRelease] = useState<ReleaseStatus | null>(null);
  const [meta, setMeta] = useState<MetadataSnapshot | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const [r, m] = await Promise.all([
      fetch(`/api/projects/${encodeURIComponent(name)}/release`, { cache: "no-store" }),
      fetch(`/api/projects/${encodeURIComponent(name)}/metadata`, { cache: "no-store" }),
    ]);
    if (r.ok) setRelease(((await r.json()) as { release: ReleaseStatus }).release);
    else setError(`release status failed: ${r.status}`);
    if (m.ok) setMeta((await m.json()) as MetadataSnapshot);
  }, [name]);

  useEffect(() => {
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load]);

  const toggle = async (locale: string, reviewed: boolean) => {
    setBusy(locale);
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(name)}/release`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ locale, reviewed }),
      });
      if (res.ok) setRelease(((await res.json()) as { release: ReleaseStatus }).release);
      else setError(`sign-off failed: ${res.status}`);
    } finally {
      setBusy(null);
    }
  };

  if (!release) return <p className={styles.muted}>{error || "Loading release status…"}</p>;

  const signoffs = release.signoffsStale ? {} : release.signoffs;
  const reviewed = locales.filter((l) => signoffs[l]);
  const totals = release.sets.reduce(
    (a, s) => ({ ok: a.ok + s.ok, stale: a.stale + s.stale, bad: a.bad + s.missing + s.blocked }),
    { ok: 0, stale: 0, bad: 0 },
  );
  const shippable = readiness.status === "pass" && totals.stale === 0 && totals.bad === 0;
  const ready = shippable && reviewed.length === locales.length;

  const metaLine = (locale: string): string => {
    const fields = meta?.locales[locale]?.fields;
    if (!fields) return "";
    const get = (f: string) => fields.find((x) => x.field === f)?.value?.trim() ?? "";
    return [get("name"), get("subtitle")].filter(Boolean).join(" — ");
  };
  const notesLine = (locale: string): string => {
    const v = meta?.locales[locale]?.fields.find((x) => x.field === "release_notes")?.value?.trim() ?? "";
    return v.length > 140 ? v.slice(0, 140) + "…" : v;
  };

  return (
    <div className={styles.releaseWrap}>
      <section className={styles.releaseHeader}>
        <span className={`${styles.badge} ${ready ? styles.pass : shippable ? styles.warn : styles.fail}`}>
          {ready
            ? "ready to ship"
            : shippable
              ? `review pending ${reviewed.length}/${locales.length}`
              : "not shippable"}
        </span>
        <span className={styles.muted}>
          {release.appVersion ? `v${release.appVersion}` : "no app version"}
          {release.generatedAt ? ` · generated ${new Date(release.generatedAt).toLocaleString()}` : " · never generated"}
          {release.generatedFor && release.generatedFor !== release.appVersion
            ? ` (for v${release.generatedFor}!)`
            : ""}
          {` · ${totals.ok} ok`}
          {totals.stale ? ` · ${totals.stale} stale` : ""}
          {totals.bad ? ` · ${totals.bad} missing` : ""}
        </span>
        {release.signoffsStale && (
          <span className={styles.warn}>earlier sign-offs were for another version and were reset</span>
        )}
        {readiness.status !== "pass" && (
          <span className={styles.muted}>
            readiness: {readiness.checks.filter((c) => c.status === "fail").map((c) => c.title).join("; ") || readiness.status}
          </span>
        )}
        {error && <span className={styles.error}>{error}</span>}
      </section>

      {locales.map((locale) => {
        const sets = release.sets.filter((s) => s.locale === locale);
        const localeBad = sets.some((s) => s.stale + s.missing + s.blocked > 0);
        return (
          <section key={locale} className={styles.releaseCard}>
            <div className={styles.releaseCardHead}>
              <strong>{locale}</strong>
              <span className={`${styles.badge} ${localeBad ? styles.warn : styles.pass}`}>
                {localeBad ? "attention" : "ok"}
              </span>
              <span className={styles.muted}>{metaLine(locale)}</span>
              <span className={styles.spacer} />
              <label className={styles.check} title="persisted in store/release-signoff.json for this app version">
                <input
                  type="checkbox"
                  checked={Boolean(signoffs[locale])}
                  disabled={busy === locale}
                  onChange={(e) => void toggle(locale, e.target.checked)}
                />
                reviewed
                {signoffs[locale] ? (
                  <span className={styles.muted}> {new Date(signoffs[locale].at).toLocaleString()}</span>
                ) : null}
              </label>
            </div>
            {notesLine(locale) && <p className={styles.releaseNotes}>{notesLine(locale)}</p>}
            {sets.map((set) => (
              <div key={set.target} className={styles.releaseRow}>
                <span className={styles.releaseTarget}>{set.target}</span>
                <div className={styles.releaseThumbs}>
                  {set.shots.map((shot) => (
                    <figure key={shot.rel} className={styles.releaseThumb} title={shot.reason ?? shot.rel}>
                      {shot.state === "blocked" || shot.state === "missing" ? (
                        <span className={styles.releaseThumbEmpty}>{shot.screen}</span>
                      ) : (
                        // eslint-disable-next-line @next/next/no-img-element -- local API file, not an optimizable asset
                        <img
                          src={`/api/projects/${encodeURIComponent(name)}/file?kind=shot&path=${encodeURIComponent(shot.rel)}`}
                          alt={`${locale} ${shot.screen}`}
                          loading="lazy"
                        />
                      )}
                      <figcaption>
                        <span className={`${styles.dot} ${styles[STATE_BADGE[shot.state]]}`} />
                        {shot.screen}
                        {shot.state !== "ok" ? ` · ${shot.state}` : ""}
                      </figcaption>
                    </figure>
                  ))}
                </div>
              </div>
            ))}
            {sets.length === 0 && <p className={styles.muted}>nothing planned for this locale</p>}
          </section>
        );
      })}
    </div>
  );
}
