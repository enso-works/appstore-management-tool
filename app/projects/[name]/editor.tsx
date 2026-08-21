"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Issue } from "@/lib/issues";
import type { LocaleContent, Manifest, ProjectConfig, ScreenDefinition } from "@/lib/schema";
import type { TargetProfile } from "@/lib/targets";
import type { TemplateDescriptor } from "@/templates/types";
import type { InPageResult } from "@/lib/render/checks";
import type { FitResult } from "@/lib/render/fit";
import type { ReadinessReport } from "@/lib/readiness";
import type { GenerationSummary } from "@/lib/generate";
import StorePanel from "./store-panel";
import ReleasePanel from "./release-panel";
import BackgroundEditor from "./background-editor";
import ColorField from "./color-field";
import LayerInspector from "./layer-inspector";
import PreviewCanvas, { type CanvasItem } from "./preview-canvas";
import { liveImageUrl } from "@/lib/live";
import styles from "./editor.module.css";

interface Snapshot {
  name: string;
  root: string;
  config: ProjectConfig;
  manifest?: Manifest;
  manifestEtag: string;
  content: Record<string, LocaleContent>;
  contentEtags: Record<string, string>;
  validation: { issues: Issue[]; planKeys: string[] };
  readiness: ReadinessReport;
  templates: TemplateDescriptor[];
  targets: TargetProfile[];
  fonts: { stack: { family: string; source: string }[]; missing: string[] };
  configEtag: string;
}

type Fields = Record<string, string | null>;

const OVERRIDE_CONTROLS: Record<
  string,
  {
    label: string;
    kind: "text" | "number" | "select" | "color";
    min?: number;
    max?: number;
    step?: number;
    options?: string[];
    hint?: string;
  }
> = {
  background: { label: "Background", kind: "text", hint: "any CSS background; empty = brand gradient. e.g. #F3EEE4" },
  backgroundImage: {
    label: "Background image",
    kind: "text",
    hint: "asset:backgrounds/<file> (under store/assets) or pattern:waves | pattern:dots | pattern:grid",
  },
  patternColor: { label: "Pattern colour", kind: "color", hint: "CSS colour for pattern lines, e.g. rgba(0,0,0,0.08)" },
  screenshotScale: { label: "Phone scale", kind: "number", min: 0.3, max: 1.8, step: 0.01 },
  screenshotOffsetX: {
    label: "Phone offset X",
    kind: "number",
    min: -1,
    max: 1,
    step: 0.01,
    hint: "fraction of canvas width; + = right",
  },
  screenshotOffsetY: {
    label: "Phone offset Y",
    kind: "number",
    min: -1.2,
    max: 1.2,
    step: 0.01,
    hint: "fraction of canvas width; + = down",
  },
  deviceTilt: { label: "Phone tilt (deg)", kind: "number", min: -30, max: 30, step: 0.5 },
  textWidth: {
    label: "Text width",
    kind: "number",
    min: 0.25,
    max: 1,
    step: 0.01,
    hint: "< 1 puts the phone beside the text",
  },
  textSide: { label: "Text side", kind: "select", options: ["start", "end"] },
  textOffsetX: { label: "Text offset X", kind: "number", min: -1, max: 1, step: 0.01 },
  textOffsetY: { label: "Text offset Y", kind: "number", min: -0.3, max: 1, step: 0.01 },
  textAlign: { label: "Text align", kind: "select", options: ["start", "center", "end"] },
  textColor: { label: "Text colour", kind: "color", hint: "CSS colour; default brand.onPrimary" },
  shell: { label: "Device shell", kind: "select", options: ["dark", "light", "none"] },
  cardPosition: { label: "Card position", kind: "select", options: ["top", "bottom"] },
  cardColor: { label: "Card colour", kind: "color", hint: "CSS colour; default brand.primary at 93%" },
};

const EL_GROUPS: Record<string, string[]> = {
  background: ["background", "backgroundImage", "patternColor"],
  phone: ["screenshotScale", "screenshotOffsetX", "screenshotOffsetY", "deviceTilt", "shell"],
  text: ["textWidth", "textSide", "textOffsetX", "textOffsetY", "textAlign", "textColor", "cardPosition", "cardColor"],
};

function groupOf(sel: string): string {
  if (sel.startsWith("layer:")) return "layers";
  return sel.startsWith("text") ? "text" : sel;
}

function emptyContent(locale: string): LocaleContent {
  return { locale, screens: {} };
}

export default function Editor({ name }: { name: string }) {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [targetId, setTargetId] = useState<string>("");
  const [locale, setLocale] = useState<string>("");
  const [screenId, setScreenId] = useState<string>("");
  const [content, setContent] = useState<Record<string, LocaleContent>>({});
  const [manifest, setManifest] = useState<Manifest>({ screens: [] });
  const [etags, setEtags] = useState<{ manifest: string; content: Record<string, string> }>({
    manifest: "",
    content: {},
  });
  const [dirty, setDirty] = useState<{ manifest: boolean; content: Set<string> }>({
    manifest: false,
    content: new Set(),
  });
  const [issues, setIssues] = useState<Issue[]>([]);
  const [previewHtml, setPreviewHtml] = useState<string>("");
  const [previewInfo, setPreviewInfo] = useState<{
    checks?: InPageResult;
    fits?: FitResult[];
    error?: string;
    loading: boolean;
    sourceExists?: boolean;
    budgets?: Record<string, number>;
  }>({ loading: false });
  const [status, setStatus] = useState<string>("");
  const [gen, setGen] = useState<{ running: boolean; summary?: GenerationSummary & { log: string[] } }>({
    running: false,
  });
  const [showLog, setShowLog] = useState(false);
  const [newScreenId, setNewScreenId] = useState("");
  const [view, setView] = useState<"screens" | "store" | "release">("screens");
  const [canvasMode, setCanvasMode] = useState<"single" | "strip" | "locales">("single");
  const [storeLook, setStoreLook] = useState(false);
  const [issuesOpen, setIssuesOpen] = useState(false);
  const [frames, setFrames] = useState<{ name: string; width: number; height: number }[] | null>(null);
  const [guides, setGuides] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [selectedEl, setSelectedEl] = useState<string>("phone");
  const [showLive, setShowLive] = useState(false);
  const [liveCountry, setLiveCountry] = useState("us");
  const [live, setLive] = useState<{
    iphone: string[];
    ipad: string[];
    version?: string;
    trackName?: string;
    error?: string;
  } | null>(null);
  /** Grid modes (strip / locales): artwork HTML per item id, keyed by a cache key of its inputs. */
  const [gridHtml, setGridHtml] = useState<Record<string, { key: string; html: string; sourceExists?: boolean }>>({});
  /** In-page check results per job key (<target>/<locale>/<screen>). */
  const [checksByKey, setChecksByKey] = useState<Record<string, { checks: InPageResult; fits: FitResult[] }>>({});
  const stripAbort = useRef<AbortController | null>(null);

  // ---- load --------------------------------------------------------------
  const load = useCallback(async () => {
    const res = await fetch(`/api/projects/${encodeURIComponent(name)}`, { cache: "no-store" });
    if (!res.ok) {
      setLoadError((await res.json().catch(() => ({ error: res.statusText }))).error);
      return;
    }
    const data = (await res.json()) as Snapshot;
    setLoadError(null);
    setSnap(data);
    const c: Record<string, LocaleContent> = {};
    for (const l of data.config.locales) c[l] = data.content[l] ?? emptyContent(l);
    setContent(c);
    setManifest(data.manifest ?? { screens: [] });
    setEtags({ manifest: data.manifestEtag, content: data.contentEtags });
    setDirty({ manifest: false, content: new Set() });
    setIssues(data.validation.issues);
    setTargetId((t) => t || data.config.targets[0]);
    setLocale((l) => l || data.config.defaultLocale);
    const first = [...(data.manifest?.screens ?? [])].sort((a, b) => a.order - b.order)[0];
    setScreenId((s) => s || first?.id || "");
  }, [name]);

  useEffect(() => {
    // Deferred so the fetch (and its later setState calls) never run synchronously inside the effect.
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load]);

  useEffect(() => {
    let alive = true;
    void fetch(`/api/projects/${encodeURIComponent(name)}/frames`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { frames: [] }))
      .then((d) => {
        if (alive) setFrames(d.frames ?? []);
      });
    return () => {
      alive = false;
    };
  }, [name]);

  // ---- derived -----------------------------------------------------------
  const screens = useMemo(
    () => [...manifest.screens].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id)),
    [manifest],
  );
  const screen = screens.find((s) => s.id === screenId);
  const target = snap?.targets.find((t) => t.id === targetId);
  const template = snap?.templates.find((t) => t.id === screen?.template);
  const fields: Fields = (content[locale]?.screens[screenId] as Fields | undefined) ?? {};
  const refLocale = snap?.config.defaultLocale ?? "";
  const refFields: Fields = (content[refLocale]?.screens[screenId] as Fields | undefined) ?? {};
  const isDirty = dirty.manifest || dirty.content.size > 0;

  // ---- preview -----------------------------------------------------------
  const screenKey = JSON.stringify(screen);
  const fieldsKey = JSON.stringify(fields);
  const direction = content[locale]?.direction;
  useEffect(() => {
    if (!snap || !screen || !target || !locale) return;
    const controller = new AbortController();
    const handle = setTimeout(async () => {
      setPreviewInfo((p) => ({ ...p, loading: true, error: undefined }));
      try {
        const res = await fetch(`/api/projects/${encodeURIComponent(name)}/preview`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            targetId,
            locale,
            screen,
            fields,
            direction,
            interactive: true,
            strip: target ? stripWindow(manifest, screenId, target.width) : undefined,
          }),
          signal: controller.signal,
        });
        if (!res.ok) {
          const err = (await res.json().catch(() => ({ error: res.statusText }))).error as string;
          setPreviewInfo({ loading: false, error: err });
          setPreviewHtml("");
          return;
        }
        const sidecar = res.headers.get("x-store-shots-job");
        let sourceExists: boolean | undefined;
        let budgets: Record<string, number> | undefined;
        try {
          const parsed = sidecar
            ? (JSON.parse(decodeURIComponent(sidecar)) as { sourceExists: boolean; budgets?: Record<string, number> })
            : undefined;
          sourceExists = parsed?.sourceExists;
          budgets = parsed?.budgets;
        } catch {
          sourceExists = undefined;
        }
        setPreviewHtml(await res.text());
        setPreviewInfo({ loading: false, sourceExists, budgets });
      } catch (err) {
        if ((err as Error).name !== "AbortError") setPreviewInfo({ loading: false, error: (err as Error).message });
      }
    }, 250);
    return () => {
      clearTimeout(handle);
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snap, name, targetId, locale, screenId, screenKey, fieldsKey, direction]);

  // Drag-to-position: the preview iframe posts deltas in artwork px; convert to override fractions of target width.
  useEffect(() => {
    const onDrag = (ev: MessageEvent) => {
      if (ev.data?.type !== "store-shots-drag-end" || !screen || !target) return;
      const o = { ...screen.overrides } as Record<string, number | string | undefined>;
      const W = target.width;
      const num = (v: unknown, d: number) => (typeof v === "number" ? v : d);
      if (ev.data.mode === "move") {
        const rtl = (content[locale]?.direction ?? "ltr") === "rtl";
        o.screenshotOffsetX = Math.round((num(o.screenshotOffsetX, 0) + ((rtl ? -1 : 1) * ev.data.dx) / W) * 100) / 100;
        o.screenshotOffsetY = Math.round((num(o.screenshotOffsetY, 0) + ev.data.dy / W) * 100) / 100;
      } else if (ev.data.mode === "layer" && typeof ev.data.layerId === "string") {
        const layers = (screen.layers ?? []).map((l) =>
          l.id === ev.data.layerId
            ? {
                ...l,
                x: Math.round((l.x + ev.data.dx / W) * 1000) / 1000,
                y: Math.round((l.y + ev.data.dy / W) * 1000) / 1000,
              }
            : l,
        );
        updateScreen({ layers });
        setSelectedEl(`layer:${ev.data.layerId}`);
        return;
      } else if (ev.data.mode === "layer-tilt" && typeof ev.data.layerId === "string") {
        updateScreen({
          layers: (screen.layers ?? []).map((l) =>
            l.id === ev.data.layerId
              ? {
                  ...l,
                  rotate:
                    Math.max(-180, Math.min(180, Math.round((num(l.rotate, 0) + ev.data.dTilt) * 2) / 2)) || undefined,
                }
              : l,
          ),
        });
        return;
      } else if (ev.data.mode === "layer-scale" && typeof ev.data.layerId === "string") {
        updateScreen({
          layers: (screen.layers ?? []).map((l) =>
            l.id === ev.data.layerId
              ? { ...l, width: Math.max(0.02, Math.min(2, Math.round(l.width * ev.data.dScale * 1000) / 1000)) }
              : l,
          ),
        });
        return;
      } else if (ev.data.mode === "text") {
        const rtl = (content[locale]?.direction ?? "ltr") === "rtl";
        const slice = typeof ev.data.slice === "number" ? ev.data.slice : 0;
        const kx = slice === 0 ? "textOffsetX" : `textOffsetX${slice + 1}`;
        const ky = slice === 0 ? "textOffsetY" : `textOffsetY${slice + 1}`;
        o[kx] = Math.round((num(o[kx], 0) + ((rtl ? -1 : 1) * ev.data.dx) / W) * 100) / 100;
        o[ky] = Math.max(-0.3, Math.min(1, Math.round((num(o[ky], 0) + ev.data.dy / W) * 100) / 100));
      } else if (ev.data.mode === "tilt") {
        o.deviceTilt = Math.max(-30, Math.min(30, Math.round((num(o.deviceTilt, 0) + ev.data.dTilt) * 2) / 2));
      } else if (ev.data.mode === "scale") {
        const tpl = snap?.templates.find((t) => t.id === screen.template);
        void tpl;
        const base = num(o.screenshotScale, target.family === "ipad" ? 0.72 : 0.8);
        o.screenshotScale = Math.max(0.3, Math.min(1.8, Math.round(base * ev.data.dScale * 100) / 100));
      }
      updateScreen({ overrides: o });
    };
    window.addEventListener("message", onDrag);
    return () => window.removeEventListener("message", onDrag);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screenKey, targetId, locale]);

  useEffect(() => {
    const onClick = (ev: MessageEvent) => {
      if (ev.data?.type === "store-shots-click" && typeof ev.data.hit === "string") setSelectedEl(ev.data.hit);
    };
    window.addEventListener("message", onClick);
    return () => window.removeEventListener("message", onClick);
  }, []);

  useEffect(() => {
    const onMessage = (ev: MessageEvent) => {
      if (ev.data?.type !== "store-shots-preview") return;
      const checks = ev.data.checks as InPageResult;
      const fits = ev.data.fits as FitResult[];
      const key = ev.data.key as string | undefined; // <target>/<locale>/<screen>
      if (key) setChecksByKey((m) => ({ ...m, [key]: { checks, fits } }));
      const parts = key?.split("/") ?? [];
      if (!key || (parts[2] === screenId && parts[1] === locale)) setPreviewInfo((p) => ({ ...p, checks, fits }));
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [screenId, locale]);

  // Grid modes: strip = every enabled screen of the current locale; locales = the current screen in every locale.
  interface GridJob {
    id: string;
    locale: string;
    screen: ScreenDefinition;
    fields: Fields;
    order: number;
    key: string;
  }
  const gridJobs: GridJob[] =
    canvasMode !== "locales"
      ? screens
          .filter((s) => s.enabled)
          .map((s) => {
            const f = (content[locale]?.screens[s.id] as Fields | undefined) ?? {};
            return {
              id: s.id,
              locale,
              screen: s,
              fields: f,
              order: s.order,
              key: JSON.stringify([targetId, locale, content[locale]?.direction, s, f]),
            };
          })
      : canvasMode === "locales" && screen
        ? (snap?.config.locales ?? []).map((l, i) => {
            const f = (content[l]?.screens[screen.id] as Fields | undefined) ?? {};
            return {
              id: l,
              locale: l,
              screen,
              fields: f,
              order: i + 1,
              key: JSON.stringify([targetId, l, content[l]?.direction, screen, f]),
            };
          })
        : [];
  const gridInputsKey = JSON.stringify(gridJobs.map((j) => [j.id, j.key]));
  useEffect(() => {
    if (!snap || !target) return;
    stripAbort.current?.abort();
    const controller = new AbortController();
    stripAbort.current = controller;
    const handle = setTimeout(async () => {
      const need = gridJobs.filter((j) => gridHtml[j.id]?.key !== j.key);
      if (!need.length) return;
      const results = await Promise.all(
        need.map(async (j) => {
          try {
            const res = await fetch(`/api/projects/${encodeURIComponent(name)}/preview`, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                targetId,
                locale: j.locale,
                screen: j.screen,
                fields: j.fields,
                direction: content[j.locale]?.direction,
                // The drag script is inert unless the canvas grants the frame
                // pointer events (Strip mode, selected frame).
                interactive: true,
                strip: target ? stripWindow(manifest, j.screen.id, target.width) : undefined,
              }),
              signal: controller.signal,
            });
            if (!res.ok) return { id: j.id, key: j.key, html: "" };
            const sidecar = res.headers.get("x-store-shots-job");
            let sourceExists: boolean | undefined;
            try {
              sourceExists = sidecar
                ? (JSON.parse(decodeURIComponent(sidecar)) as { sourceExists: boolean }).sourceExists
                : undefined;
            } catch {
              sourceExists = undefined;
            }
            return { id: j.id, key: j.key, html: await res.text(), sourceExists };
          } catch {
            return null;
          }
        }),
      );
      if (controller.signal.aborted) return;
      setGridHtml((m) => {
        const next = { ...m };
        for (const r of results) if (r) next[r.id] = { key: r.key, html: r.html, sourceExists: r.sourceExists };
        return next;
      });
    }, 250);
    return () => {
      clearTimeout(handle);
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canvasMode, snap, name, targetId, gridInputsKey]);

  // Live listing (public iTunes lookup) for side-by-side comparison in grid modes.
  useEffect(() => {
    if (!showLive || !snap) return;
    const controller = new AbortController();
    const t = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/projects/${encodeURIComponent(name)}/live?country=${encodeURIComponent(liveCountry)}`,
          { signal: controller.signal, cache: "no-store" },
        );
        const body = await res.json();
        if (!res.ok) setLive({ iphone: [], ipad: [], error: body.error });
        else if (!body.live)
          setLive({ iphone: [], ipad: [], error: `not found on the ${liveCountry.toUpperCase()} App Store` });
        else
          setLive({
            iphone: body.live.iphone,
            ipad: body.live.ipad,
            version: body.live.version,
            trackName: body.live.trackName,
          });
      } catch (err) {
        if ((err as Error).name !== "AbortError") setLive({ iphone: [], ipad: [], error: (err as Error).message });
      }
    }, 0);
    return () => {
      clearTimeout(t);
      controller.abort();
    };
  }, [showLive, liveCountry, name, snap]);

  // Arrow keys nudge the selected element (shift = coarse). Fractions of the
  // target width, matching the drag units.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!screen || view !== "screens") return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable))
        return;
      if (e.key === "?") {
        e.preventDefault();
        setShowShortcuts((v) => !v);
        return;
      }
      if (e.key === "Escape") {
        setShowShortcuts(false);
        return;
      }
      if (e.key === "g" && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        setGuides((v) => !v);
        return;
      }
      if ((e.key === "Delete" || e.key === "Backspace") && selectedEl.startsWith("layer:")) {
        e.preventDefault();
        deleteLayer(selectedEl.slice(6));
        return;
      }
      const dir = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
      if (!dir) return;
      e.preventDefault();
      const step = e.shiftKey ? 0.05 : 0.005;
      const dx = dir[0] * step;
      const dy = dir[1] * step;
      const round3 = (v: number) => Math.round(v * 1000) / 1000;
      const num = (v: unknown, d: number) => (typeof v === "number" ? v : d);
      if (selectedEl === "phone") {
        setOverrides({
          screenshotOffsetX: round3(num(screen.overrides.screenshotOffsetX, 0) + dx),
          screenshotOffsetY: round3(num(screen.overrides.screenshotOffsetY, 0) + dy),
        });
      } else if (selectedEl.startsWith("text")) {
        const slice = Number(selectedEl.split(":")[1] ?? 0);
        const kx = slice === 0 ? "textOffsetX" : `textOffsetX${slice + 1}`;
        const ky = slice === 0 ? "textOffsetY" : `textOffsetY${slice + 1}`;
        setOverrides({
          [kx]: round3(num(screen.overrides[kx], 0) + dx),
          [ky]: round3(Math.max(-0.3, Math.min(1, num(screen.overrides[ky], 0) + dy))),
        });
      } else if (selectedEl.startsWith("layer:")) {
        const id = selectedEl.slice(6);
        updateScreen({
          layers: (screen.layers ?? []).map((l) =>
            l.id === id ? { ...l, x: round3(l.x + dx), y: round3(l.y + dy) } : l,
          ),
        });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedEl, screenKey, view]);

  // ---- editing -----------------------------------------------------------
  // ---- undo/redo ---------------------------------------------------------
  // Session-level snapshots of the two editable documents. Autosave persists
  // whatever state undo restores, so ⌘Z works across saves too.
  const historyRef = useRef<{ manifest: Manifest; content: Record<string, LocaleContent> }[]>([]);
  const redoRef = useRef<{ manifest: Manifest; content: Record<string, LocaleContent> }[]>([]);
  const stateRef = useRef({ manifest, content });
  stateRef.current = { manifest, content };

  function pushHistory() {
    historyRef.current.push({
      manifest: structuredClone(stateRef.current.manifest),
      content: structuredClone(stateRef.current.content),
    });
    if (historyRef.current.length > 100) historyRef.current.shift();
    redoRef.current = [];
  }

  const applySnapshot = useCallback((snapState: { manifest: Manifest; content: Record<string, LocaleContent> }) => {
    setManifest(snapState.manifest);
    setContent(snapState.content);
    setDirty((d) => ({ manifest: true, content: new Set([...d.content, ...Object.keys(snapState.content)]) }));
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "z") return;
      const t = e.target as HTMLElement | null;
      // Let text inputs keep their native undo.
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      e.preventDefault();
      if (e.shiftKey) {
        const next = redoRef.current.pop();
        if (!next) return;
        historyRef.current.push({
          manifest: structuredClone(stateRef.current.manifest),
          content: structuredClone(stateRef.current.content),
        });
        applySnapshot(next);
      } else {
        const prev = historyRef.current.pop();
        if (!prev) return;
        redoRef.current.push({
          manifest: structuredClone(stateRef.current.manifest),
          content: structuredClone(stateRef.current.content),
        });
        applySnapshot(prev);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [applySnapshot]);

  function setField(field: string, value: string | null) {
    pushHistory();
    setContent((c) => {
      const lc = c[locale] ?? emptyContent(locale);
      const next: LocaleContent = {
        ...lc,
        screens: { ...lc.screens, [screenId]: { ...(lc.screens[screenId] ?? {}), [field]: value } },
      };
      return { ...c, [locale]: next };
    });
    setDirty((d) => ({ ...d, content: new Set(d.content).add(locale) }));
  }

  function updateScreen(patch: Partial<ScreenDefinition>) {
    pushHistory();
    setManifest((m) => ({ ...m, screens: m.screens.map((s) => (s.id === screenId ? { ...s, ...patch } : s)) }));
    setDirty((d) => ({ ...d, manifest: true }));
  }

  function setOverride(key: string, value: unknown) {
    if (!screen) return;
    const overrides = { ...screen.overrides };
    if (value === "" || value === undefined || value === null || (typeof value === "number" && Number.isNaN(value)))
      delete overrides[key];
    else overrides[key] = value;
    updateScreen({ overrides });
  }

  /** Apply several override keys atomically ("" removes a key) — sequential setOverride calls would clobber each other. */
  function setOverrides(patch: Record<string, unknown>) {
    if (!screen) return;
    const overrides = { ...screen.overrides };
    for (const [key, value] of Object.entries(patch)) {
      if (value === "" || value === undefined || value === null || (typeof value === "number" && Number.isNaN(value)))
        delete overrides[key];
      else overrides[key] = value;
    }
    updateScreen({ overrides });
  }

  /** A screen's horizontal window into the strip of enabled screens (for span backgrounds). */
  function stripWindow(m: Manifest, id: string, W: number): { offsetX: number; width: number } {
    const ordered = [...m.screens]
      .filter((s) => s.enabled)
      .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
    let acc = 0;
    let offsetX = 0;
    for (const s of ordered) {
      if (s.id === id) offsetX = acc;
      acc += W * (s.panorama?.slices ?? 1);
    }
    return { offsetX, width: acc };
  }

  /** Drop a text layer's content field from every locale (layer text lives in content files). */
  function removeLayerContentField(id: string) {
    setContent((c) => {
      const next = { ...c };
      for (const l of Object.keys(next)) {
        const lc = next[l];
        if (lc?.screens[screenId] && id in lc.screens[screenId]) {
          const fields2 = { ...lc.screens[screenId] };
          delete fields2[id];
          next[l] = { ...lc, screens: { ...lc.screens, [screenId]: fields2 } };
        }
      }
      return next;
    });
    setDirty((d) => ({
      ...d,
      content: new Set([
        ...d.content,
        ...(snap?.config.locales ?? []).filter(
          (l) => content[l]?.screens[screenId] && id in content[l].screens[screenId],
        ),
      ]),
    }));
  }

  /** Delete an element (layer) from the current screen, pruning localized text and selection. */
  function deleteLayer(id: string) {
    if (!screen) return;
    const layer = (screen.layers ?? []).find((l) => l.id === id);
    if (!layer) return;
    updateScreen({ layers: (screen.layers ?? []).filter((l) => l.id !== id) });
    if (layer.type === "text") removeLayerContentField(id);
    setSelectedEl((sel) => (sel === `layer:${id}` ? "phone" : sel));
  }

  /** Remove background overrides from every screen so all inherit the project default. */
  function clearBackgroundsEverywhere() {
    pushHistory();
    const bg = ["background", "backgroundImage", "patternColor", "patternScale"];
    setManifest((m) => ({
      ...m,
      screens: m.screens.map((s) => {
        const overrides = { ...s.overrides };
        for (const k of bg) delete overrides[k];
        return { ...s, overrides };
      }),
    }));
    setDirty((d) => ({ ...d, manifest: true }));
  }

  function addScreen() {
    pushHistory();
    const id = newScreenId
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/^-|-$/g, "");
    if (!id || manifest.screens.some((s) => s.id === id)) return;
    const order = Math.max(0, ...manifest.screens.map((s) => s.order)) + 1;
    const s: ScreenDefinition = {
      id,
      order,
      enabled: true,
      template: snap?.templates[0]?.id ?? "hero-top",
      source: { filePattern: "{order}-{id}.png", localized: true },
      overrides: {},
      layers: [],
    };
    setManifest((m) => ({ ...m, screens: [...m.screens, s] }));
    setDirty((d) => ({ ...d, manifest: true }));
    setScreenId(id);
    setNewScreenId("");
  }

  function removeScreen() {
    if (
      !screen ||
      !confirm(
        `Remove screen "${screen.id}" from the manifest? Its copy stays in the content files until you delete it.`,
      )
    )
      return;
    pushHistory();
    setManifest((m) => ({ ...m, screens: m.screens.filter((s) => s.id !== screen.id) }));
    setDirty((d) => ({ ...d, manifest: true }));
    setScreenId(screens.find((s) => s.id !== screen.id)?.id ?? "");
  }

  function moveScreen(dir: -1 | 1) {
    pushHistory();
    if (!screen) return;
    const idx = screens.findIndex((s) => s.id === screen.id);
    const other = screens[idx + dir];
    if (!other) return;
    setManifest((m) => ({
      ...m,
      screens: m.screens.map((s) =>
        s.id === screen.id ? { ...s, order: other.order } : s.id === other.id ? { ...s, order: screen.order } : s,
      ),
    }));
    setDirty((d) => ({ ...d, manifest: true }));
  }

  // ---- save --------------------------------------------------------------
  const saveRef = useRef<() => Promise<void>>(async () => {});
  const dirtyKey = `${dirty.manifest}|${[...dirty.content].join(",")}|${JSON.stringify(manifest)}|${JSON.stringify(content)}`;
  useEffect(() => {
    if (!isDirty) return;
    const t = setTimeout(() => void saveRef.current(), 900);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirtyKey]);

  async function save() {
    if (!snap) return;
    setStatus("Saving…");
    try {
      let em = etags;
      // 409 = the file changed on disk (CLI, another window). Reload the etags
      // and retry once: this is a local single-user tool, the editor's version wins.
      const refreshEtags = async () => {
        const res = await fetch(`/api/projects/${encodeURIComponent(name)}`, { cache: "no-store" });
        if (!res.ok) throw new Error("could not reload after a conflict");
        const data = (await res.json()) as Snapshot;
        em = { manifest: data.manifestEtag, content: data.contentEtags };
        setEtags(em);
      };
      const put = async (url: string, body: () => object) => {
        let res = await fetch(url, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body()),
        });
        if (res.status === 409) {
          await refreshEtags();
          res = await fetch(url, {
            method: "PUT",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body()),
          });
        }
        return res;
      };
      let latestIssues = issues;
      if (dirty.manifest) {
        const res = await put(`/api/projects/${encodeURIComponent(name)}/manifest`, () => ({
          manifest,
          ifMatch: em.manifest,
        }));
        const body = await res.json();
        if (!res.ok) throw new Error(body.error + (body.details ? `: ${(body.details as string[]).join("; ")}` : ""));
        em = { ...em, manifest: body.etag };
        setEtags(em);
        latestIssues = body.issues;
      }
      for (const l of dirty.content) {
        const res = await put(`/api/projects/${encodeURIComponent(name)}/content/${encodeURIComponent(l)}`, () => ({
          content: content[l],
          ifMatch: em.content[l],
        }));
        const body = await res.json();
        if (!res.ok)
          throw new Error(`${l}: ${body.error}${body.details ? `: ${(body.details as string[]).join("; ")}` : ""}`);
        em = { ...em, content: { ...em.content, [l]: body.etag } };
        setEtags(em);
        latestIssues = body.issues;
      }
      setIssues(latestIssues);
      setDirty({ manifest: false, content: new Set() });
      setStatus("Saved");
      setTimeout(() => setStatus((v) => (v === "Saved" ? "" : v)), 1500);
    } catch (err) {
      setStatus(`Save failed: ${(err as Error).message}`);
    }
  }
  saveRef.current = save;

  // ---- generate ----------------------------------------------------------
  async function generate(scope: "screen" | "locale" | "all") {
    if (isDirty && !confirm("You have unsaved edits. Generate from the files on disk anyway?")) return;
    setGen({ running: true });
    setShowLog(true);
    const filter =
      scope === "screen"
        ? { screens: [screenId], locales: [locale] }
        : scope === "locale"
          ? { locales: [locale] }
          : undefined;
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(name)}/generate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ filter }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error);
      setGen({ running: false, summary: body });
      const r = await fetch(`/api/projects/${encodeURIComponent(name)}/readiness`, { cache: "no-store" });
      if (r.ok) {
        const data = await r.json();
        setSnap((s) => (s ? { ...s, readiness: data.readiness } : s));
      }
    } catch (err) {
      setGen({
        running: false,
        summary: {
          project: name,
          planned: 0,
          rendered: 0,
          failed: 0,
          skipped: 0,
          unchanged: 0,
          aborted: true,
          changes: { changed: [], added: [], removed: [] },
          issues: [{ level: "error", code: "ui", message: (err as Error).message }],
          jobs: [],
          filesWritten: [],
          durationMs: 0,
          log: [],
        },
      });
    }
  }

  // ---- badges ------------------------------------------------------------
  function screenStatus(s: ScreenDefinition): { level: "ok" | "warn" | "error"; title: string } {
    const keys = new Set([s.id, `${locale}/${s.id}`, `${targetId}/${locale}/${s.id}`]);
    const hits = issues.filter((i) => i.key && keys.has(i.key));
    const err = hits.find((i) => i.level === "error");
    if (err) return { level: "error", title: err.message };
    const warn = hits.find((i) => i.level === "warn");
    if (warn) return { level: "warn", title: warn.message };
    if (!s.enabled) return { level: "warn", title: "disabled" };
    return { level: "ok", title: "ready" };
  }

  const previewProblems: string[] = [];
  const previewWarnings: string[] = [];
  const failOnOverflow = snap?.config.validation.failOnOverflow ?? true;
  const failOnOverlap = snap?.config.validation.failOnTextOverlap ?? false;
  if (previewInfo.checks) {
    for (const o of previewInfo.checks.overflow)
      (failOnOverflow ? previewProblems : previewWarnings).push(`"${o.id}" overflows even at the minimum size`);
    for (const id of previewInfo.checks.textOverlapsDevice)
      (failOnOverlap ? previewProblems : previewWarnings).push(`"${id}" overlaps the device`);
    if (previewInfo.checks.missingImages.length) previewProblems.push("raw capture did not load");
    if (previewInfo.checks.fontsFailed.length)
      previewProblems.push(`font failed: ${previewInfo.checks.fontsFailed.join(", ")}`);
  }
  if (previewInfo.sourceExists === false) previewProblems.push("raw capture missing (placeholder shown)");
  // Issues that no screen badge can carry: config, fonts, manifest-wide. Shown above the canvas.
  const globalIssues = issues.filter(
    (i) =>
      i.level !== "info" &&
      (!i.key ||
        !screens.some(
          (s) =>
            [s.id, `${locale}/${s.id}`, `${targetId}/${locale}/${s.id}`].includes(i.key!) ||
            i.key!.endsWith(`/${s.id}`),
        )),
  );
  const currentScreenIssues = screen
    ? issues.filter(
        (i) =>
          i.level !== "info" &&
          i.key &&
          [screen.id, `${locale}/${screen.id}`, `${targetId}/${locale}/${screen.id}`].includes(i.key),
      )
    : [];
  const fitted = (previewInfo.fits ?? []).filter((f) => f.scale < 1 && f.fits);

  function statusForJob(j: GridJob): { status: "ok" | "warn" | "error"; text?: string } {
    const keys = new Set([
      j.screen.id,
      `${j.locale}/${j.screen.id}`,
      `${targetId}/${j.locale}/${j.screen.id}`,
      j.locale,
    ]);
    const hits = issues.filter((i) => i.key && keys.has(i.key));
    const baseErr = hits.find((i) => i.level === "error");
    const baseWarn = hits.find((i) => i.level === "warn");
    const c = checksByKey[`${targetId}/${j.locale}/${j.screen.id}`];
    const problems: string[] = [];
    const warns: string[] = [];
    if (c) {
      for (const o of c.checks.overflow) (failOnOverflow ? problems : warns).push(`${o.id} overflows`);
      for (const o of c.checks.textOverlapsDevice) (failOnOverlap ? problems : warns).push(`${o} overlaps device`);
      for (const f of c.fits) if (f.scale < 1 && f.fits) warns.push(`${f.id} ${Math.round(f.scale * 100)}%`);
    }
    if (gridHtml[j.id]?.sourceExists === false) problems.push("capture missing");
    if (!j.screen.enabled) warns.push("disabled");
    if (baseErr || problems.length)
      return { status: "error", text: [baseErr?.message ?? "", ...problems].filter(Boolean).join(", ") };
    if (baseWarn || warns.length)
      return { status: "warn", text: [baseWarn?.message ?? "", ...warns].filter(Boolean).join(", ") };
    return { status: "ok" };
  }
  const canvasItems: CanvasItem[] =
    canvasMode === "single"
      ? screen
        ? [{ id: screen.id, html: previewHtml, order: screen.order, slices: screen.panorama?.slices ?? 1 }]
        : []
      : gridJobs.map((j) => {
          const st = statusForJob(j);
          return {
            id: j.id,
            html: gridHtml[j.id]?.html ?? "",
            order: j.order,
            slices: j.screen.panorama?.slices ?? 1,
            label: canvasMode === "locales" ? j.locale : undefined,
            status: st.status,
            statusText: st.text,
          };
        });
  const liveImages =
    showLive && live && target
      ? (target.family === "ipad" ? live.ipad : live.iphone).map((u) => liveImageUrl(u, target.width, target.height))
      : [];
  const belowRow =
    showLive && target && canvasMode !== "locales"
      ? { label: live?.error ? `live: ${live.error}` : `live v${live?.version ?? "?"}`, images: liveImages }
      : undefined;
  const canvasSelectedId = canvasMode === "locales" ? locale : screenId;
  const onCanvasSelect = (id: string) => (canvasMode === "locales" ? setLocale(id) : setScreenId(id));

  if (loadError)
    return (
      <main className={styles.center}>
        <p className={styles.error}>{loadError}</p>
        <Link href="/">← all projects</Link>
      </main>
    );
  if (!snap)
    return (
      <main className={styles.center}>
        <p>Loading…</p>
      </main>
    );

  return (
    <div className={styles.app}>
      <header className={styles.topbar}>
        <Link href="/" className={styles.back} title="all projects">
          ←
        </Link>
        <strong className={styles.projName}>{snap.config.projectName}</strong>
        <span className={styles.tabs}>
          <button
            className={`${styles.tab} ${view === "screens" ? styles.tabActive : ""}`}
            onClick={() => setView("screens")}
          >
            Screens
          </button>
          <button
            className={`${styles.tab} ${view === "store" ? styles.tabActive : ""}`}
            onClick={() => setView("store")}
          >
            Store
          </button>
          <button
            className={`${styles.tab} ${view === "release" ? styles.tabActive : ""}`}
            onClick={() => setView("release")}
            title="review the generated screenshots and sign off each locale"
          >
            Release
          </button>
        </span>
        {view === "screens" && (
          <>
            <span className={styles.sep} />
            <span className={styles.tabs}>
              <button
                className={`${styles.tab} ${canvasMode === "single" ? styles.tabActive : ""}`}
                onClick={() => setCanvasMode("single")}
                title="one screen"
              >
                Single
              </button>
              <button
                className={`${styles.tab} ${canvasMode === "strip" ? styles.tabActive : ""}`}
                onClick={() => setCanvasMode("strip")}
                title="every screen side by side, as on the store"
              >
                Strip
              </button>
              <button
                className={`${styles.tab} ${canvasMode === "locales" ? styles.tabActive : ""}`}
                onClick={() => setCanvasMode("locales")}
                title="this screen in every locale"
              >
                Locales
              </button>
            </span>
            <label className={styles.check} title="App Store look: dark page, rounded corners, store spacing">
              <input type="checkbox" checked={storeLook} onChange={(e) => setStoreLook(e.target.checked)} />
              store
            </label>
            <label
              className={styles.check}
              title="Show the live App Store listing below your screens (public lookup by bundle id)"
            >
              <input
                type="checkbox"
                checked={showLive}
                onChange={(e) => {
                  setShowLive(e.target.checked);
                  if (e.target.checked && canvasMode === "locales") setCanvasMode("strip");
                }}
              />
              live
              {showLive && (
                <input
                  className={`${styles.input} ${styles.country}`}
                  value={liveCountry}
                  maxLength={2}
                  onChange={(e) => setLiveCountry(e.target.value.toLowerCase())}
                  title="storefront country code"
                />
              )}
            </label>
            <span className={styles.sep} />
            <select value={targetId} onChange={(e) => setTargetId(e.target.value)} className={styles.select}>
              {snap.targets.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.family} {t.displayClass} · {t.width}×{t.height}
                </option>
              ))}
            </select>
            <select value={locale} onChange={(e) => setLocale(e.target.value)} className={styles.select}>
              {snap.config.locales.map((l) => (
                <option key={l} value={l}>
                  {l}
                  {l === refLocale ? " (default)" : ""}
                  {dirty.content.has(l) ? " *" : ""}
                </option>
              ))}
            </select>
          </>
        )}
        <span className={styles.spacer} />
        <button
          onClick={() => setView("store")}
          className={`${styles.badge} ${styles[snap.readiness.status]} ${styles.badgeBtn}`}
          title="open the Store tab for details"
        >
          {snap.readiness.status === "pass" ? "ready" : snap.readiness.status}
        </button>
        <button
          className={`${styles.btn} ${styles.saveBtn}`}
          onClick={save}
          disabled={!isDirty}
          title="autosaves ~1s after you stop editing"
        >
          {isDirty ? "Saving…" : "Saved"}
        </button>
        <button className={styles.btnPrimary} onClick={() => generate("screen")} disabled={gen.running || !screen}>
          Generate screen
        </button>
        <button className={styles.btnPrimary} onClick={() => generate("all")} disabled={gen.running}>
          Generate all
        </button>
      </header>

      {view === "release" && (
        <div className={styles.storeArea}>
          <ReleasePanel name={name} locales={snap.config.locales} readiness={snap.readiness} />
        </div>
      )}
      {view === "store" && (
        <div className={styles.storeArea}>
          <StorePanel
            name={name}
            locales={snap.config.locales}
            readiness={snap.readiness}
            onReadiness={(r) => setSnap((s) => (s ? { ...s, readiness: r } : s))}
            hasPlay={snap.config.targets.some((t) => t.startsWith("play-"))}
          />
        </div>
      )}
      {view === "screens" && (
        <>
          <aside className={styles.left}>
            <div className={styles.sectionTitle}>
              Screens <span className={styles.muted}>({screens.length})</span>
            </div>
            <ul className={styles.screens}>
              {screens.map((s) => {
                const st = screenStatus(s);
                return (
                  <li key={s.id}>
                    <button
                      className={`${styles.screenBtn} ${s.id === screenId ? styles.active : ""}`}
                      onClick={() => setScreenId(s.id)}
                      onDoubleClick={() => {
                        setScreenId(s.id);
                        setCanvasMode("single");
                      }}
                      title={st.title}
                    >
                      <span
                        className={styles.thumb}
                        style={{ aspectRatio: `${target?.width ?? 1} / ${target?.height ?? 2}` }}
                      >
                        {gridHtml[s.id]?.html && target ? (
                          <iframe
                            title={`thumb ${s.id}`}
                            srcDoc={gridHtml[s.id].html}
                            sandbox="allow-same-origin"
                            tabIndex={-1}
                            style={{
                              width: target.width * (s.panorama?.slices ?? 1),
                              height: target.height,
                              border: 0,
                              transform: `scale(${36 / target.width})`,
                              transformOrigin: "0 0",
                              pointerEvents: "none",
                            }}
                          />
                        ) : null}
                      </span>
                      <span className={`${styles.dot} ${styles[st.level]}`} />
                      <span className={styles.order}>{String(s.order).padStart(2, "0")}</span>
                      <span className={styles.screenId}>{s.id}</span>
                      {!s.enabled && <span className={styles.muted}>off</span>}
                    </button>
                  </li>
                );
              })}
            </ul>
            <div className={styles.addRow}>
              <input
                value={newScreenId}
                onChange={(e) => setNewScreenId(e.target.value)}
                placeholder="new screen id"
                className={styles.input}
                onKeyDown={(e) => e.key === "Enter" && addScreen()}
              />
              <button className={styles.btn} onClick={addScreen}>
                Add
              </button>
            </div>
            <div className={styles.sectionTitle}>Fonts</div>
            <p className={styles.small}>
              {snap.fonts.stack.map((f) => `${f.family} (${f.source})`).join(" → ")}
              {snap.fonts.missing.length > 0 && (
                <span className={styles.error}> missing: {snap.fonts.missing.join(", ")}</span>
              )}
            </p>
          </aside>

          <main className={styles.canvas}>
            {(globalIssues.length > 0 || currentScreenIssues.length > 0) && (
              <div className={styles.issueBanner} onPointerDown={(e) => e.stopPropagation()}>
                {issues.some((i) => i.code === "content.missing-locale") && (
                  <button
                    className={styles.btnSmall}
                    title="create content files for every missing locale, prefilled from the default locale as translation drafts"
                    onClick={async () => {
                      const res = await fetch(`/api/projects/${encodeURIComponent(name)}/bootstrap-locales`, {
                        method: "POST",
                      });
                      const body = await res.json();
                      if (!res.ok) setStatus(`Locale bootstrap failed: ${body.error}`);
                      else {
                        await load();
                        setStatus(
                          `Created ${body.created.length} locale file(s) prefilled from ${refLocale} — translate them when ready`,
                        );
                      }
                    }}
                  >
                    Create missing locale files
                  </button>
                )}
                <button className={styles.issueToggle} onClick={() => setIssuesOpen((v) => !v)}>
                  <span
                    className={
                      [...globalIssues, ...currentScreenIssues].some((i) => i.level === "error")
                        ? styles.error
                        : styles.warn
                    }
                  >
                    {globalIssues.length + currentScreenIssues.length} issue(s)
                  </span>
                  <span className={styles.muted}>
                    {" "}
                    {issuesOpen ? "▾" : "▸ "}
                    {!issuesOpen && [...globalIssues, ...currentScreenIssues][0]?.message}
                  </span>
                </button>
                {issuesOpen &&
                  [...globalIssues, ...currentScreenIssues].map((i, idx) => (
                    <div key={idx} className={i.level === "error" ? styles.error : styles.warn}>
                      {i.key ? `[${i.key}] ` : ""}
                      {i.message}
                      {i.hint ? <span className={styles.muted}> — {i.hint}</span> : null}
                    </div>
                  ))}
              </div>
            )}
            {!screen && <p className={styles.emptyCanvas}>No screen selected. Add one on the left.</p>}
            {target && (
              <PreviewCanvas
                target={target}
                items={canvasItems}
                selectedId={canvasSelectedId}
                onSelect={onCanvasSelect}
                onOpen={(id) => {
                  onCanvasSelect(id);
                  setCanvasMode("single");
                }}
                guides={guides}
                onToggleGuides={() => setGuides((v) => !v)}
                mode={canvasMode}
                storeLook={storeLook}
                interactive
                highlightEl={selectedEl}
                belowRow={belowRow}
                footer={
                  <>
                    <span>
                      {target.width}×{target.height}
                      {canvasMode === "strip"
                        ? ` · ${canvasItems.length} screens · ${locale} · selected frame: drag phone/text to move, ⌥ tilt, ⇧ scale`
                        : canvasMode === "locales"
                          ? ` · ${screenId} · ${canvasItems.length} locales`
                          : " · drag phone to move, ⌥ tilt, ⇧ scale"}
                    </span>
                    {previewInfo.loading && <span className={styles.muted}> rendering…</span>}
                    {previewInfo.error && <span className={styles.error}> {previewInfo.error}</span>}
                    {previewProblems.map((p) => (
                      <span key={p} className={styles.error}>
                        {" "}
                        {p}
                      </span>
                    ))}
                    {previewWarnings.map((p) => (
                      <span key={p} className={styles.warn}>
                        {" "}
                        {p}
                      </span>
                    ))}
                    {fitted.map((f) => (
                      <span key={f.id} className={styles.warn}>
                        {" "}
                        {f.id} shrunk to {Math.round(f.scale * 100)}%
                      </span>
                    ))}
                    {previewInfo.checks && previewProblems.length === 0 && !previewInfo.loading && (
                      <span className={styles.ok}> fits</span>
                    )}
                  </>
                }
              />
            )}
          </main>

          <aside className={styles.right}>
            {screen && (
              <>
                <div className={styles.sectionTitle}>
                  Screen <code>{screen.id}</code>
                </div>
                <details className={styles.screenSettings}>
                  <summary>
                    Screen settings{" "}
                    <span className={styles.muted}>
                      · {template?.name ?? screen.template}
                      {screen.panorama ? ` · ${screen.panorama.slices}-slice panorama` : ""}
                    </span>
                  </summary>
                  <label className={styles.row}>
                    <span>Template</span>
                    <select
                      value={screen.template}
                      onChange={(e) => updateScreen({ template: e.target.value })}
                      className={styles.select}
                    >
                      {snap.templates.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className={styles.row}>
                    <span>Enabled</span>
                    <input
                      type="checkbox"
                      checked={screen.enabled}
                      onChange={(e) => updateScreen({ enabled: e.target.checked })}
                    />
                  </label>
                  <label className={styles.row}>
                    <span>Order</span>
                    <span className={styles.inline}>
                      <button className={styles.btnSmall} onClick={() => moveScreen(-1)}>
                        ↑
                      </button>
                      <button className={styles.btnSmall} onClick={() => moveScreen(1)}>
                        ↓
                      </button>
                      <span className={styles.muted}>{screen.order}</span>
                    </span>
                  </label>
                  <label className={styles.row}>
                    <span>Raw capture</span>
                    <input
                      className={styles.input}
                      value={screen.source.filePattern}
                      onChange={(e) => updateScreen({ source: { ...screen.source, filePattern: e.target.value } })}
                    />
                  </label>
                  <label className={styles.row}>
                    <span>Localized captures</span>
                    <input
                      type="checkbox"
                      checked={screen.source.localized}
                      onChange={(e) => updateScreen({ source: { ...screen.source, localized: e.target.checked } })}
                    />
                  </label>
                  <label className={styles.row}>
                    <span title="one artwork spanning consecutive screenshots; the following order numbers are reserved">
                      Panorama
                    </span>
                    <select
                      className={styles.select}
                      value={screen.panorama?.slices ?? 1}
                      onChange={(e) => {
                        const n = Number(e.target.value);
                        updateScreen({ panorama: n > 1 ? { slices: n } : undefined });
                      }}
                    >
                      <option value={1}>single screenshot</option>
                      <option value={2}>2 slices (double wide)</option>
                      <option value={3}>3 slices (triple wide)</option>
                    </select>
                  </label>
                  <p className={styles.small}>
                    store/raw/{target?.family}/{screen.source.localized ? locale : refLocale}/
                    {screen.source.filePattern
                      .replaceAll("{order}", String(screen.order).padStart(2, "0"))
                      .replaceAll("{id}", screen.id)}
                    {(previewInfo.sourceExists === false ||
                      (previewInfo.checks && previewInfo.checks.missingImages.length > 0)) && (
                      <span className={styles.error}> (missing)</span>
                    )}
                  </p>
                </details>

                <div className={styles.sectionTitle}>
                  Element
                  <span className={styles.spacer} />
                  <select
                    className={styles.select}
                    value=""
                    title="apply a named preset from store-shots.config.json"
                    onChange={(e) => {
                      const p = snap.config.presets?.[e.target.value];
                      if (p && screen) updateScreen({ overrides: { ...p } });
                    }}
                  >
                    <option value="">apply preset…</option>
                    {Object.keys(snap.config.presets ?? {}).map((k) => (
                      <option key={k} value={k}>
                        {k}
                      </option>
                    ))}
                  </select>
                  <button
                    className={styles.btnSmall}
                    title="save the current overrides as a named preset in store-shots.config.json"
                    onClick={async () => {
                      if (!screen) return;
                      const nameP = prompt("Preset name:");
                      if (!nameP) return;
                      const presets = { ...(snap.config.presets ?? {}), [nameP]: screen.overrides };
                      const res = await fetch(`/api/projects/${encodeURIComponent(name)}/presets`, {
                        method: "PUT",
                        headers: { "content-type": "application/json" },
                        body: JSON.stringify({ presets, ifMatch: snap.configEtag }),
                      });
                      const body = await res.json();
                      if (!res.ok) {
                        setStatus(`Preset save failed: ${body.error}`);
                        return;
                      }
                      setSnap((sn) => (sn ? { ...sn, config: { ...sn.config, presets }, configEtag: body.etag } : sn));
                      setStatus(`Preset "${nameP}" saved`);
                      setTimeout(() => setStatus(""), 2000);
                    }}
                  >
                    save preset
                  </button>
                </div>
                <div className={styles.chips}>
                  {["background", "phone", "text", "layers"].map((g) => (
                    <button
                      key={g}
                      className={`${styles.chip} ${groupOf(selectedEl) === g ? styles.chipActive : ""}`}
                      onClick={() =>
                        setSelectedEl(
                          g === "text" ? "text:0" : g === "layers" ? `layer:${screen.layers?.[0]?.id ?? ""}` : g,
                        )
                      }
                      title="or click the element in the preview"
                    >
                      {g === "background"
                        ? "Background"
                        : g === "phone"
                          ? "Phone"
                          : g === "text"
                            ? "Text"
                            : `Elements${screen.layers?.length ? ` (${screen.layers.length})` : ""}`}
                    </button>
                  ))}
                </div>
                {groupOf(selectedEl) === "layers" && (
                  <LayerInspector
                    projectName={name}
                    layers={screen.layers ?? []}
                    selectedLayerId={selectedEl.startsWith("layer:") ? selectedEl.slice(6) : null}
                    onSelect={(id) => setSelectedEl(`layer:${id}`)}
                    onChange={(layers) => updateScreen({ layers })}
                    textOf={(id) => (typeof fields[id] === "string" ? (fields[id] as string) : "")}
                    onTextChange={(id, text) => setField(id, text)}
                    aspect={target ? target.height / target.width : 2}
                    slices={screen.panorama?.slices ?? 1}
                    onDelete={deleteLayer}
                    locale={locale}
                  />
                )}
                {groupOf(selectedEl) === "background" && (
                  <BackgroundEditor
                    projectName={name}
                    overrides={screen.overrides}
                    setOverride={setOverride}
                    setOverrides={setOverrides}
                    defaultBackground={`linear-gradient(165deg, ${snap.config.brand.primary} 0%, #00000088 100%)`}
                    brandBackground={snap.config.brand.background}
                    configEtag={snap.configEtag}
                    onClearAllScreens={clearBackgroundsEverywhere}
                    onSaveBrandBackground={async (values, etag) => {
                      const res = await fetch(`/api/projects/${encodeURIComponent(name)}/brand-background`, {
                        method: "PUT",
                        headers: { "content-type": "application/json" },
                        body: JSON.stringify({ values, ifMatch: etag }),
                      });
                      const body = await res.json();
                      if (!res.ok) {
                        setStatus(`Default background failed: ${body.error}`);
                        return null;
                      }
                      setSnap((sn) =>
                        sn
                          ? {
                              ...sn,
                              config: { ...sn.config, brand: { ...sn.config.brand, background: values ?? undefined } },
                              configEtag: body.etag,
                            }
                          : sn,
                      );
                      setStatus("Default background saved for all screens");
                      setTimeout(() => setStatus((v) => (v.startsWith("Default background") ? "" : v)), 2500);
                      return body.etag as string;
                    }}
                  />
                )}
                {groupOf(selectedEl) === "phone" && (
                  <div className={styles.inline}>
                    <button
                      className={styles.btnSmall}
                      title="offset X = 0 (template default position)"
                      onClick={() => setOverrides({ screenshotOffsetX: "" })}
                    >
                      Center
                    </button>
                    <button
                      className={styles.btnSmall}
                      title="clear position, scale and tilt"
                      onClick={() =>
                        setOverrides({
                          screenshotOffsetX: "",
                          screenshotOffsetY: "",
                          screenshotScale: "",
                          deviceTilt: "",
                        })
                      }
                    >
                      Reset position
                    </button>
                  </div>
                )}
                {groupOf(selectedEl) === "text" && (
                  <div className={styles.inline}>
                    <button
                      className={styles.btnSmall}
                      title="clear this slide's text offsets"
                      onClick={() => {
                        const slice = Number(selectedEl.split(":")[1] ?? 0);
                        setOverrides(
                          slice === 0
                            ? { textOffsetX: "", textOffsetY: "" }
                            : { [`textOffsetX${slice + 1}`]: "", [`textOffsetY${slice + 1}`]: "" },
                        );
                      }}
                    >
                      Reset offsets
                    </button>
                  </div>
                )}
                {(template?.overrideKeys ?? [])
                  .filter(
                    (k) => groupOf(selectedEl) !== "background" && (EL_GROUPS[groupOf(selectedEl)] ?? []).includes(k),
                  )
                  .map((key) => {
                    const c = OVERRIDE_CONTROLS[key] ?? { label: key, kind: "text" as const };
                    const v = screen.overrides[key];
                    if (key === "shell") {
                      const famKey = target?.family ?? "iphone";
                      const current =
                        typeof v === "string"
                          ? v
                          : v && typeof v === "object"
                            ? ((v as Record<string, string>)[famKey] ?? "")
                            : "";
                      const family = target?.family === "ipad" ? "iPad" : "iPhone";
                      const families = [...new Set(snap.targets.map((t) => t.family))];
                      // With several device families, the shell is stored per family so
                      // the iPhone target can wear an iPhone frame and the iPad an iPad one.
                      const setShell = (value: string) => {
                        const prev = screen.overrides.shell;
                        if (families.length <= 1 && typeof prev !== "object") {
                          setOverride("shell", value);
                          return;
                        }
                        const map: Record<string, string> =
                          prev && typeof prev === "object"
                            ? { ...(prev as Record<string, string>) }
                            : typeof prev === "string" && prev
                              ? Object.fromEntries(families.filter((f) => f !== famKey).map((f) => [f, prev]))
                              : {};
                        if (value) map[famKey] = value;
                        else delete map[famKey];
                        setOverride("shell", Object.keys(map).length ? map : "");
                      };
                      return (
                        <label key={key} className={styles.row}>
                          <span
                            title={`neutral CSS shell or an official device frame (store-shots frames setup)${families.length > 1 ? `; applies to the ${famKey} target — switch the target above to set the other device` : ""}`}
                          >
                            Device shell{families.length > 1 ? ` (${famKey})` : ""}
                          </span>
                          <select
                            className={styles.select}
                            value={current}
                            onChange={(e) => setShell(e.target.value)}
                          >
                            <option value="">default (dark shell)</option>
                            <optgroup label="Neutral">
                              <option value="light">light shell</option>
                              <option value="none">no shell</option>
                            </optgroup>
                            <optgroup
                              label={
                                frames === null
                                  ? "Device frames (loading…)"
                                  : frames.length
                                    ? `Device frames (${family} first)`
                                    : "Device frames — run: store-shots frames setup"
                              }
                            >
                              {current.startsWith("frame:") && !frames?.some((f) => `frame:${f.name}` === current) && (
                                <option value={current}>{current.slice(6)}</option>
                              )}
                              {[...(frames ?? [])]
                                .sort(
                                  (a, b) =>
                                    Number(b.name.includes(family)) - Number(a.name.includes(family)) ||
                                    a.name.localeCompare(b.name),
                                )
                                .map((f) => (
                                  <option key={f.name} value={`frame:${f.name}`}>
                                    {f.name.replace(/^Apple /, "")}
                                  </option>
                                ))}
                            </optgroup>
                          </select>
                        </label>
                      );
                    }
                    return (
                      <label key={key} className={styles.row}>
                        <span title={c.hint}>{c.label}</span>
                        {c.kind === "select" ? (
                          <select
                            className={styles.select}
                            value={(v as string) ?? ""}
                            onChange={(e) => setOverride(key, e.target.value)}
                          >
                            <option value="">default</option>
                            {typeof v === "string" && v && !c.options!.includes(v) && <option value={v}>{v}</option>}
                            {c.options!.map((o) => (
                              <option key={o} value={o}>
                                {o}
                              </option>
                            ))}
                          </select>
                        ) : c.kind === "number" ? (
                          <span className={styles.inline}>
                            <input
                              type="range"
                              min={c.min}
                              max={c.max}
                              step={c.step}
                              value={typeof v === "number" ? v : (c.min ?? 0) + ((c.max ?? 1) - (c.min ?? 0)) / 2}
                              onChange={(e) => setOverride(key, Number(e.target.value))}
                              className={styles.range}
                            />
                            <input
                              className={`${styles.input} ${styles.num}`}
                              type="number"
                              min={c.min}
                              max={c.max}
                              step={c.step}
                              value={(v as number) ?? ""}
                              onChange={(e) => setOverride(key, e.target.value === "" ? "" : Number(e.target.value))}
                              placeholder="–"
                            />
                          </span>
                        ) : c.kind === "color" ? (
                          <ColorField
                            value={(v as string) ?? ""}
                            onChange={(nv) => setOverride(key, nv)}
                            fallback={key === "textColor" ? snap.config.brand.onPrimary : snap.config.brand.primary}
                            presets={[snap.config.brand.primary, snap.config.brand.onPrimary]}
                          />
                        ) : (
                          <input
                            className={styles.input}
                            value={(v as string) ?? ""}
                            onChange={(e) => setOverride(key, e.target.value)}
                            placeholder="default"
                          />
                        )}
                      </label>
                    );
                  })}
                <details className={styles.allOverrides}>
                  <summary>All overrides</summary>
                  {(template?.overrideKeys ?? [])
                    .filter((k) => !(EL_GROUPS[groupOf(selectedEl)] ?? []).includes(k))
                    .map((key) => {
                      const c = OVERRIDE_CONTROLS[key] ?? { label: key, kind: "text" as const };
                      const v = screen.overrides[key];
                      return (
                        <label key={key} className={styles.row}>
                          <span title={c.hint}>{c.label}</span>
                          {c.kind === "select" ? (
                            <select
                              className={styles.select}
                              value={(v as string) ?? ""}
                              onChange={(e) => setOverride(key, e.target.value)}
                            >
                              <option value="">default</option>
                              {typeof v === "string" && v && !c.options!.includes(v) && <option value={v}>{v}</option>}
                              {c.options!.map((o) => (
                                <option key={o} value={o}>
                                  {o}
                                </option>
                              ))}
                            </select>
                          ) : c.kind === "number" ? (
                            <input
                              className={styles.input}
                              type="number"
                              min={c.min}
                              max={c.max}
                              step={c.step}
                              value={(v as number) ?? ""}
                              onChange={(e) => setOverride(key, e.target.value === "" ? "" : Number(e.target.value))}
                              placeholder="–"
                            />
                          ) : c.kind === "color" ? (
                            <ColorField
                              value={(v as string) ?? ""}
                              onChange={(nv) => setOverride(key, nv)}
                              presets={[snap.config.brand.primary, snap.config.brand.onPrimary]}
                            />
                          ) : (
                            <input
                              className={styles.input}
                              value={(v as string) ?? ""}
                              onChange={(e) => setOverride(key, e.target.value)}
                              placeholder="default"
                            />
                          )}
                        </label>
                      );
                    })}
                </details>
                <div className={styles.sectionTitle}>
                  Copy <span className={styles.muted}>{locale}</span>
                </div>
                <div className={styles.chips}>
                  {snap.config.locales.map((l) => {
                    const f = (content[l]?.screens[screenId] as Fields | undefined) ?? {};
                    const required = template?.requiredFields ?? [];
                    const missing =
                      !content[l] ||
                      required.some((rf) => !f[rf] || (typeof f[rf] === "string" && !(f[rf] as string).trim()));
                    const same = l !== refLocale && required.every((rf) => f[rf] === refFields[rf]);
                    const state = missing ? "error" : same ? "warn" : "ok";
                    return (
                      <button
                        key={l}
                        className={`${styles.chip} ${l === locale ? styles.chipActive : ""}`}
                        onClick={() => setLocale(l)}
                        title={
                          missing
                            ? `${l}: missing copy for this screen`
                            : same
                              ? `${l}: identical to ${refLocale} (untranslated draft?)`
                              : `${l}: translated`
                        }
                      >
                        <span className={`${styles.dot} ${styles[state]}`} /> {l}
                      </button>
                    );
                  })}
                </div>
                {Array.from({ length: screen.panorama?.slices ?? 1 }, (_, slice) => slice).flatMap((slice) => {
                  const items =
                    template?.requiredFields.concat(template.optionalFields).map((base) => {
                      const f = slice === 0 ? base : `${base}${slice + 1}`;
                      return { f, base, slice };
                    }) ?? [];
                  return [
                    ...(screen.panorama
                      ? [
                          <div key={`slide-${slice}`} className={styles.sliceHead}>
                            Slide {slice + 1}
                          </div>,
                        ]
                      : []),
                    ...items.map(({ f, base }) => {
                      const required = slice === 0 && template!.requiredFields.includes(base);
                      const value = fields[f];
                      const ref = refFields[f];
                      return (
                        <div key={f} className={styles.field}>
                          <div className={styles.fieldHead}>
                            <span>
                              {f}
                              {required && <span className={styles.req}> *</span>}
                            </span>
                            {locale !== refLocale && typeof ref === "string" && !value && (
                              <button
                                className={styles.link}
                                onClick={() => setField(f, ref)}
                                title={`copy the ${refLocale} text as a starting point`}
                              >
                                prefill {refLocale}
                              </button>
                            )}
                            <span
                              className={
                                previewInfo.budgets?.[f] &&
                                typeof value === "string" &&
                                value.length > previewInfo.budgets[f]
                                  ? styles.warn
                                  : styles.muted
                              }
                              title={
                                previewInfo.budgets?.[f]
                                  ? `~${previewInfo.budgets[f]} characters fit before the text shrinks`
                                  : undefined
                              }
                            >
                              {typeof value === "string" ? value.length : 0}
                              {previewInfo.budgets?.[f] ? `/~${previewInfo.budgets[f]}` : ""}
                            </span>
                            {!required && (
                              <button
                                className={styles.link}
                                onClick={() => setField(f, value === null ? "" : null)}
                                title="null = intentionally empty"
                              >
                                {value === null ? "empty (null)" : "set empty"}
                              </button>
                            )}
                          </div>
                          <textarea
                            className={styles.textarea}
                            rows={f === "headline" ? 2 : 2}
                            value={value ?? ""}
                            disabled={value === null}
                            dir={content[locale]?.direction ?? "auto"}
                            onChange={(e) => setField(f, e.target.value)}
                            placeholder={required ? "required" : "optional"}
                          />
                          {locale !== refLocale && ref && (
                            <div className={styles.ref}>
                              {refLocale}: {ref}
                            </div>
                          )}
                        </div>
                      );
                    }),
                  ];
                })}

                <div className={styles.dangerRow}>
                  <button
                    className={styles.btn}
                    onClick={async () => {
                      if (!screen) return;
                      const newId = prompt("New screen id:", `${screen.id}-copy`);
                      if (!newId) return;
                      if (isDirty) {
                        setStatus("Save your edits before duplicating");
                        return;
                      }
                      const res = await fetch(`/api/projects/${encodeURIComponent(name)}/duplicate`, {
                        method: "POST",
                        headers: { "content-type": "application/json" },
                        body: JSON.stringify({
                          sourceId: screen.id,
                          newId,
                          ifMatch: { manifest: etags.manifest, content: etags.content },
                        }),
                      });
                      const body = await res.json();
                      if (!res.ok) {
                        setStatus(`Duplicate failed: ${body.error}`);
                        return;
                      }
                      await load();
                      setScreenId(newId);
                      setStatus(`Duplicated as ${newId}`);
                      setTimeout(() => setStatus(""), 2000);
                    }}
                  >
                    Duplicate screen
                  </button>{" "}
                  <button className={styles.btnDanger} onClick={removeScreen}>
                    Remove screen
                  </button>
                </div>
              </>
            )}
          </aside>
        </>
      )}
      <footer className={`${styles.log} ${showLog ? styles.logOpen : ""}`}>
        <button
          className={styles.sheetBtn}
          title="write contact sheets of the generated screenshots into store/generated/sheets/"
          onClick={async () => {
            const res = await fetch(`/api/projects/${encodeURIComponent(name)}/sheet`, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: "{}",
            });
            const body = await res.json();
            setStatus(
              res.ok
                ? body.sheets.length
                  ? `Sheets: ${body.sheets.map((x: { file: string }) => x.file).join(", ")}`
                  : "Nothing generated yet"
                : `Sheet failed: ${body.error}`,
            );
          }}
        >
          Contact sheets
        </button>
        <button className={styles.logToggle} onClick={() => setShowLog((v) => !v)}>
          {gen.running
            ? "Generating…"
            : gen.summary
              ? `Last run: ${gen.summary.rendered} rendered, ${gen.summary.unchanged} unchanged, ${gen.summary.failed} failed, ${gen.summary.skipped} skipped, ${gen.summary.filesWritten.length} file(s) in ${(gen.summary.durationMs / 1000).toFixed(1)} s`
              : "Generation log"}
          <span className={styles.muted}> {showLog ? "▾" : "▸"}</span>
        </button>
        {showLog && (
          <pre className={styles.logBody}>
            {gen.summary?.aborted && "ABORTED — nothing written\n"}
            {gen.summary &&
              (gen.summary.changes.changed.length ||
              gen.summary.changes.added.length ||
              gen.summary.changes.removed.length
                ? `changes vs previous run: ${gen.summary.changes.changed.length} changed, ${gen.summary.changes.added.length} new, ${gen.summary.changes.removed.length} removed\n` +
                  [
                    ...gen.summary.changes.changed.map((f) => `  ~ ${f}`),
                    ...gen.summary.changes.added.map((f) => `  + ${f}`),
                    ...gen.summary.changes.removed.map((f) => `  - ${f}`),
                  ].join("\n") +
                  "\n\n"
                : "")}
            {(gen.summary?.log ?? []).join("\n")}
            {gen.summary &&
              gen.summary.issues.length > 0 &&
              "\n\n" +
                gen.summary.issues
                  .map(
                    (i) =>
                      `${i.level.toUpperCase()} ${i.key ? `[${i.key}] ` : ""}${i.message}${i.hint ? `\n      hint: ${i.hint}` : ""}`,
                  )
                  .join("\n")}
            {!gen.summary && !gen.running && "No generation run yet in this session."}
          </pre>
        )}
      </footer>
      {showShortcuts && (
        <div className={styles.shortcuts} onClick={() => setShowShortcuts(false)}>
          <div className={styles.shortcutsCard} onClick={(e) => e.stopPropagation()}>
            <div className={styles.sectionTitle}>Keyboard and mouse</div>
            <table className={styles.shortcutsTable}>
              <tbody>
                {[
                  ["drag element", "move phone / text / layer"],
                  ["⌥ drag phone", "tilt"],
                  ["⇧ drag phone", "scale"],
                  ["side / corner handles", "rotate / resize selection"],
                  ["arrows (+⇧)", "nudge selected element"],
                  ["⌫ / Del", "delete selected element"],
                  ["⌘Z / ⇧⌘Z", "undo / redo"],
                  ["⌘/ctrl + wheel or pinch", "zoom at cursor"],
                  ["drag canvas / wheel", "pan"],
                  ["+  −  0  1", "zoom in / out / fit / 100%"],
                  ["g", "layout guides"],
                  ["double-click frame", "open in Single mode"],
                  ["drag on selected frame (Strip)", "position phone/text like Single mode"],
                  ["double-click screen row", "open in Single mode"],
                  ["click element or chips", "select for the inspector"],
                  ["?", "this sheet"],
                ].map(([k, v]) => (
                  <tr key={k}>
                    <td>
                      <code>{k}</code>
                    </td>
                    <td>{v}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {status && status !== "Saving…" && (
        <div
          className={`${styles.toast} ${status.startsWith("Save failed") || status.includes("failed") ? styles.toastError : ""}`}
        >
          <span>{status}</span>
          {status.includes("reload") && (
            <button
              className={styles.btnSmall}
              onClick={() => {
                void load();
                setStatus("");
              }}
            >
              Reload
            </button>
          )}
          <button className={styles.toastClose} onClick={() => setStatus("")} title="dismiss">
            ×
          </button>
        </div>
      )}
    </div>
  );
}
