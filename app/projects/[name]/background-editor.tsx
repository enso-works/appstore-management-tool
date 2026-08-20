"use client";

import { useEffect, useRef, useState } from "react";
import { BACKGROUND_PRESETS } from "@/lib/background-presets";
import type { BackgroundValues } from "@/lib/schema";
import { PATTERN_KINDS, patternDataUri, type PatternKind } from "@/templates/shared";
import styles from "./editor.module.css";

interface Props {
  projectName: string;
  overrides: Record<string, unknown>;
  setOverride: (key: string, value: unknown) => void;
  /** Atomic multi-key update ("" removes a key). */
  setOverrides: (patch: Record<string, unknown>) => void;
  /** The brand gradient used when background is unset (for the "default" swatch). */
  defaultBackground: string;
  /** Project-wide default background from config (brand.background). */
  brandBackground?: BackgroundValues;
  configEtag: string;
  /** Persist a new project default; resolves to the fresh config etag. */
  onSaveBrandBackground: (values: BackgroundValues | null, etag: string) => Promise<string | null>;
  /** Drop background overrides from every screen so the new default shows everywhere. */
  onClearAllScreens: () => void;
}

const BG_KEYS = ["background", "backgroundImage", "patternColor", "patternScale"] as const;

/** Preview CSS for a preset card (small tile). */
function presetCss(v: BackgroundValues): { background: string; backgroundImage?: string; backgroundSize?: string } {
  const base = v.background ?? "#888";
  if (v.backgroundImage?.startsWith("pattern:")) {
    const kind = v.backgroundImage.slice("pattern:".length) as PatternKind;
    const tile = kind === "waves" || kind === "zigzag" ? 22 : 12;
    return {
      background: base,
      backgroundImage: patternDataUri(kind, v.patternColor ?? "rgba(0,0,0,0.1)", tile),
      backgroundSize: `${tile}px auto`,
    };
  }
  return { background: base };
}

interface Asset {
  rel: string;
  name: string;
  bytes: number;
}

type Mode = "default" | "solid" | "gradient" | "css";

function parseBackground(v: unknown): {
  mode: Mode;
  solid: string;
  from: string;
  to: string;
  angle: number;
  raw: string;
} {
  const fallback = { solid: "#F4F0E7", from: "#6946F4", to: "#312A91", angle: 165 };
  if (typeof v !== "string" || !v.trim()) return { mode: "default", raw: "", ...fallback };
  const s = v.trim();
  if (/^#[0-9a-fA-F]{3,8}$/.test(s)) return { mode: "solid", solid: s, from: s, to: fallback.to, angle: 165, raw: s };
  const g =
    /^linear-gradient\(\s*(-?\d+(?:\.\d+)?)deg\s*,\s*(#[0-9a-fA-F]{3,8})[^,]*,\s*(#[0-9a-fA-F]{3,8})[^)]*\)$/.exec(s);
  if (g) return { mode: "gradient", solid: g[2], from: g[2], to: g[3], angle: Number(g[1]), raw: s };
  return { mode: "css", raw: s, ...fallback };
}

/** Normalise #rgb/#rrggbbaa to #rrggbb for <input type="color">. */
function toHex6(c: string): string {
  const m = /^#([0-9a-fA-F]{3,8})$/.exec(c.trim());
  if (!m) return "#888888";
  let h = m[1];
  if (h.length === 3)
    h = h
      .split("")
      .map((x) => x + x)
      .join("");
  return `#${h.slice(0, 6)}`;
}

/**
 * Visual background editing (roadmap follow-up): solid / gradient builders,
 * a pattern gallery with live previews, pattern colour + scale, and project
 * background images (upload into store/assets/backgrounds/).
 */
export default function BackgroundEditor({
  projectName,
  overrides,
  setOverride,
  setOverrides,
  defaultBackground,
  brandBackground,
  configEtag,
  onSaveBrandBackground,
  onClearAllScreens,
}: Props) {
  const parsed = parseBackground(overrides.background);
  const [mode, setMode] = useState<Mode>(parsed.mode);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Follow external changes (preset applied, screen switched).
  const bgKey = String(overrides.background ?? "");
  const [lastBgKey, setLastBgKey] = useState(bgKey);
  if (bgKey !== lastBgKey) {
    setLastBgKey(bgKey);
    setMode(parseBackground(overrides.background).mode);
  }

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

  const img = typeof overrides.backgroundImage === "string" ? overrides.backgroundImage : "";
  const patternColor = typeof overrides.patternColor === "string" ? overrides.patternColor : "rgba(0,0,0,0.08)";
  const patternScale = typeof overrides.patternScale === "number" ? overrides.patternScale : 1;
  const activePattern = img.startsWith("pattern:") ? (img.slice("pattern:".length) as PatternKind) : null;
  const activeAsset = img.startsWith("asset:") ? img.slice("asset:".length) : null;

  const applyGradient = (from: string, to: string, angle: number) =>
    setOverride("background", `linear-gradient(${angle}deg, ${from} 0%, ${to} 100%)`);

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
        body: JSON.stringify({ fileName: file.name, dataBase64: btoa(bin) }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error);
      setAssets(body.assets);
      setOverride("backgroundImage", `asset:${body.asset.rel}`);
    } catch (err) {
      alert(`Upload failed: ${(err as Error).message}`);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  const screenHasOwn = BG_KEYS.some((k) => overrides[k] !== undefined && overrides[k] !== "");
  const applyValues = (v: BackgroundValues) =>
    setOverrides({
      background: v.background ?? "",
      backgroundImage: v.backgroundImage ?? "",
      patternColor: v.patternColor ?? "",
      patternScale: v.patternScale ?? "",
    });
  const clearOwn = () => setOverrides(Object.fromEntries(BG_KEYS.map((k) => [k, ""])));
  const effective: BackgroundValues = {
    background: (overrides.background as string) || brandBackground?.background,
    backgroundImage: (overrides.backgroundImage as string) || brandBackground?.backgroundImage,
    patternColor: (overrides.patternColor as string) || brandBackground?.patternColor,
    patternScale: (overrides.patternScale as number) ?? brandBackground?.patternScale,
  };

  return (
    <div className={styles.bgEditor}>
      <div className={styles.sectionSub}>Styles</div>
      <div className={styles.presetGrid}>
        {BACKGROUND_PRESETS.map((preset) => (
          <button
            key={preset.id}
            className={styles.presetCard}
            title={`apply "${preset.name}" to this screen`}
            onClick={() => applyValues(preset.values)}
          >
            <span className={styles.presetSwatch} style={presetCss(preset.values)} />
            <span className={styles.presetName}>{preset.name}</span>
          </button>
        ))}
      </div>
      <div className={styles.inline}>
        <button
          className={styles.btnSmall}
          title="make this screen's background the project default on every screen (drops each screen's own background)"
          onClick={async () => {
            const etag = await onSaveBrandBackground({ ...effective, span: brandBackground?.span }, configEtag);
            if (etag) onClearAllScreens();
          }}
        >
          Set for all screens
        </button>
        {brandBackground && (
          <label
            className={styles.inline}
            title="stretch the project default across all screens: each screen shows its slice of one continuous background"
          >
            <input
              type="checkbox"
              checked={brandBackground.span === true}
              onChange={async (e) => {
                await onSaveBrandBackground({ ...brandBackground, span: e.target.checked || undefined }, configEtag);
              }}
            />
            <span className={styles.small}>Span across screens</span>
          </label>
        )}
        {screenHasOwn && (
          <button
            className={styles.btnSmall}
            title="drop this screen's own background and inherit the project default"
            onClick={clearOwn}
          >
            Use project default
          </button>
        )}
        {!screenHasOwn && brandBackground && <span className={styles.small}>inheriting the project default</span>}
      </div>

      <div className={styles.bgModes}>
        {(
          [
            ["default", "Default"],
            ["solid", "Solid"],
            ["gradient", "Gradient"],
            ["css", "CSS"],
          ] as [Mode, string][]
        ).map(([m, label]) => (
          <button
            key={m}
            className={`${styles.chip} ${mode === m ? styles.chipActive : ""}`}
            onClick={() => {
              setMode(m);
              if (m === "default") setOverride("background", "");
              else if (m === "solid") setOverride("background", toHex6(parsed.solid));
              else if (m === "gradient") applyGradient(toHex6(parsed.from), toHex6(parsed.to), parsed.angle);
            }}
          >
            {label}
          </button>
        ))}
        <span
          className={styles.bgSwatch}
          title="current background"
          style={{
            background:
              typeof overrides.background === "string" && overrides.background
                ? overrides.background
                : defaultBackground,
          }}
        />
      </div>

      {mode === "solid" && (
        <label className={styles.row}>
          <span>Colour</span>
          <span className={styles.inline}>
            <input
              type="color"
              value={toHex6(parsed.solid)}
              onChange={(e) => setOverride("background", e.target.value)}
            />
            <input
              className={`${styles.input} ${styles.hex}`}
              value={typeof overrides.background === "string" ? overrides.background : ""}
              onChange={(e) => setOverride("background", e.target.value)}
            />
            {"EyeDropper" in window && (
              <button
                className={styles.btnSmall}
                title="pick a colour from anywhere on screen (e.g. the capture)"
                onClick={async () => {
                  try {
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    const r = await new (window as any).EyeDropper().open();
                    setOverride("background", r.sRGBHex);
                  } catch {
                    // cancelled
                  }
                }}
              >
                ⧉
              </button>
            )}
          </span>
        </label>
      )}
      {mode === "gradient" && (
        <>
          <label className={styles.row}>
            <span>From / To</span>
            <span className={styles.inline}>
              <input
                type="color"
                value={toHex6(parsed.from)}
                onChange={(e) => applyGradient(e.target.value, toHex6(parsed.to), parsed.angle)}
              />
              <input
                type="color"
                value={toHex6(parsed.to)}
                onChange={(e) => applyGradient(toHex6(parsed.from), e.target.value, parsed.angle)}
              />
              <button
                className={styles.btnSmall}
                title="swap colours"
                onClick={() => applyGradient(toHex6(parsed.to), toHex6(parsed.from), parsed.angle)}
              >
                ⇄
              </button>
            </span>
          </label>
          <label className={styles.row}>
            <span>Angle</span>
            <span className={styles.inline}>
              <input
                type="range"
                min={0}
                max={360}
                step={5}
                value={((parsed.angle % 360) + 360) % 360}
                onChange={(e) => applyGradient(toHex6(parsed.from), toHex6(parsed.to), Number(e.target.value))}
                className={styles.range}
              />
              <span className={styles.muted}>{((parsed.angle % 360) + 360) % 360}°</span>
            </span>
          </label>
        </>
      )}
      {mode === "css" && (
        <label className={styles.row}>
          <span>CSS</span>
          <input
            className={styles.input}
            value={typeof overrides.background === "string" ? overrides.background : ""}
            onChange={(e) => setOverride("background", e.target.value)}
            placeholder="any CSS background value"
          />
        </label>
      )}

      <div className={styles.sectionSub}>Texture</div>
      <div className={styles.patternGrid}>
        <button
          className={`${styles.patternCell} ${!img ? styles.patternActive : ""}`}
          onClick={() => setOverride("backgroundImage", "")}
          title="no texture"
        >
          <span className={styles.patternNone}>none</span>
        </button>
        {PATTERN_KINDS.map((kind) => (
          <button
            key={kind}
            className={`${styles.patternCell} ${activePattern === kind ? styles.patternActive : ""}`}
            onClick={() => setOverride("backgroundImage", `pattern:${kind}`)}
            title={`pattern:${kind}`}
            style={{
              backgroundImage: patternDataUri(
                kind,
                "rgba(127,127,127,0.55)",
                kind === "waves" || kind === "zigzag" ? 28 : 14,
              ),
              backgroundSize: `${kind === "waves" || kind === "zigzag" ? 28 : 14}px auto`,
            }}
          />
        ))}
      </div>
      {activePattern && activePattern !== "noise" && (
        <>
          <label className={styles.row}>
            <span>Pattern colour</span>
            <span className={styles.inline}>
              <input
                type="color"
                value={toHex6(patternColor.startsWith("#") ? patternColor : "#000000")}
                onChange={(e) => setOverride("patternColor", e.target.value + "14")}
                title="picks a colour at low opacity; fine-tune in the text field"
              />
              <input
                className={`${styles.input} ${styles.hex}`}
                value={patternColor}
                onChange={(e) => setOverride("patternColor", e.target.value)}
              />
            </span>
          </label>
          <label className={styles.row}>
            <span>Pattern scale</span>
            <span className={styles.inline}>
              <input
                type="range"
                min={0.25}
                max={4}
                step={0.05}
                value={patternScale}
                onChange={(e) => setOverride("patternScale", Number(e.target.value))}
                className={styles.range}
              />
              <span className={styles.muted}>{patternScale.toFixed(2)}×</span>
            </span>
          </label>
        </>
      )}

      <div className={styles.sectionSub}>Image</div>
      <div className={styles.row}>
        <span>From assets</span>
        <span className={styles.inline}>
          <select
            className={styles.select}
            value={activeAsset ?? ""}
            onChange={(e) => setOverride("backgroundImage", e.target.value ? `asset:${e.target.value}` : "")}
          >
            <option value="">none</option>
            {assets.map((a) => (
              <option key={a.rel} value={a.rel}>
                {a.name} ({Math.round(a.bytes / 1024)} kB)
              </option>
            ))}
          </select>
          <button className={styles.btnSmall} disabled={uploading} onClick={() => fileRef.current?.click()}>
            {uploading ? "…" : "Upload"}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".png,.jpg,.jpeg,.webp,.svg"
            style={{ display: "none" }}
            onChange={(e) => e.target.files?.[0] && void upload(e.target.files[0])}
          />
        </span>
      </div>
      <p className={styles.small}>
        Images cover the whole artwork over the colour; files land in store/assets/backgrounds/.
      </p>
    </div>
  );
}
