"use client";

import { useState } from "react";
import type { ScreenSet, SetContent } from "@/lib/schema";
import styles from "./editor.module.css";

interface Props {
  projectName: string;
  /** Unsaved edits: the upload reads the files, so it waits for them. */
  dirty: boolean;
  page: ScreenSet;
  /** This page's text in the current locale. */
  text: SetContent | undefined;
  locale: string;
  /** The app's keywords in this locale (keywords.txt), which a custom page picks from. */
  appKeywords: string[];
  /** The page's screens that give its header and search results images, if any. */
  creative: { header?: string; search?: string };
  onChange: (patch: Partial<ScreenSet>) => void;
  onTextChange: (patch: Partial<SetContent>) => void;
  onDelete: () => void;
}

const PROMO_LIMIT = 170;

/**
 * A custom product page or optimization treatment: its name and link or
 * icon, and per locale its promotional text and keywords. The screens it
 * shows are picked in the sidebar; their copy is edited below as usual and
 * applies to this page only.
 */
interface PushReply {
  steps?: { action: string; what: string }[];
  ascId?: string;
  applied?: boolean;
  error?: string;
  details?: string[];
}

export default function PagePanel({
  projectName,
  dirty,
  page,
  text,
  locale,
  appKeywords,
  creative,
  onChange,
  onTextChange,
  onDelete,
}: Props) {
  const custom = page.kind === "custom";
  const [push, setPush] = useState<{ busy: boolean; reply?: PushReply }>({ busy: false });

  async function runPush(apply: boolean) {
    if (
      apply &&
      !confirm(`Upload "${page.name ?? page.id}" to App Store Connect as a draft? Nothing is submitted for review.`)
    )
      return;
    setPush({ busy: true });
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(projectName)}/asc/push`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ set: page.id, apply }),
      });
      const reply = (await res.json()) as PushReply;
      setPush({ busy: false, reply });
      // The tool stored App Store Connect's id in the manifest; keep it in the editor's copy too,
      // or the next autosave would drop it and the next upload would make a second page.
      if (reply.applied && reply.ascId && reply.ascId !== page.ascId) onChange({ ascId: reply.ascId });
    } catch (err) {
      setPush({ busy: false, reply: { error: (err as Error).message } });
    }
  }
  const changes = push.reply?.steps?.filter((s) => s.action !== "keep" && s.action !== "skip").length ?? 0;
  const promo = text?.promotionalText ?? "";
  const chosen = new Set((text?.keywords ?? []).map((k) => k.toLowerCase()));
  return (
    <div className={styles.pagePanel}>
      <div className={styles.sectionTitle}>
        {custom ? "Custom product page" : "Optimization treatment"} <code>{page.id}</code>
      </div>
      <label className={styles.row}>
        <span>Name</span>
        <input
          className={styles.input}
          value={page.name ?? ""}
          placeholder={page.id}
          onChange={(e) => onChange({ name: e.target.value || undefined })}
        />
      </label>
      {custom ? (
        <label className={styles.row}>
          <span title="where the app opens when someone installs it from this page">Deep link</span>
          <input
            className={styles.input}
            value={page.deepLink ?? ""}
            placeholder="myapp://screen"
            onChange={(e) => onChange({ deepLink: e.target.value || undefined })}
          />
        </label>
      ) : (
        <>
          <label className={styles.row}>
            <span title="treatments with the same experiment name are tested together (up to 3)">Experiment</span>
            <input
              className={styles.input}
              value={page.experiment ?? ""}
              placeholder="store-shots"
              onChange={(e) => onChange({ experiment: e.target.value || undefined })}
            />
          </label>
          <label className={styles.row}>
            <span title="an alternate icon shipped in the binary, by its asset catalog name">App icon</span>
            <input
              className={styles.input}
              value={page.appIconName ?? ""}
              placeholder="default icon"
              onChange={(e) => onChange({ appIconName: e.target.value || undefined })}
            />
          </label>
        </>
      )}
      {custom && (
        <>
          <div className={styles.field}>
            <div className={styles.fieldHead}>
              <span>
                promotional text <span className={styles.muted}>{locale}</span>
              </span>
              <span className={[...promo].length > PROMO_LIMIT ? styles.error : styles.muted}>
                {[...promo].length}/{PROMO_LIMIT}
              </span>
            </div>
            <textarea
              className={styles.textarea}
              rows={3}
              value={promo}
              placeholder="optional; shown above the description on this page"
              onChange={(e) => onTextChange({ promotionalText: e.target.value || undefined })}
            />
          </div>
          <div className={styles.field}>
            <div className={styles.fieldHead}>
              <span title="search shows this page for these keywords; they come from the app's keyword field">
                keywords <span className={styles.muted}>{locale}</span>
              </span>
              <span className={styles.muted}>{chosen.size} chosen</span>
            </div>
            {appKeywords.length === 0 ? (
              <span className={styles.small}>No keywords in fastlane/metadata/{locale}/keywords.txt yet.</span>
            ) : (
              <span className={styles.chips} style={{ flexWrap: "wrap" }}>
                {appKeywords.map((k) => {
                  const on = chosen.has(k.toLowerCase());
                  return (
                    <button
                      key={k}
                      className={`${styles.chip} ${on ? styles.chipActive : ""}`}
                      onClick={() => {
                        const next = on
                          ? (text?.keywords ?? []).filter((x) => x.toLowerCase() !== k.toLowerCase())
                          : [...(text?.keywords ?? []), k];
                        onTextChange({ keywords: next.length ? next : undefined });
                      }}
                    >
                      {k}
                    </button>
                  );
                })}
              </span>
            )}
          </div>
        </>
      )}
      <div className={styles.field}>
        <div className={styles.fieldHead}>
          <span title="uploads drafts with the app's API key; never submits">App Store Connect</span>
          {page.ascId && (
            <span className={styles.muted}>
              {page.ascId}{" "}
              <button
                className={styles.linkBtn}
                title="forget this link, e.g. after deleting the page or ending the test in App Store Connect; the next upload matches by name"
                onClick={() => onChange({ ascId: "" })}
              >
                unlink
              </button>
            </span>
          )}
        </div>
        <div className={styles.inline}>
          <button
            className={styles.btnSmall}
            disabled={push.busy || dirty}
            title={dirty ? "waiting for your edits to save" : "compare with App Store Connect; changes nothing"}
            onClick={() => void runPush(false)}
          >
            {push.busy ? "Working…" : "Check"}
          </button>
          {push.reply?.steps && !push.reply.applied && changes > 0 && (
            <button className={styles.btnSmall} disabled={push.busy || dirty} onClick={() => void runPush(true)}>
              Upload draft ({changes} change{changes === 1 ? "" : "s"})
            </button>
          )}
          <span className={styles.small}>Generate the page first; the upload sends its rendered files.</span>
        </div>
        {push.reply?.error && (
          <p className={styles.error}>
            {push.reply.error}
            {push.reply.details?.length ? `: ${push.reply.details.join("; ")}` : ""}
          </p>
        )}
        {push.reply?.steps && (
          <ul className={styles.pushSteps}>
            {push.reply.applied && <li>Uploaded. Submit it for review in App Store Connect when ready.</li>}
            {!push.reply.applied && changes === 0 && <li>App Store Connect is up to date.</li>}
            {push.reply.steps.map((s, i) => (
              <li key={i}>
                <span className={styles.muted}>{s.action}</span> {s.what}
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className={styles.small}>
        Header image: {creative.header ? <code>{creative.header}</code> : "none"} · Search results image:{" "}
        {creative.search ? <code>{creative.search}</code> : "none"}
        {!creative.header && !creative.search && (
          <> (add a screen with the Header, Search results or Header + search target; they show on iOS 27 and later)</>
        )}
      </div>
      <div className={styles.inline}>
        <span className={styles.small}>
          Screens: pick them in the sidebar. Copy you edit now applies to this {custom ? "page" : "treatment"} only.
        </span>
        <span className={styles.spacer} />
        <button className={styles.btnDanger} onClick={onDelete}>
          Delete {custom ? "page" : "treatment"}
        </button>
      </div>
    </div>
  );
}
