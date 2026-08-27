"use client";

import { useState } from "react";
import type { ScreenDefinition } from "@/lib/schema";
import type { TemplateDescriptor } from "@/templates/types";
import styles from "./editor.module.css";

/**
 * Full strip: one artwork across 2-3 consecutive store screenshots. It is a
 * panorama screen wearing a strip template — the renderer draws one wide canvas
 * and slices it into consecutive files, so the headline, the path and the
 * background run unbroken from one screenshot into the next.
 *
 * This panel owns the structural side (template, slices, one capture per slice);
 * copy and positioning stay in Screens, where every other screen is edited.
 */
export default function StripPanel({
  screens,
  templates,
  onChange,
  onOpenScreen,
}: {
  screens: ScreenDefinition[];
  templates: TemplateDescriptor[];
  onChange: (screens: ScreenDefinition[]) => void;
  onOpenScreen: (id: string) => void;
}) {
  const stripTemplates = templates.filter((t) => t.strip);
  const strips = screens.filter((s) => s.panorama);
  const [newTemplate, setNewTemplate] = useState(stripTemplates[0]?.id ?? "");
  const [newSlices, setNewSlices] = useState(3);
  const [newId, setNewId] = useState("strip");

  const patch = (id: string, changes: Partial<ScreenDefinition>) =>
    onChange(screens.map((s) => (s.id === id ? { ...s, ...changes } : s)));

  /**
   * A strip occupies `slices` consecutive orders. Growing it would collide with
   * the screens after it, so they shift by the same amount (and shift back when
   * it shrinks).
   */
  function setSlices(strip: ScreenDefinition, slices: number) {
    const delta = slices - (strip.panorama?.slices ?? 1);
    onChange(
      screens.map((s) => {
        if (s.id === strip.id)
          return { ...s, panorama: { ...(s.panorama ?? {}), slices } as ScreenDefinition["panorama"] };
        return s.order > strip.order ? { ...s, order: Math.max(1, s.order + delta) } : s;
      }),
    );
  }

  /** Raw file each slice resolves to — the same interpolation the render plan does. */
  function sliceFiles(screen: ScreenDefinition): string[] {
    const n = screen.panorama?.slices ?? 1;
    const per = screen.panorama?.perSliceSources === true;
    return Array.from({ length: n }, (_, i) =>
      screen.source.filePattern
        .replaceAll("{order}", String(screen.order + (per ? i : 0)).padStart(2, "0"))
        .replaceAll("{id}", screen.id)
        .replaceAll("{slice}", String(i + 1))
        .replaceAll("{locale}", "<locale>")
        .replaceAll("{device}", "<device>")
        .replaceAll("{target}", "<target>"),
    );
  }

  function createStrip() {
    const id = newId
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/^-|-$/g, "");
    if (!id || !newTemplate || screens.some((s) => s.id === id)) return;
    // A strip occupies `slices` consecutive orders, so it starts after everything else.
    const order = Math.max(0, ...screens.map((s) => s.order + ((s.panorama?.slices ?? 1) - 1))) + 1;
    onChange([
      ...screens,
      {
        id,
        order,
        enabled: true,
        template: newTemplate,
        source: { filePattern: "{order}-{id}.png", localized: true },
        panorama: { slices: newSlices, perSliceSources: true },
        overrides: {},
        layers: [],
      } as ScreenDefinition,
    ]);
    onOpenScreen(id);
  }

  function removeStrip(id: string) {
    if (!confirm(`Remove the strip "${id}"? Its copy stays in the content files until you delete it.`)) return;
    onChange(screens.filter((s) => s.id !== id));
  }

  return (
    <div className={styles.storeArea}>
      <div className={styles.sectionTitle}>Full strip</div>
      <p className={styles.muted}>
        One artwork across {newSlices} consecutive screenshots: the headline, the background and the shapes run from one
        screenshot into the next, and each slice can show its own capture. Rendered once and sliced, so the seams line
        up exactly.
      </p>

      {strips.length === 0 ? null : (
        <ul className={styles.stripList}>
          {strips.map((s) => {
            const tpl = templates.find((t) => t.id === s.template);
            const files = sliceFiles(s);
            return (
              <li key={s.id} className={styles.stripCard}>
                <div className={styles.stripHead}>
                  <strong>{s.id}</strong>
                  <span className={styles.muted}>
                    orders {s.order}–{s.order + (s.panorama?.slices ?? 1) - 1}
                  </span>
                  {!tpl?.strip && <span className={`${styles.dot} ${styles.warn}`} title="not a strip template" />}
                  <span className={styles.grow} />
                  <button className={styles.btnSmall} onClick={() => onOpenScreen(s.id)}>
                    Edit copy
                  </button>
                  <button className={styles.btnSmall} onClick={() => removeStrip(s.id)}>
                    Remove
                  </button>
                </div>

                <label className={styles.row}>
                  <span title="templates that compose the whole strip">Strip template</span>
                  <select
                    className={styles.select}
                    value={s.template}
                    onChange={(e) => patch(s.id, { template: e.target.value })}
                  >
                    {!tpl?.strip && <option value={s.template}>{s.template} (single-screen)</option>}
                    {stripTemplates.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                </label>

                <label className={styles.row}>
                  <span title="how many store screenshots this artwork covers">Screens covered</span>
                  <select
                    className={styles.select}
                    value={s.panorama?.slices ?? 2}
                    onChange={(e) => setSlices(s, Number(e.target.value))}
                  >
                    <option value={2}>2</option>
                    <option value={3}>3</option>
                  </select>
                </label>

                <label className={styles.row}>
                  <span title="each slice resolves its own raw capture instead of repeating slice 1's">
                    One capture per slice
                  </span>
                  <input
                    type="checkbox"
                    checked={s.panorama?.perSliceSources === true}
                    onChange={(e) =>
                      patch(s.id, {
                        panorama: {
                          slices: (s.panorama?.slices ?? 2) as 2 | 3,
                          perSliceSources: e.target.checked,
                        },
                      })
                    }
                  />
                </label>

                <label className={styles.row}>
                  <span title="{order} counts up per slice; {slice} is 1-based">Capture pattern</span>
                  <input
                    className={styles.input}
                    value={s.source.filePattern}
                    onChange={(e) => patch(s.id, { source: { ...s.source, filePattern: e.target.value } })}
                  />
                </label>

                <div className={styles.stripFiles}>
                  {files.map((f, i) => (
                    <span key={i} className={styles.chip}>
                      slice {i + 1}: {f}
                    </span>
                  ))}
                </div>

                <p className={styles.muted}>
                  Copy: slice 1 uses <code>headline</code>/<code>caption</code>, slice 2 <code>headline2</code>, slice 3{" "}
                  <code>headline3</code> — all editable under Screens → {s.id}.
                </p>
              </li>
            );
          })}
        </ul>
      )}

      {stripTemplates.length === 0 ? (
        <p className={styles.muted}>No strip templates are registered.</p>
      ) : (
        <div className={styles.stripCard}>
          <div className={styles.stripHead}>
            <strong>New strip</strong>
          </div>
          <label className={styles.row}>
            <span>Screen id</span>
            <input className={styles.input} value={newId} onChange={(e) => setNewId(e.target.value)} />
          </label>
          <label className={styles.row}>
            <span>Strip template</span>
            <select className={styles.select} value={newTemplate} onChange={(e) => setNewTemplate(e.target.value)}>
              {stripTemplates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
          <label className={styles.row}>
            <span>Screens covered</span>
            <select className={styles.select} value={newSlices} onChange={(e) => setNewSlices(Number(e.target.value))}>
              <option value={2}>2</option>
              <option value={3}>3</option>
            </select>
          </label>
          <button className={styles.btnPrimary} onClick={createStrip}>
            Create strip
          </button>
        </div>
      )}
    </div>
  );
}
