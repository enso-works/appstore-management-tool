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
    kind: "text" | "number" | "select";
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
  patternColor: { label: "Pattern colour", kind: "text", hint: "CSS colour for pattern lines, e.g. rgba(0,0,0,0.08)" },
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
  textOffsetY: { label: "Text offset Y", kind: "number", min: -0.3, max: 1, step: 0.01 },
  textAlign: { label: "Text align", kind: "select", options: ["start", "center", "end"] },
  textColor: { label: "Text colour", kind: "text", hint: "CSS colour; default brand.onPrimary" },
  shell: { label: "Device shell", kind: "select", options: ["dark", "light", "none"] },
  cardPosition: { label: "Card position", kind: "select", options: ["top", "bottom"] },
  cardColor: { label: "Card colour", kind: "text", hint: "CSS colour; default brand.primary at 93%" },
};

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
  }>({ loading: false });
  const [status, setStatus] = useState<string>("");
  const [gen, setGen] = useState<{ running: boolean; summary?: GenerationSummary & { log: string[] } }>({
    running: false,
  });
  const [showLog, setShowLog] = useState(false);
  const [newScreenId, setNewScreenId] = useState("");
  const [view, setView] = useState<"screens" | "store">("screens");
  const [canvasMode, setCanvasMode] = useState<"single" | "strip" | "locales">("single");
  const [storeLook, setStoreLook] = useState(false);
  const [issuesOpen, setIssuesOpen] = useState(false);
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
          body: JSON.stringify({ targetId, locale, screen, fields, direction, interactive: true }),
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
        try {
          sourceExists = sidecar
            ? (JSON.parse(decodeURIComponent(sidecar)) as { sourceExists: boolean }).sourceExists
            : undefined;
        } catch {
          sourceExists = undefined;
        }
        setPreviewHtml(await res.text());
        setPreviewInfo({ loading: false, sourceExists });
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
    canvasMode === "strip"
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
    if (canvasMode === "single" || !snap || !target) return;
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

  // ---- editing -----------------------------------------------------------
  function setField(field: string, value: string | null) {
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

  function addScreen() {
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
    setManifest((m) => ({ ...m, screens: m.screens.filter((s) => s.id !== screen.id) }));
    setDirty((d) => ({ ...d, manifest: true }));
    setScreenId(screens.find((s) => s.id !== screen.id)?.id ?? "");
  }

  function moveScreen(dir: -1 | 1) {
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
  async function save() {
    if (!snap) return;
    setStatus("Saving…");
    try {
      let latestIssues = issues;
      if (dirty.manifest) {
        const res = await fetch(`/api/projects/${encodeURIComponent(name)}/manifest`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ manifest, ifMatch: etags.manifest }),
        });
        const body = await res.json();
        if (!res.ok) throw new Error(body.error + (body.details ? `: ${(body.details as string[]).join("; ")}` : ""));
        setEtags((e) => ({ ...e, manifest: body.etag }));
        latestIssues = body.issues;
      }
      for (const l of dirty.content) {
        const res = await fetch(`/api/projects/${encodeURIComponent(name)}/content/${encodeURIComponent(l)}`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ content: content[l], ifMatch: etags.content[l] }),
        });
        const body = await res.json();
        if (!res.ok)
          throw new Error(`${l}: ${body.error}${body.details ? `: ${(body.details as string[]).join("; ")}` : ""}`);
        setEtags((e) => ({ ...e, content: { ...e.content, [l]: body.etag } }));
        latestIssues = body.issues;
      }
      setIssues(latestIssues);
      setDirty({ manifest: false, content: new Set() });
      setStatus("Saved");
      setTimeout(() => setStatus(""), 1500);
    } catch (err) {
      setStatus(`Save failed: ${(err as Error).message}`);
    }
  }

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
    showLive && target && canvasMode === "strip"
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
        <Link href="/" className={styles.back}>
          ←
        </Link>
        <strong>{snap.config.projectName}</strong>
        <span className={styles.muted}>{snap.name}</span>
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
        </span>
        {view === "screens" && (
          <>
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
              <input type="checkbox" checked={storeLook} onChange={(e) => setStoreLook(e.target.checked)} /> store look
            </label>
            {canvasMode === "strip" && (
              <label
                className={styles.check}
                title="Show what is live on the App Store under the strip (public lookup by bundle id)"
              >
                <input type="checkbox" checked={showLive} onChange={(e) => setShowLive(e.target.checked)} /> live
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
            )}
          </>
        )}
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
        <span className={styles.spacer} />
        <button
          onClick={() => setView("store")}
          className={`${styles.badge} ${styles[snap.readiness.status]} ${styles.badgeBtn}`}
        >
          readiness: {snap.readiness.status}
        </button>
        <span className={styles.status}>{status}</span>
        <button className={styles.btn} onClick={save} disabled={!isDirty}>
          Save{isDirty ? " *" : ""}
        </button>
        <button className={styles.btnPrimary} onClick={() => generate("screen")} disabled={gen.running || !screen}>
          Generate screen
        </button>
        <button className={styles.btnPrimary} onClick={() => generate("all")} disabled={gen.running}>
          Generate all
        </button>
      </header>

      {view === "store" && (
        <div className={styles.storeArea}>
          <StorePanel
            name={name}
            locales={snap.config.locales}
            readiness={snap.readiness}
            onReadiness={(r) => setSnap((s) => (s ? { ...s, readiness: r } : s))}
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
                      title={st.title}
                    >
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
                mode={canvasMode}
                storeLook={storeLook}
                interactive
                belowRow={belowRow}
                footer={
                  <>
                    <span>
                      {target.width}×{target.height}
                      {canvasMode === "strip"
                        ? ` · ${canvasItems.length} screens · ${locale}`
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

                <div className={styles.sectionTitle}>
                  Copy <span className={styles.muted}>{locale}</span>
                </div>
                {template?.requiredFields.concat(template.optionalFields).map((f) => {
                  const required = template.requiredFields.includes(f);
                  const value = fields[f];
                  const ref = refFields[f];
                  return (
                    <div key={f} className={styles.field}>
                      <div className={styles.fieldHead}>
                        <span>
                          {f}
                          {required && <span className={styles.req}> *</span>}
                        </span>
                        <span className={styles.muted}>{typeof value === "string" ? value.length : 0}</span>
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
                })}

                <div className={styles.sectionTitle}>
                  Style overrides
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
                {(template?.overrideKeys ?? []).map((key) => {
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
    </div>
  );
}
