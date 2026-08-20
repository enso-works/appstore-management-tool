"use client";

import { useEffect, useRef, useState } from "react";
import {
  hexToHsva,
  hslaStringToHsva,
  hsvaToHex,
  hsvaToHexa,
  rgbaStringToHsva,
  Sketch,
  validHex,
  type HsvaColor,
} from "@uiw/react-color";
import styles from "./editor.module.css";

interface Props {
  /** Current CSS colour; "" means "inherit the default". */
  value: string;
  onChange: (v: string) => void;
  /** Placeholder for the empty state (default "default"). */
  placeholder?: string;
  /** Colour the swatch shows while value is empty (the effective default), if known. */
  fallback?: string;
  /** Quick-pick swatches under the picker (e.g. brand colours). */
  presets?: string[];
}

function toHsva(value: string): HsvaColor | undefined {
  const v = value.trim();
  try {
    if (v.startsWith("#") && validHex(v)) return hexToHsva(v);
    if (v.startsWith("rgb")) return rgbaStringToHsva(v);
    if (v.startsWith("hsl")) return hslaStringToHsva(v);
  } catch {
    // fall through: not a parseable colour (gradient, keyword, ...)
  }
  return undefined;
}

/**
 * Colour override input: swatch + free text + a proper picker (@uiw/react-color
 * Sketch) in a popover. The text input still takes any CSS colour; the picker
 * writes hex / hexa. Clearing the text returns to "inherit".
 */
export default function ColorField({ value, onChange, placeholder = "default", fallback, presets }: Props) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number }>({ left: 0, top: 0 });
  const rootRef = useRef<HTMLSpanElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const swatchRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      const t = e.target as Node;
      if (rootRef.current?.contains(t) || popRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const hsva = toHsva(value) ?? (fallback ? toHsva(fallback) : undefined);

  return (
    <span ref={rootRef} className={styles.colorField}>
      <button
        ref={swatchRef}
        type="button"
        className={styles.colorSwatch}
        title={value || `${placeholder} - click to pick`}
        onClick={() => {
          const r = swatchRef.current?.getBoundingClientRect();
          if (r) {
            const left = Math.max(8, Math.min(window.innerWidth - 228, r.left - 190));
            const top = Math.min(window.innerHeight - 320, r.bottom + 6);
            setPos({ left, top });
          }
          setOpen((v) => !v);
        }}
      >
        <span className={styles.colorSwatchFill} style={{ background: value || fallback || "transparent" }} />
      </button>
      <input
        className={`${styles.input} ${styles.hex}`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        spellCheck={false}
      />
      {value && (
        <button type="button" className={styles.btnSmall} title="reset to default" onClick={() => onChange("")}>
          {"×"}
        </button>
      )}
      {open && (
        <div ref={popRef} className={styles.colorPop} style={{ left: pos.left, top: pos.top }}>
          <Sketch
            color={hsva}
            presetColors={presets}
            disableAlpha={false}
            onChange={(c) => onChange(c.hsva.a < 1 ? hsvaToHexa(c.hsva) : hsvaToHex(c.hsva))}
          />
        </div>
      )}
    </span>
  );
}
