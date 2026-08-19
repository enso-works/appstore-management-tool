"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { TargetProfile } from "@/lib/targets";
import styles from "./editor.module.css";

export interface CanvasItem {
  id: string;
  /** Artwork HTML for the iframe (empty while loading). */
  html: string;
  order: number;
  /** Panorama slices (1 = normal). The artwork is slices x target.width wide and shown as that many frames. */
  slices?: number;
  /** Label text instead of "NN id" (locale grid shows the locale). */
  label?: string;
  /** ok | warn | error for the little badge under the frame. */
  status?: "ok" | "warn" | "error";
  statusText?: string;
}

export interface PreviewCanvasProps {
  target: TargetProfile;
  items: CanvasItem[];
  selectedId?: string;
  onSelect: (id: string) => void;
  /** "single": only the selected item; "strip"/"locales": every item side by side, App Store style. */
  mode: "single" | "strip" | "locales";
  storeLook: boolean;
  /** Extra status line rendered bottom-left (fits / problems). */
  footer?: React.ReactNode;
  /** Single mode: let the iframe receive pointer events (drag the phone); pan messages come back via postMessage. */
  interactive?: boolean;
  /** Optional second row under the frames (e.g. the live App Store listing) — images rendered at target height. */
  belowRow?: { label: string; images: string[] };
}

type Zoom = "fit" | number;

const MIN_ZOOM = 0.02;
const MAX_ZOOM = 4;
const ZOOM_STEPS = [0.05, 0.1, 0.15, 0.2, 0.25, 0.33, 0.5, 0.75, 1, 1.5, 2, 3, 4];

/**
 * Zoomable, pannable canvas (plan §17.2 "preview all screens"): trackpad pinch /
 * ctrl+wheel zoom around the cursor, plain wheel pans, drag pans, buttons and
 * keys (+ - 0 1) zoom. Iframes are pointer-events:none so dragging works over
 * them; they are rendered at the real target size and scaled with a transform.
 */
export default function PreviewCanvas({
  target,
  items,
  selectedId,
  onSelect,
  mode,
  storeLook,
  footer,
  interactive = false,
  belowRow,
}: PreviewCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [zoom, setZoom] = useState<Zoom>("fit");
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number; px: number; py: number } | null>(null);
  const [dragging, setDragging] = useState(false);

  const shown = mode === "single" ? items.filter((i) => i.id === selectedId) : items;
  // One visual frame per slice; a panorama item contributes `slices` frames showing the same artwork shifted.
  const frames = shown.flatMap((item) =>
    Array.from({ length: item.slices ?? 1 }, (_, slice) => ({ item, slice, key: `${item.id}#${slice}` })),
  );
  const gap = Math.round(target.width * (storeLook ? 0.06 : 0.04));
  const radius = storeLook ? Math.round(target.width * 0.045) : 0;
  const pad = Math.round(target.width * 0.06);
  const cols = Math.max(frames.length, belowRow ? belowRow.images.length : 0);
  const rowGap = Math.round(target.width * 0.12);
  const contentW = cols * target.width + Math.max(0, cols - 1) * gap + (storeLook ? 2 * pad : 0);
  const contentH = target.height + (storeLook ? 2 * pad : 0) + (belowRow ? rowGap + target.height : 0);

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  const fitScale = useMemo(() => {
    if (!size.w || !size.h) return 0.1;
    const margin = 32;
    return Math.max(
      MIN_ZOOM,
      Math.min(MAX_ZOOM, Math.min((size.w - margin) / contentW, (size.h - margin - 40) / contentH)),
    );
  }, [size, contentW, contentH]);
  const scale = zoom === "fit" ? fitScale : zoom;

  // Reset to fit when the layout (mode/target/count) changes (derived-state reset during render).
  const layoutKey = `${mode}/${target.id}/${frames.length}/${storeLook}/${belowRow ? belowRow.images.length : 0}`;
  const [lastLayoutKey, setLastLayoutKey] = useState(layoutKey);
  if (layoutKey !== lastLayoutKey) {
    setLastLayoutKey(layoutKey);
    setZoom("fit");
    setPan({ x: 0, y: 0 });
  }

  // Centre the content when fitting; pan is relative to that centre.
  const baseX = (size.w - contentW * scale) / 2;
  const baseY = (size.h - contentH * scale) / 2;

  const zoomTo = useCallback(
    (next: number, anchor?: { x: number; y: number }) => {
      const clamped = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, next));
      const el = containerRef.current;
      if (el && anchor) {
        // Keep the point under the cursor fixed: convert to content coords at the old scale, reproject at the new one.
        const rect = el.getBoundingClientRect();
        const cx = anchor.x - rect.left;
        const cy = anchor.y - rect.top;
        const oldBaseX = (size.w - contentW * scale) / 2;
        const oldBaseY = (size.h - contentH * scale) / 2;
        const contentX = (cx - oldBaseX - pan.x) / scale;
        const contentY = (cy - oldBaseY - pan.y) / scale;
        const newBaseX = (size.w - contentW * clamped) / 2;
        const newBaseY = (size.h - contentH * clamped) / 2;
        setPan({ x: cx - newBaseX - contentX * clamped, y: cy - newBaseY - contentY * clamped });
      }
      setZoom(clamped);
    },
    [scale, pan, size, contentW, contentH],
  );

  const stepZoom = useCallback(
    (dir: 1 | -1) => {
      const cur = scale;
      const next =
        dir > 0
          ? (ZOOM_STEPS.find((z) => z > cur + 0.001) ?? MAX_ZOOM)
          : ([...ZOOM_STEPS].reverse().find((z) => z < cur - 0.001) ?? MIN_ZOOM);
      zoomTo(next);
    },
    [scale, zoomTo],
  );

  // Wheel: ctrl/meta (trackpad pinch sends ctrlKey) zooms around the cursor; plain wheel pans.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        const factor = Math.exp(-e.deltaY * 0.01);
        zoomTo(scale * factor, { x: e.clientX, y: e.clientY });
      } else {
        setPan((p) => ({ x: p.x - e.deltaX, y: p.y - e.deltaY }));
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [scale, zoomTo]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable))
        return;
      if (e.key === "+" || e.key === "=") stepZoom(1);
      else if (e.key === "-") stepZoom(-1);
      else if (e.key === "0") {
        setZoom("fit");
        setPan({ x: 0, y: 0 });
      } else if (e.key === "1") zoomTo(1);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [stepZoom, zoomTo]);

  useEffect(() => {
    let start: { x: number; y: number } | null = null;
    const onMessage = (ev: MessageEvent) => {
      if (ev.data?.type !== "store-shots-pan") return;
      if (ev.data.phase === "start") start = { x: pan.x, y: pan.y };
      else if (ev.data.phase === "move" && start)
        setPan({ x: start.x + ev.data.dx * scale, y: start.y + ev.data.dy * scale });
      else if (ev.data.phase === "end") start = null;
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [pan, scale]);

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    drag.current = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y };
    setDragging(true);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current) return;
    setPan({ x: drag.current.px + (e.clientX - drag.current.x), y: drag.current.py + (e.clientY - drag.current.y) });
  };
  const onPointerUp = (e: React.PointerEvent) => {
    if (!drag.current) return;
    const moved = Math.hypot(e.clientX - drag.current.x, e.clientY - drag.current.y);
    drag.current = null;
    setDragging(false);
    if (moved < 4) {
      // A click (not a drag): select the frame under the cursor.
      const el = (e.target as HTMLElement).closest("[data-frame-id]") as HTMLElement | null;
      if (el?.dataset.frameId) onSelect(el.dataset.frameId);
    }
  };

  return (
    <div
      ref={containerRef}
      className={`${styles.canvasViewport} ${storeLook ? styles.canvasStore : ""}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      style={{ cursor: dragging ? "grabbing" : "grab" }}
    >
      <div
        className={styles.world}
        style={{
          width: contentW,
          height: contentH,
          transform: `translate(${baseX + pan.x}px, ${baseY + pan.y}px) scale(${scale})`,
          transformOrigin: "0 0",
          padding: storeLook ? pad : 0,
          gap: rowGap,
          flexDirection: "column",
          background: storeLook ? "#1c1c1e" : "transparent",
          borderRadius: storeLook ? Math.round(target.width * 0.02) : 0,
        }}
      >
        <div className={styles.worldRow} style={{ gap }}>
          {frames.map(({ item, slice, key }) => {
            const slices = item.slices ?? 1;
            const artW = target.width * slices;
            return (
              <div
                key={key}
                data-frame-id={item.id}
                className={`${styles.frameWrap} ${item.id === selectedId && mode !== "single" ? styles.frameSelected : ""}`}
                style={{ width: target.width, height: target.height, borderRadius: radius }}
              >
                {item.html ? (
                  <iframe
                    title={`${item.id} ${slice + 1}/${slices}`}
                    srcDoc={item.html}
                    sandbox="allow-scripts allow-same-origin"
                    style={{
                      width: artW,
                      height: target.height,
                      marginLeft: -slice * target.width,
                      border: 0,
                      background: "#000",
                      pointerEvents: interactive && mode === "single" ? "auto" : "none",
                      display: "block",
                    }}
                  />
                ) : (
                  <div className={styles.framePlaceholder} style={{ fontSize: Math.round(target.width * 0.05) }}>
                    rendering…
                  </div>
                )}
                {mode !== "single" && (
                  <div
                    className={styles.frameLabel}
                    style={{
                      fontSize: Math.round(target.width * 0.045),
                      bottom: Math.round(target.width * 0.02),
                      left: Math.round(target.width * 0.02),
                    }}
                  >
                    <span className={`${styles.dot} ${styles[item.status ?? "ok"]}`} />{" "}
                    {item.label ?? `${String(item.order + slice).padStart(2, "0")} ${item.id}`}
                    {slices > 1 ? ` (${slice + 1}/${slices})` : ""}
                    {item.statusText && slice === 0 ? <span className={styles.muted}> — {item.statusText}</span> : null}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        {belowRow && (
          <div className={styles.worldRow} style={{ gap }}>
            {belowRow.images.map((src, i) => (
              <div
                key={src}
                className={styles.frameWrap}
                style={{ width: target.width, height: target.height, borderRadius: radius }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={src}
                  alt=""
                  style={{ width: target.width, height: target.height, objectFit: "cover", display: "block" }}
                />
                <div
                  className={styles.frameLabel}
                  style={{
                    fontSize: Math.round(target.width * 0.045),
                    bottom: Math.round(target.width * 0.02),
                    left: Math.round(target.width * 0.02),
                  }}
                >
                  {belowRow.label} {String(i + 1).padStart(2, "0")}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className={styles.zoomBar} onPointerDown={(e) => e.stopPropagation()}>
        <button className={styles.btnSmall} onClick={() => stepZoom(-1)} title="zoom out (-)">
          −
        </button>
        <span className={styles.zoomPct}>{Math.round(scale * 100)}%</span>
        <button className={styles.btnSmall} onClick={() => stepZoom(1)} title="zoom in (+)">
          +
        </button>
        <button
          className={styles.btnSmall}
          onClick={() => {
            setZoom("fit");
            setPan({ x: 0, y: 0 });
          }}
          title="fit (0)"
        >
          Fit
        </button>
        <button className={styles.btnSmall} onClick={() => zoomTo(1)} title="actual pixels (1)">
          100%
        </button>
        <span className={styles.muted}> drag to pan · ⌘/ctrl+wheel or pinch to zoom</span>
      </div>
      {footer && (
        <div className={styles.canvasInfo} onPointerDown={(e) => e.stopPropagation()}>
          {footer}
        </div>
      )}
    </div>
  );
}
