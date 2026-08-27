"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReleaseStatus } from "@/lib/release";
import type { LocaleContent, Manifest, ScreenDefinition } from "@/lib/schema";
import type { TargetProfile } from "@/lib/targets";
import styles from "./editor.module.css";

interface MetadataSnapshot {
  locales: Record<string, { dirExists: boolean; fields: { field: string; value: string }[] }>;
}

interface ProjectSnapshot {
  manifest?: Manifest;
  content: Record<string, LocaleContent>;
}

/** How wide one screenshot is drawn on the store page, as a fraction of the page width. */
const SHOT_WIDTH = { ios: 0.43, android: 0.42 } as const;
/** Page width in CSS px for the mock — an iPhone 15/16 viewport. */
const PAGE_W = 390;

/**
 * Listing preview: the generated screenshots inside the product page they will
 * actually appear on, with the app's real metadata and a marker for the fold —
 * the point where the store stops showing screenshots until someone scrolls.
 *
 * It reads the files `deliver`/`supply` would upload (the release status), so
 * "what will go on the App Store" is answered with the artwork on disk, not a
 * re-render of the drafts.
 */
export default function ListingPanel({
  name,
  locales,
  targets,
  defaultLocale,
}: {
  name: string;
  locales: string[];
  targets: TargetProfile[];
  defaultLocale: string;
}) {
  const [release, setRelease] = useState<ReleaseStatus | null>(null);
  const [meta, setMeta] = useState<MetadataSnapshot | null>(null);
  const [snap, setSnap] = useState<ProjectSnapshot | null>(null);
  /** Draft artwork per screen id, rendered on demand for shots that are not generated. */
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [locale, setLocale] = useState(defaultLocale);
  const [targetId, setTargetId] = useState(targets[0]?.id ?? "");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const [r, m, p] = await Promise.all([
      fetch(`/api/projects/${encodeURIComponent(name)}/release`, { cache: "no-store" }),
      fetch(`/api/projects/${encodeURIComponent(name)}/metadata`, { cache: "no-store" }),
      fetch(`/api/projects/${encodeURIComponent(name)}`, { cache: "no-store" }),
    ]);
    if (r.ok) setRelease(((await r.json()) as { release: ReleaseStatus }).release);
    else setError(`release status failed: ${r.status}`);
    if (m.ok) setMeta((await m.json()) as MetadataSnapshot);
    if (p.ok) setSnap((await p.json()) as ProjectSnapshot);
    setDrafts({});
  }, [name]);

  useEffect(() => {
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load]);

  const target = targets.find((t) => t.id === targetId) ?? targets[0];
  const set = release?.sets.find((s) => s.target === targetId && s.locale === locale);
  const field = (f: string) => meta?.locales[locale]?.fields.find((x) => x.field === f)?.value ?? "";

  const shots = useMemo(() => (set?.shots ?? []).filter((s) => s.state !== "blocked"), [set]);
  const missing = shots.filter((s) => s.state === "missing").length;
  const stale = shots.filter((s) => s.state === "stale").length;
  const blocked = (set?.shots.length ?? 0) - shots.length;

  // Screens with no generated file yet: show the draft the renderer would
  // produce, so the listing is never empty just because generate has not run.
  const draftScreens = useMemo(() => {
    const ids = new Set((set?.shots ?? []).filter((s) => s.state === "missing").map((s) => s.screen));
    return (snap?.manifest?.screens ?? []).filter((s) => ids.has(s.id));
  }, [set, snap]);

  const draftKey = draftScreens.map((s) => s.id).join(",") + `|${locale}|${targetId}`;
  useEffect(() => {
    if (!draftScreens.length || !targetId) return;
    let cancelled = false;
    const run = async () => {
      const entries = await Promise.all(
        draftScreens.map(async (screen: ScreenDefinition) => {
          try {
            const res = await fetch(`/api/projects/${encodeURIComponent(name)}/preview`, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                targetId,
                locale,
                screen,
                fields: snap?.content[locale]?.screens[screen.id] ?? {},
                direction: snap?.content[locale]?.direction,
              }),
            });
            return res.ok ? ([screen.id, await res.text()] as const) : null;
          } catch {
            return null;
          }
        }),
      );
      if (cancelled) return;
      setDrafts((d) => ({ ...d, ...Object.fromEntries(entries.filter(Boolean) as (readonly [string, string])[]) }));
    };
    void run();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftKey, name]);

  const platform = target?.platform ?? "ios";
  const shotW = Math.round(PAGE_W * SHOT_WIDTH[platform]);
  const shotH = target ? Math.round((shotW * target.height) / target.width) : 0;
  const gap = 10;
  const sidePad = 16;
  // Screenshots visible before anyone scrolls the row: the page cuts the strip here.
  const visible = (PAGE_W - sidePad) / (shotW + gap);

  const fileUrl = (rel: string) =>
    `/api/projects/${encodeURIComponent(name)}/file?kind=shot&path=${encodeURIComponent(rel)}`;

  /** One screenshot slot: the file on disk, or the draft, or a placeholder. */
  function Shot({ shot, dim }: { shot: { rel: string; screen: string; slice: number; state: string }; dim?: boolean }) {
    const draft = shot.state === "missing" ? drafts[shot.screen] : undefined;
    const scale = target ? shotW / target.width : 1;
    return (
      <div className={`${styles.shotFrame} ${dim ? styles.belowFold : ""}`} style={{ width: shotW, height: shotH }}>
        {shot.state !== "missing" ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={fileUrl(shot.rel)} alt={shot.screen} width={shotW} height={shotH} />
        ) : draft && target ? (
          <div style={{ width: shotW, height: shotH, overflow: "hidden", position: "relative" }}>
            <iframe
              title={`${shot.screen} draft`}
              srcDoc={draft}
              scrolling="no"
              style={{
                position: "absolute",
                left: -shot.slice * shotW,
                top: 0,
                width: target.width,
                height: target.height,
                border: 0,
                transform: `scale(${scale})`,
                transformOrigin: "0 0",
                pointerEvents: "none",
              }}
            />
            <span className={styles.draftTag}>draft</span>
          </div>
        ) : (
          <span className={styles.shotMissing}>not generated</span>
        )}
      </div>
    );
  }

  return (
    <div className={styles.storeArea}>
      <div className={styles.listingBar}>
        <label className={styles.row}>
          <span>Locale</span>
          <select className={styles.select} value={locale} onChange={(e) => setLocale(e.target.value)}>
            {locales.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.row}>
          <span>Target</span>
          <select className={styles.select} value={targetId} onChange={(e) => setTargetId(e.target.value)}>
            {targets.map((t) => (
              <option key={t.id} value={t.id}>
                {t.displayClass} · {t.platform === "ios" ? "App Store" : "Play"}
              </option>
            ))}
          </select>
        </label>
        <button className={styles.btnSmall} onClick={() => void load()}>
          Refresh
        </button>
        <span className={styles.muted}>
          {shots.length} screenshot{shots.length === 1 ? "" : "s"}
          {shots.length > 10 && " — the App Store shows at most 10"}
          {missing > 0 && ` · ${missing} shown as drafts (not generated yet)`}
          {stale > 0 && ` · ${stale} stale`}
          {blocked > 0 && ` · ${blocked} blocked`}
        </span>
      </div>
      {error && <p className={styles.fail}>{error}</p>}

      <div className={styles.listingWrap}>
        {/* The product page, clipped to a phone viewport: exactly what a visitor sees. */}
        <div className={styles.phonePage} style={{ width: PAGE_W }}>
          <div className={styles.pageHeader}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              className={styles.appIcon}
              src={`/api/projects/${encodeURIComponent(name)}/file?kind=icon`}
              alt=""
              onError={(e) => (e.currentTarget.style.visibility = "hidden")}
            />
            <div className={styles.appText}>
              <strong className={styles.appName}>{field("name") || "(no name)"}</strong>
              <span className={styles.appSubtitle}>{field("subtitle") || "(no subtitle)"}</span>
            </div>
            <span className={styles.getBtn}>{platform === "ios" ? "GET" : "Install"}</span>
          </div>

          <div className={styles.shotRowClip}>
            <div className={styles.shotRow} style={{ gap, padding: `0 ${sidePad}px` }}>
              {shots.length === 0 && <p className={styles.muted}>Nothing generated for this locale and target yet.</p>}
              {shots.map((s) => (
                <Shot key={s.rel} shot={s} />
              ))}
            </div>
          </div>

          <p className={styles.appDescription}>{field("description") || field("promotional_text") || ""}</p>
        </div>

        {/* The same row unclipped, with the fold marked. */}
        <div className={styles.foldPanel}>
          <div className={styles.foldHead}>
            <strong>The whole set</strong>
            <span className={styles.muted}>
              on a phone-sized store page about {visible.toFixed(1)} screenshots show before anyone scrolls — everything
              right of the line is a scroll away
            </span>
          </div>
          <div className={styles.foldRow} style={{ gap }}>
            {shots.map((s, i) => (
              <div key={s.rel} className={styles.foldItem}>
                <Shot shot={s} dim={i + 1 > visible} />
                <span className={styles.foldLabel}>
                  {String(i + 1).padStart(2, "0")} {s.screen}
                  {s.state === "stale" && <span className={styles.warn}> · stale</span>}
                </span>
              </div>
            ))}
            {shots.length > 0 && (
              <span
                className={styles.foldLine}
                style={{ left: Math.round(visible * (shotW + gap)) }}
                data-label="fold"
              />
            )}
          </div>
          <p className={styles.muted}>
            {platform === "ios"
              ? "Uploaded from fastlane/screenshots/<locale>/ by deliver. The App Store takes 1-10 per device class and shows them in this order."
              : "Uploaded from fastlane/metadata/android/<locale>/images/ by supply. Google Play takes 2-8 phone screenshots."}
          </p>
        </div>
      </div>
    </div>
  );
}
