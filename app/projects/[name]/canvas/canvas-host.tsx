"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  dragPatch,
  fieldsFor,
  nudgePatch,
  pageScreens,
  stripWindow,
  type DragEnd,
  type Fields,
} from "@/lib/editor/drag";
import type { CanvasCommand, CanvasMessage, CanvasState } from "@/lib/editor/bridge";
import { BRIDGE_VERSION } from "@/lib/editor/bridge";
import type { InPageResult } from "@/lib/render/checks";
import type { FitResult } from "@/lib/render/fit";
import type { ScreenDefinition } from "@/lib/schema";
import { isScreenshotSet } from "@/lib/targets";
import { liveImageUrl } from "@/lib/live";
import PreviewCanvas, { type CanvasControls, type CanvasItem } from "../preview-canvas";
import editorStyles from "../editor.module.css";
import styles from "./canvas.module.css";

declare global {
  interface Window {
    storeShots?: { update: (state: CanvasState) => void; command: (cmd: CanvasCommand) => void };
    webkit?: { messageHandlers?: { storeShots?: { postMessage: (m: unknown) => void } } };
  }
}

/** To the Mac app; in a browser (tests, debugging) to the parent window and a DOM event. */
function post(message: CanvasMessage) {
  const handler = window.webkit?.messageHandlers?.storeShots;
  if (handler) handler.postMessage(message);
  else {
    window.parent?.postMessage({ source: "store-shots-canvas", ...message }, "*");
    window.dispatchEvent(new CustomEvent("store-shots-canvas", { detail: message }));
  }
}

interface Rendered {
  key: string;
  html: string;
  sourceExists?: boolean;
  budgets?: Record<string, number>;
  error?: string;
}

interface Job {
  id: string;
  locale: string;
  screen: ScreenDefinition;
  fields: Fields;
  order: number;
  key: string;
}

/**
 * The canvas the Mac app embeds: it renders the state the app sends and
 * reports clicks, drags and preview checks back. It owns no drafts.
 */
export default function CanvasHost({ name }: { name: string }) {
  const [state, setState] = useState<CanvasState | null>(null);
  const controls = useRef<CanvasControls>(null);
  const [rendered, setRendered] = useState<Record<string, Rendered>>({});
  /** Frames being fetched right now. */
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set());
  const [checksByKey, setChecksByKey] = useState<Record<string, { checks: InPageResult; fits: FitResult[] }>>({});
  // The latest state for event handlers registered once.
  const stateRef = useRef(state);
  useLayoutEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    window.storeShots = {
      update: (next) => setState(next),
      command: (cmd: CanvasCommand) => controls.current?.[cmd.action](),
    };
    post({ type: "ready", v: BRIDGE_VERSION });
    return () => {
      delete window.storeShots;
    };
  }, []);

  const target = state?.targets.find((t) => t.id === state.targetId);
  const page = state?.pageId ? state.manifest.sets?.find((s) => s.id === state.pageId) : undefined;
  const screen = state?.manifest.screens.find((s) => s.id === state.screenId);

  // What to render: the selected screen alone, the page's screens, or the screen in every locale.
  const jobs: Job[] = useMemo(() => {
    if (!state || !target) return [];
    const job = (s: ScreenDefinition, locale: string, id: string, order: number): Job => {
      const fields = fieldsFor(state.content, locale, s.id, page);
      return {
        id,
        locale,
        screen: s,
        fields,
        order,
        key: JSON.stringify([
          target.id,
          locale,
          state.content[locale]?.direction,
          s,
          fields,
          state.manifest.screens.length,
          state.revisions?.[s.id] ?? 0,
        ]),
      };
    };
    if (state.mode === "single") return screen ? [job(screen, state.locale, screen.id, screen.order)] : [];
    if (state.mode === "strip")
      return pageScreens(state.manifest, page).map((s, i) => job(s, state.locale, s.id, page ? i + 1 : s.order));
    const locales = Object.keys(state.content);
    return screen ? locales.map((l, i) => job(screen, l, l, i + 1)) : [];
  }, [state, target, page, screen]);

  // Fetch what changed, a quarter second after the last change.
  const jobsKey = JSON.stringify(jobs.map((j) => [j.id, j.key]));
  useEffect(() => {
    if (!state || !target) return;
    const controller = new AbortController();
    const handle = setTimeout(async () => {
      const need = jobs.filter((j) => rendered[j.id]?.key !== j.key);
      if (!need.length) return;
      setPending((p) => new Set([...p, ...need.map((j) => j.id)]));
      const results = await Promise.all(
        need.map(async (j): Promise<[string, Rendered] | null> => {
          try {
            const res = await fetch(`/api/projects/${encodeURIComponent(name)}/preview`, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                targetId: target.id,
                locale: j.locale,
                screen: j.screen,
                fields: j.fields,
                direction: state.content[j.locale]?.direction,
                interactive: true,
                strip: stripWindow(state.manifest, j.screen.id, target.width),
              }),
              signal: controller.signal,
            });
            if (!res.ok) {
              const error = ((await res.json().catch(() => ({}))) as { error?: string }).error ?? res.statusText;
              return [j.id, { key: j.key, html: "", error }];
            }
            let sidecar: { sourceExists?: boolean; budgets?: Record<string, number> } = {};
            try {
              const raw = res.headers.get("x-store-shots-job");
              if (raw) sidecar = JSON.parse(decodeURIComponent(raw));
            } catch {
              // no sidecar: nothing extra to report
            }
            return [j.id, { key: j.key, html: await res.text(), ...sidecar }];
          } catch {
            return null;
          }
        }),
      );
      setPending((p) => new Set([...p].filter((id) => !need.some((j) => j.id === id))));
      if (controller.signal.aborted) return;
      setRendered((m) => {
        const next = { ...m };
        for (const r of results) if (r) next[r[0]] = r[1];
        return next;
      });
    }, 250);
    return () => {
      clearTimeout(handle);
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobsKey, name]);

  // The single preview's state, for the inspector's meters and warnings.
  const single = state?.mode === "single" && screen ? rendered[screen.id] : undefined;
  const singleChecks = state && screen ? checksByKey[`${state.targetId}/${state.locale}/${screen.id}`] : undefined;
  useEffect(() => {
    if (!state || state.mode !== "single" || !screen) return;
    post({
      type: "preview",
      screenId: screen.id,
      locale: state.locale,
      loading: pending.has(screen.id),
      error: single?.error,
      sourceExists: single?.sourceExists,
      budgets: single?.budgets,
      checks: singleChecks?.checks,
      fits: singleChecks?.fits,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [single, singleChecks, pending]);

  // Messages from the artwork iframes: drags, clicks, in-page checks.
  useEffect(() => {
    const onMessage = (ev: MessageEvent) => {
      const s = stateRef.current;
      const data = ev.data as { type?: string } & Record<string, unknown>;
      if (!s || !data?.type) return;
      const t = s.targets.find((x) => x.id === s.targetId);
      const scr = s.manifest.screens.find((x) => x.id === s.screenId);
      if (data.type === "store-shots-drag-end" && scr && t) {
        const d = data as unknown as DragEnd;
        const patch = dragPatch(scr, d, {
          targetWidth: t.width,
          family: t.family,
          rtl: (s.content[s.locale]?.direction ?? "ltr") === "rtl",
        });
        if (patch.overrides || patch.layers) post({ type: "patchScreen", screenId: scr.id, patch });
        if (d.mode === "layer" && d.layerId) post({ type: "select", element: `layer:${d.layerId}` });
      } else if (data.type === "store-shots-click" && typeof data.hit === "string") {
        post({ type: "select", element: data.hit });
      } else if (data.type === "store-shots-preview" && typeof data.key === "string") {
        setChecksByKey((m) => ({
          ...m,
          [data.key as string]: { checks: data.checks as InPageResult, fits: data.fits as FitResult[] },
        }));
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  // Keys on the canvas: arrows nudge the selection, g toggles guides, Delete removes a layer.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = stateRef.current;
      const scr = s?.manifest.screens.find((x) => x.id === s.screenId);
      if (!s || !scr || e.metaKey || e.ctrlKey) return;
      if (e.key === "g") {
        e.preventDefault();
        post({ type: "toggleGuides" });
        return;
      }
      if ((e.key === "Delete" || e.key === "Backspace") && s.selected.startsWith("layer:")) {
        e.preventDefault();
        post({ type: "deleteLayer", screenId: scr.id, layerId: s.selected.slice(6) });
        return;
      }
      const dir = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
      if (!dir) return;
      e.preventDefault();
      const step = e.shiftKey ? 0.05 : 0.005;
      const patch = nudgePatch(scr, s.selected, dir[0] * step, dir[1] * step);
      if (patch) post({ type: "patchScreen", screenId: scr.id, patch });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // The live App Store listing, under the strip, for comparison.
  const [live, setLive] = useState<{ iphone: string[]; ipad: string[] } | null>(null);
  const liveCountry = state?.liveCountry;
  useEffect(() => {
    if (!liveCountry) return;
    const controller = new AbortController();
    const t = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/projects/${encodeURIComponent(name)}/live?country=${encodeURIComponent(liveCountry)}`,
          {
            signal: controller.signal,
            cache: "no-store",
          },
        );
        const body = await res.json();
        if (!res.ok || !body.live) {
          setLive(null);
          post({ type: "live", error: body.error ?? `not on the ${liveCountry.toUpperCase()} App Store` });
        } else {
          setLive({ iphone: body.live.iphone, ipad: body.live.ipad });
          post({ type: "live", version: body.live.version });
        }
      } catch (err) {
        if ((err as Error).name !== "AbortError") post({ type: "live", error: (err as Error).message });
      }
    }, 0);
    return () => {
      clearTimeout(t);
      controller.abort();
    };
  }, [liveCountry, name]);

  const onView = useCallback((view: { scale: number; wrap: boolean; canWrap: boolean }) => {
    post({ type: "view", ...view });
  }, []);

  if (!state || !target) return <div className={styles.empty} />;

  const failOnOverflow = state.failOnOverflow ?? true;
  const failOnOverlap = state.failOnTextOverlap ?? false;
  const statusOf = (j: Job): Pick<CanvasItem, "status" | "statusText"> => {
    const keys = new Set([
      j.screen.id,
      `${j.locale}/${j.screen.id}`,
      `${target.id}/${j.locale}/${j.screen.id}`,
      j.locale,
    ]);
    const hits = (state.issues ?? []).filter((i) => i.key && keys.has(i.key));
    const c = checksByKey[`${target.id}/${j.locale}/${j.screen.id}`];
    const problems: string[] = [];
    const warns: string[] = [];
    if (c) {
      for (const o of c.checks.overflow) (failOnOverflow ? problems : warns).push(`${o.id} overflows`);
      for (const o of c.checks.textOverlapsDevice) (failOnOverlap ? problems : warns).push(`${o} overlaps the device`);
      for (const f of c.fits) if (f.scale < 1 && f.fits) warns.push(`${f.id} ${Math.round(f.scale * 100)}%`);
    }
    if (rendered[j.id]?.sourceExists === false) problems.push("capture missing");
    if (!j.screen.enabled && !page) warns.push("off the default page");
    const err = hits.find((i) => i.level === "error");
    const warn = hits.find((i) => i.level === "warn");
    if (err || problems.length)
      return { status: "error", statusText: [err?.message, ...problems].filter(Boolean).join(", ") };
    if (warn || warns.length)
      return { status: "warn", statusText: [warn?.message, ...warns].filter(Boolean).join(", ") };
    return { status: "ok" };
  };
  const items: CanvasItem[] = jobs.map((j) => ({
    id: j.id,
    html: rendered[j.id]?.html ?? "",
    order: j.order,
    slices: j.screen.panorama?.slices ?? 1,
    label: state.mode === "locales" ? j.locale : undefined,
    ...(state.mode === "single" ? {} : statusOf(j)),
  }));
  const selectedId = state.mode === "locales" ? state.locale : state.screenId;
  const liveImages =
    state.liveCountry && live && state.mode === "strip"
      ? (target.family === "ipad" ? live.ipad : live.iphone).map((u) => liveImageUrl(u, target.width, target.height))
      : [];

  return (
    <div className={`${editorStyles.canvas} ${styles.host}`}>
      <PreviewCanvas
        target={target}
        items={items}
        selectedId={selectedId}
        onSelect={(id) => post({ type: "selectItem", id })}
        onOpen={(id) => post({ type: "openItem", id })}
        mode={state.mode}
        storeLook={state.storeLook}
        interactive
        highlightEl={state.selected}
        guides={state.guides}
        searchCount={
          state.mode === "strip" && target.platform === "ios" && isScreenshotSet(target)
            ? target.orientation === "portrait"
              ? 3
              : 1
            : 0
        }
        belowRow={liveImages.length ? { label: "Live on the App Store", images: liveImages } : undefined}
        chrome={false}
        controls={controls}
        onView={onView}
      />
    </div>
  );
}
