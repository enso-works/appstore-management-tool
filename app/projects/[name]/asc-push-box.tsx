"use client";

import { useState } from "react";
import styles from "./editor.module.css";

interface Props {
  projectName: string;
  /** Unsaved edits: the upload reads the files, so it waits for them. */
  dirty: boolean;
  /** A set id, or "default" for the app's own product page. */
  set: string;
  /** What the confirmation names. */
  label: string;
  /** The page's or treatment's App Store Connect id; named sets only. */
  ascId?: string;
  /** App Store Connect's id after an upload, or "" to unlink. Named sets only. */
  onLinked?: (ascId: string) => void;
  hint: string;
}

interface PushReply {
  steps?: { action: string; what: string }[];
  ascId?: string;
  applied?: boolean;
  error?: string;
  details?: string[];
}

/**
 * App Store Connect for one page: Check shows what an upload would change,
 * Upload draft makes those changes. Nothing is ever submitted for review.
 */
export default function AscPushBox({ projectName, dirty, set, label, ascId, onLinked, hint }: Props) {
  const [push, setPush] = useState<{ busy: boolean; reply?: PushReply }>({ busy: false });

  async function runPush(apply: boolean) {
    if (apply && !confirm(`Upload "${label}" to App Store Connect as a draft? Nothing is submitted for review.`))
      return;
    setPush({ busy: true });
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(projectName)}/asc/push`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ set, apply }),
      });
      const reply = (await res.json()) as PushReply;
      setPush({ busy: false, reply });
      // The tool stored App Store Connect's id in the manifest; keep it in the editor's copy too,
      // or the next autosave would drop it and the next upload would make a second page.
      if (onLinked && reply.applied && reply.ascId && reply.ascId !== ascId) onLinked(reply.ascId);
    } catch (err) {
      setPush({ busy: false, reply: { error: (err as Error).message } });
    }
  }
  const changes = push.reply?.steps?.filter((s) => s.action !== "keep" && s.action !== "skip").length ?? 0;
  return (
    <div className={styles.field}>
      <div className={styles.fieldHead}>
        <span title="uploads drafts with the app's API key; never submits">App Store Connect</span>
        {ascId && onLinked && (
          <span className={styles.muted}>
            {ascId}{" "}
            <button
              className={styles.linkBtn}
              title="forget this link, e.g. after deleting the page or ending the test in App Store Connect; the next upload matches by name"
              onClick={() => onLinked("")}
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
        <span className={styles.small}>{hint}</span>
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
  );
}
