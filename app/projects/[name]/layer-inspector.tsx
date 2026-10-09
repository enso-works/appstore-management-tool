"use client";

import { useEffect, useRef, useState } from "react";
import { layersFor } from "@/lib/layers";
import type { Layer } from "@/lib/schema";
import { shortLabel, type TargetProfile } from "@/lib/targets";
import ColorField from "./color-field";
import styles from "./editor.module.css";

interface Asset {
  rel: string;
  name: string;
  bytes: number;
}

interface Props {
  projectName: string;
  layers: Layer[];
  selectedLayerId: string | null;
  onSelect: (id: string) => void;
  onChange: (layers: Layer[]) => void;
  /** Current locale's text for a text layer (content field <layer id>). */
  textOf: (id: string) => string;
  onTextChange: (id: string, text: string) => void;
  /** Copy a text layer's text, in every locale, to another layer id. */
  onCopyText: (from: string, to: string) => void;
  /** The project's targets, and the one the preview shows. */
  targets: TargetProfile[];
  targetId: string;
  /** Switch the preview to another target. */
  onShowTarget: (id: string) => void;
  /** Delete an element entirely (layers + localized text + selection). */
  onDelete: (id: string) => void;
  locale: string;
  /** target.height / target.width, for vertical centring. */
  aspect: number;
  /** Panorama slices of the screen (1 = normal), for per-slide centring. */
  slices: number;
}

let counter = 0;

function freshId(prefix: string, layers: Layer[]): string {
  for (;;) {
    counter += 1;
    const id = `${prefix}${counter}`;
    if (!layers.some((l) => l.id === id)) return id;
  }
}

/** "All targets", or the short names of the targets a layer is limited to. */
function targetSummary(layer: Layer, targets: TargetProfile[]): string {
  if (!layer.targets) return "all";
  return targets
    .filter((t) => layer.targets!.includes(t.id))
    .map((t) => shortLabel(t, targets))
    .join(", ");
}

/**
 * Asset-library elements on a screen (roadmap "layers"): add images from
 * store/assets or extra text elements, position them by dragging in the
 * preview, fine-tune here. Text layers are localized via content fields.
 * A layer can be limited to some targets, so a wide iPhone canvas and a
 * squarer iPad one each get their own copy of a character, placed for it.
 */
export default function LayerInspector({
  projectName,
  layers,
  selectedLayerId,
  onSelect,
  onChange,
  textOf,
  onTextChange,
  onCopyText,
  targets,
  targetId,
  onShowTarget,
  onDelete,
  locale,
  aspect,
  slices,
}: Props) {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [uploading, setUploading] = useState(false);
  const [picking, setPicking] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const layer = layers.find((l) => l.id === selectedLayerId) ?? null;
  const target = targets.find((t) => t.id === targetId);
  const drawn = new Set(layersFor(layers, targetId).map((l) => l.id));
  const assetUrl = (rel: string) =>
    `/api/projects/${encodeURIComponent(projectName)}/file?kind=asset&path=${encodeURIComponent(rel)}`;
  // Art first (characters, logos, images), backgrounds last: they are rarely a layer.
  const groups = Object.entries(
    assets.reduce<Record<string, Asset[]>>((acc, a) => {
      const dir = a.rel.includes("/") ? a.rel.slice(0, a.rel.lastIndexOf("/")) : "";
      (acc[dir] ??= []).push(a);
      return acc;
    }, {}),
  ).sort(([a], [b]) => Number(a === "backgrounds") - Number(b === "backgrounds") || a.localeCompare(b));

  useEffect(() => {
    let alive = true;
    void fetch(`/api/projects/${encodeURIComponent(projectName)}/assets`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { assets: [] }))
      .then((d) => {
        if (alive) setAssets(d.assets ?? []);
      });
    return () => {
      alive = false;
    };
  }, [projectName]);

  function patch(id: string, p: Partial<Layer>) {
    onChange(layers.map((l) => (l.id === id ? ({ ...l, ...p } as Layer) : l)));
  }

  function addImage(assetRel: string) {
    const id = freshId("img", layers);
    onChange([...layers, { type: "image", id, asset: assetRel, x: 0.75, y: 0.25, width: 0.3 }]);
    onSelect(id);
    setPicking(false);
  }

  /** Turn a target on or off for a layer; all of them on is the same as no list. */
  function toggleTarget(l: Layer, id: string) {
    const current = l.targets ?? targets.map((t) => t.id);
    const next = current.includes(id) ? current.filter((t) => t !== id) : [...current, id];
    if (next.length === 0) return;
    const all = targets.every((t) => next.includes(t.id));
    patch(l.id, { targets: all ? undefined : targets.map((t) => t.id).filter((t) => next.includes(t)) });
  }

  /**
   * Give the shown target its own copy of a layer: the copy is limited to this
   * target and the original stops drawing here, so moving one no longer moves
   * the other.
   */
  function splitForTarget(l: Layer) {
    const shared = (l.targets ?? targets.map((t) => t.id)).filter((t) => t !== targetId);
    if (shared.length === 0) return;
    const family = target?.family ?? "target";
    const id = layers.some((x) => x.id === `${l.id}-${family}`) ? freshId(`${l.id}-`, layers) : `${l.id}-${family}`;
    const copy = { ...structuredClone(l), id, targets: [targetId] } as Layer;
    const next = layers.flatMap((x) => (x.id === l.id ? [{ ...x, targets: shared } as Layer, copy] : [x]));
    onChange(next);
    if (l.type === "text") onCopyText(l.id, id);
    onSelect(id);
  }

  function addText() {
    const id = freshId("txt", layers);
    onChange([
      ...layers,
      { type: "text", id, x: 0.5, y: 0.55, width: 0.6, size: 0.045, weight: 600, align: "center", font: "body" },
    ]);
    onTextChange(id, "New text");
    onSelect(id);
  }

  async function upload(file: File) {
    setUploading(true);
    try {
      const buf = await file.arrayBuffer();
      let bin = "";
      const bytes = new Uint8Array(buf);
      for (let i = 0; i < bytes.length; i += 0x8000)
        bin += String.fromCharCode(...bytes.subarray(i, Math.min(i + 0x8000, bytes.length)));
      const res = await fetch(`/api/projects/${encodeURIComponent(projectName)}/assets`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ fileName: file.name, dataBase64: btoa(bin), dir: "images" }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error);
      setAssets(body.assets);
      addImage(body.asset.rel);
    } catch (err) {
      alert(`Upload failed: ${(err as Error).message}`);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  const num = (v: unknown, d: number) => (typeof v === "number" ? v : d);

  return (
    <div className={styles.bgEditor}>
      <div className={styles.inline}>
        <button
          className={`${styles.btnSmall} ${picking ? styles.chipActive : ""}`}
          title="add an image from store/assets"
          onClick={() => setPicking((p) => !p)}
        >
          + art
        </button>
        <button className={styles.btnSmall} disabled={uploading} onClick={() => fileRef.current?.click()}>
          {uploading ? "…" : "Upload"}
        </button>
        <button className={styles.btnSmall} onClick={addText}>
          + text
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".png,.jpg,.jpeg,.webp,.svg"
          style={{ display: "none" }}
          onChange={(e) => e.target.files?.[0] && void upload(e.target.files[0])}
        />
      </div>

      {picking && (
        <div className={styles.artPicker}>
          {assets.length === 0 && (
            <span className={styles.small}>No images in store/assets yet. Upload one, or add files there.</span>
          )}
          {groups.map(([dir, items]) => (
            <div key={dir || "."}>
              <div className={styles.artGroup}>{dir || "store/assets"}</div>
              <div className={styles.artGrid}>
                {items.map((a) => (
                  <button key={a.rel} className={styles.artTile} title={a.rel} onClick={() => addImage(a.rel)}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={assetUrl(a.rel)} alt="" loading="lazy" />
                    <span>{a.name.replace(/\.[^.]+$/, "")}</span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {layers.length > 0 && (
        <div className={styles.layerList}>
          {layers.map((l) => (
            <div
              key={l.id}
              className={`${styles.layerRow} ${l.id === selectedLayerId ? styles.layerRowActive : ""} ${drawn.has(l.id) ? "" : styles.layerRowOff}`}
            >
              <button
                className={styles.layerRowMain}
                onClick={() => onSelect(l.id)}
                title={`${l.type === "image" ? l.asset : "text element"}${drawn.has(l.id) ? "" : ` - not drawn on ${target ? shortLabel(target, targets) : targetId}`}`}
              >
                {l.type === "image" ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img className={styles.layerThumb} src={assetUrl(l.asset)} alt="" loading="lazy" />
                ) : (
                  <span className={styles.layerKind}>T</span>
                )}
                <span className={styles.layerName}>
                  {l.type === "image" ? (l.asset.split("/").pop() ?? l.asset) : textOf(l.id) || "(empty text)"}
                </span>
                {targets.length > 1 && <span className={styles.layerTargets}>{targetSummary(l, targets)}</span>}
              </button>
              <button className={styles.layerDelete} title="delete this element (Del)" onClick={() => onDelete(l.id)}>
                {"\u00d7"}
              </button>
            </div>
          ))}
        </div>
      )}

      {layer && (
        <>
          {!drawn.has(layer.id) && (
            <div className={styles.layerNotice}>
              <span>Not drawn on {target ? shortLabel(target, targets) : targetId}.</span>
              <span className={styles.spacer} />
              {layer.targets?.[0] && (
                <button className={styles.btnSmall} onClick={() => onShowTarget(layer.targets![0])}>
                  Show {shortLabel(targets.find((t) => t.id === layer.targets![0]) ?? targets[0], targets)}
                </button>
              )}
            </div>
          )}
          {targets.length > 1 && (
            <div className={styles.row}>
              <span title="the targets this element is drawn on">Targets</span>
              <span className={styles.chips} style={{ flexWrap: "wrap", margin: 0 }}>
                {targets.map((t) => {
                  const on = !layer.targets || layer.targets.includes(t.id);
                  return (
                    <button
                      key={t.id}
                      className={`${styles.chip} ${on ? styles.chipActive : ""}`}
                      title={`${t.width}×${t.height}${on ? "" : " - not drawn here"}`}
                      onClick={() => toggleTarget(layer, t.id)}
                    >
                      {shortLabel(t, targets)}
                    </button>
                  );
                })}
              </span>
            </div>
          )}
          {targets.length > 1 && drawn.has(layer.id) && (layer.targets?.length ?? targets.length) > 1 && (
            <div className={styles.inline}>
              <span className={styles.small}>Moving it moves it on every target in blue.</span>
              <span className={styles.spacer} />
              <button
                className={styles.btnSmall}
                title={`make a copy for ${target ? shortLabel(target, targets) : "this target"} only, so it can be placed on its own`}
                onClick={() => splitForTarget(layer)}
              >
                Own copy here
              </button>
            </div>
          )}
          {layer.type === "text" && (
            <div className={styles.field}>
              <div className={styles.fieldHead}>
                <span>
                  text <span className={styles.muted}>{locale}</span>
                </span>
              </div>
              <textarea
                className={styles.textarea}
                rows={2}
                value={textOf(layer.id)}
                onChange={(e) => onTextChange(layer.id, e.target.value)}
              />
            </div>
          )}
          {layer.type === "image" && (
            <label className={styles.row}>
              <span>Asset</span>
              <select
                className={styles.select}
                value={layer.asset}
                onChange={(e) => patch(layer.id, { asset: e.target.value })}
              >
                {!assets.some((a) => a.rel === layer.asset) && <option value={layer.asset}>{layer.asset}</option>}
                {assets.map((a) => (
                  <option key={a.rel} value={a.rel}>
                    {a.rel}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className={styles.row}>
            <span>Width</span>
            <span className={styles.inline}>
              <input
                type="range"
                min={0.02}
                max={1.5}
                step={0.01}
                value={num(layer.width, 0.3)}
                onChange={(e) => patch(layer.id, { width: Number(e.target.value) })}
                className={styles.range}
              />
              <span className={styles.muted}>{num(layer.width, 0.3).toFixed(2)}</span>
            </span>
          </label>
          {layer.type === "text" && (
            <>
              <label className={styles.row}>
                <span>Size</span>
                <span className={styles.inline}>
                  <input
                    type="range"
                    min={0.015}
                    max={0.15}
                    step={0.005}
                    value={layer.size}
                    onChange={(e) => patch(layer.id, { size: Number(e.target.value) })}
                    className={styles.range}
                  />
                  <span className={styles.muted}>{layer.size.toFixed(3)}</span>
                </span>
              </label>
              <label className={styles.row}>
                <span>Weight</span>
                <select
                  className={styles.select}
                  value={layer.weight}
                  onChange={(e) => patch(layer.id, { weight: Number(e.target.value) })}
                >
                  {[400, 500, 600, 700, 800].map((w) => (
                    <option key={w} value={w}>
                      {w}
                    </option>
                  ))}
                </select>
              </label>
              <label className={styles.row}>
                <span>Font</span>
                <select
                  className={styles.select}
                  value={layer.font}
                  onChange={(e) => patch(layer.id, { font: e.target.value as "body" | "headline" })}
                >
                  <option value="body">body</option>
                  <option value="headline">headline</option>
                </select>
              </label>
              <label className={styles.row}>
                <span>Colour</span>
                <ColorField
                  value={layer.color ?? ""}
                  onChange={(v) => patch(layer.id, { color: v || undefined })}
                  placeholder="inherit"
                />
              </label>
              <label className={styles.row}>
                <span>Align</span>
                <select
                  className={styles.select}
                  value={layer.align}
                  onChange={(e) => patch(layer.id, { align: e.target.value as "start" | "center" | "end" })}
                >
                  <option value="start">start</option>
                  <option value="center">center</option>
                  <option value="end">end</option>
                </select>
              </label>
            </>
          )}
          <label className={styles.row}>
            <span>Rotate</span>
            <span className={styles.inline}>
              <input
                type="range"
                min={-45}
                max={45}
                step={1}
                value={num(layer.rotate, 0)}
                onChange={(e) => patch(layer.id, { rotate: Number(e.target.value) || undefined })}
                className={styles.range}
              />
              <span className={styles.muted}>{num(layer.rotate, 0)}°</span>
            </span>
          </label>
          <label className={styles.row}>
            <span>Opacity</span>
            <span className={styles.inline}>
              <input
                type="range"
                min={0.05}
                max={1}
                step={0.05}
                value={num(layer.opacity, 1)}
                onChange={(e) =>
                  patch(layer.id, { opacity: Number(e.target.value) === 1 ? undefined : Number(e.target.value) })
                }
                className={styles.range}
              />
              <span className={styles.muted}>{Math.round(num(layer.opacity, 1) * 100)}%</span>
            </span>
          </label>
          <label className={styles.row}>
            <span title="snap to the centre of the nearest slide / vertical centre">Align</span>
            <span className={styles.inline}>
              <button
                className={styles.btnSmall}
                title="centre horizontally in the nearest slide"
                onClick={() => {
                  const slide = Math.max(0, Math.min(slices - 1, Math.floor(layer.x)));
                  patch(layer.id, { x: slide + 0.5 });
                }}
              >
                ↔ centre
              </button>
              <button
                className={styles.btnSmall}
                title="centre vertically"
                onClick={() => patch(layer.id, { y: Math.round((aspect / 2) * 1000) / 1000 })}
              >
                ↕ centre
              </button>
              <button
                className={styles.btnSmall}
                title="duplicate this element"
                onClick={() => {
                  const id = freshId(layer.type === "image" ? "img" : "txt", layers);
                  const copy = {
                    ...structuredClone(layer),
                    id,
                    x: Math.round((layer.x + 0.05) * 1000) / 1000,
                    y: Math.round((layer.y + 0.05) * 1000) / 1000,
                  };
                  onChange([...layers, copy]);
                  if (layer.type === "text") onCopyText(layer.id, id);
                  onSelect(id);
                }}
              >
                Duplicate
              </button>
            </span>
          </label>
          <label className={styles.row}>
            <span title="later elements draw on top">Stacking</span>
            <span className={styles.inline}>
              <button
                className={styles.btnSmall}
                title="move down (drawn earlier)"
                disabled={layers.indexOf(layer) === 0}
                onClick={() => {
                  const i = layers.indexOf(layer);
                  const next = [...layers];
                  [next[i - 1], next[i]] = [next[i], next[i - 1]];
                  onChange(next);
                }}
              >
                ↓ back
              </button>
              <button
                className={styles.btnSmall}
                title="move up (drawn on top)"
                disabled={layers.indexOf(layer) === layers.length - 1}
                onClick={() => {
                  const i = layers.indexOf(layer);
                  const next = [...layers];
                  [next[i], next[i + 1]] = [next[i + 1], next[i]];
                  onChange(next);
                }}
              >
                ↑ front
              </button>
              <span className={styles.muted}>
                {layers.indexOf(layer) + 1}/{layers.length}
              </span>
            </span>
          </label>
          <div className={styles.inline}>
            <span className={styles.small}>drag it in the preview to position - Del key removes it</span>
            <span className={styles.spacer} />
            <button className={styles.btnDanger} onClick={() => onDelete(layer.id)}>
              Remove element
            </button>
          </div>
        </>
      )}
    </div>
  );
}
