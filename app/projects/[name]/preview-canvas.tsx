"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { TargetProfile } from "@/lib/targets";
import styles from "./editor.module.css";

export interface CanvasItem {
  id: string;
  /** Artwork HTML for the iframe (empty while loading). */
  html: string;
  order: number;
  /** ok | warn | error for the little badge under the frame. */
  status?: "ok" | "warn" | "error";
  statusText?: string;
}

export interface PreviewCanvasProps {
  target: TargetProfile;
  items: CanvasItem[];
  selectedId?: string;
  onSelect: (id: string) => void;
  /** "single": only the selected item; "strip": every item side by side, App Store style. */
  mode: "single" | "strip";
  storeLook: boolean;
  /** Extra status line rendered bottom-left (fits / problems). */
  footer?: React.ReactNode;
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
}: PreviewCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [zoom, setZoom] = useState<Zoom>("fit");
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number; px: number; py: number } | null>(null);
  const [dragging, setDragging] = useState(false);

  const shown = mode === "single" ? items.filter((i) => i.id === selectedId) : items;
  const gap = Math.round(target.width * (storeLook ? 0.06 : 0.04));
  const radius = storeLook ? Math.round(target.width * 0.045) : 0;
  const pad = Math.round(target.width * 0.06);
  const contentW = shown.length * target.width + Math.max(0, shown.length - 1) * gap + (storeLook ? 2 * pad : 0);
  const contentH = target.height + (storeLook ? 2 * pad : 0);

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
  const layoutKey = `${mode}/${target.id}/${shown.length}/${storeLook}`;
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
          gap,
          background: storeLook ? "#1c1c1e" : "transparent",
          borderRadius: storeLook ? Math.round(target.width * 0.02) : 0,
        }}
      >
        {shown.map((item) => (
          <div
            key={item.id}
            data-frame-id={item.id}
            className={`${styles.frameWrap} ${item.id === selectedId && mode === "strip" ? styles.frameSelected : ""}`}
            style={{ width: target.width, height: target.height, borderRadius: radius }}
          >
            {item.html ? (
              <iframe
                title={item.id}
                srcDoc={item.html}
                sandbox="allow-scripts allow-same-origin"
                style={{
                  width: target.width,
                  height: target.height,
                  border: 0,
                  background: "#000",
                  pointerEvents: "none",
                  display: "block",
                  borderRadius: radius,
                }}
              />
            ) : (
              <div className={styles.framePlaceholder} style={{ fontSize: Math.round(target.width * 0.05) }}>
                rendering…
              </div>
            )}
            {mode === "strip" && (
              <div
                className={styles.frameLabel}
                style={{
                  fontSize: Math.round(target.width * 0.045),
                  top: target.height + Math.round(target.width * 0.02),
                }}
              >
                <span className={`${styles.dot} ${styles[item.status ?? "ok"]}`} />{" "}
                {String(item.order).padStart(2, "0")} {item.id}
                {item.statusText ? <span className={styles.muted}> — {item.statusText}</span> : null}
              </div>
            )}
          </div>
        ))}
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
