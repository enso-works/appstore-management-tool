import type { CSSProperties, ReactElement } from "react";
import { z } from "zod";
import { BACKGROUND_IMAGE_RE } from "../lib/schema";
import { deviceFamilyOf, typeUnit } from "../lib/targets";
import { ARTWORK_ATTR, type TemplateRenderInput } from "./types";

const shellValueSchema = z.union([
  z.enum(["dark", "light", "none"]),
  z.string().regex(/^frame:.+/, 'use "frame:<device frame name>"'),
]);

/**
 * Overrides every template accepts. Semantic controls plus enough positional
 * freedom to recreate hand-made store art: the device can be scaled, nudged in
 * X/Y (fractions of the canvas width, so values carry across iPhone/iPad) and
 * tilted; the text block can be narrowed and anchored to either side.
 */
export const commonOverridesSchema = z.strictObject({
  /** CSS background colour/gradient; default derives from brand.primary. */
  background: z.string().min(1).optional(),
  /**
   * Background image layered over `background`: "asset:<path under store/assets>"
   * (e.g. "asset:backgrounds/waves.png", cover-fitted) or a built-in pattern:
   * "pattern:waves" | "pattern:dots" | "pattern:grid".
   */
  backgroundImage: z.string().regex(BACKGROUND_IMAGE_RE, 'use "asset:<path>", "pattern:<kind>" or "none"').optional(),
  /** Line colour for built-in patterns (any CSS colour; ignored by "noise"). */
  patternColor: z.string().min(1).optional(),
  /** Tile size multiplier for built-in patterns. */
  patternScale: z.number().min(0.25).max(4).optional(),
  /** Device width as a fraction of the canvas width. */
  screenshotScale: z.number().min(0.3).max(1.8).optional(),
  /** Horizontal nudge of the device, fraction of the target width (negative = towards the start side). Panoramas may go up to +-3. */
  screenshotOffsetX: z.number().min(-3).max(3).optional(),
  /** Vertical nudge of the device, fraction of canvas width (positive = down). */
  screenshotOffsetY: z.number().min(-1.2).max(1.2).optional(),
  /** Rotation in degrees. */
  deviceTilt: z.number().min(-30).max(30).optional(),
  /** Text column width as a fraction of the usable width (1 = full width). */
  textWidth: z.number().min(0.25).max(1).optional(),
  /** Which side the text column hugs when narrower than full width (logical: start = left in LTR). */
  textSide: z.enum(["start", "end"]).optional(),
  /** Horizontal nudge of the text block, fraction of the target width (mirrored in RTL). */
  textOffsetX: z.number().min(-1).max(1).optional(),
  /** Vertical nudge of the text block, fraction of canvas width (positive = down). */
  textOffsetY: z.number().min(-0.3).max(1).optional(),
  /** Panorama slide 2 text offsets (independent of slide 1). */
  textOffsetX2: z.number().min(-1).max(1).optional(),
  textOffsetY2: z.number().min(-0.3).max(1).optional(),
  /** Panorama slide 3 text offsets. */
  textOffsetX3: z.number().min(-1).max(1).optional(),
  textOffsetY3: z.number().min(-0.3).max(1).optional(),
  textAlign: z.enum(["start", "center", "end"]).optional(),
  /** Text colour override (any CSS colour); default brand.onPrimary. */
  textColor: z.string().min(1).optional(),
  /** Eyebrow and caption colour (any CSS colour); default brand.accent, else the text colour. */
  accentColor: z.string().min(1).optional(),
  /**
   * Neutral shell ("dark" | "light" | "none") or an official device frame:
   * "frame:<name>" (see `store-shots frames list`). Either one value for every
   * target, or a map keyed by target family ({ "iphone": ..., "ipad": ... })
   * when the same screen needs a different frame per device.
   */
  shell: z.union([shellValueSchema, z.record(z.string().min(1), shellValueSchema)]).optional(),
});

export type CommonOverrides = z.infer<typeof commonOverridesSchema>;

export const COMMON_OVERRIDE_KEYS = Object.keys(commonOverridesSchema.shape);

/** Darken a #rrggbb colour by a factor (0..1). */
export function darken(hex: string, factor: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const r = Math.round(((n >> 16) & 255) * (1 - factor));
  const g = Math.round(((n >> 8) & 255) * (1 - factor));
  const b = Math.round((n & 255) * (1 - factor));
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

/** #rgb / #rrggbb / #rrggbbaa -> rgba(r,g,b,alpha); other colour strings are returned unchanged. */
export function withAlpha(color: string, alpha: number): string {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(color.trim());
  if (!m) return color;
  let hex = m[1];
  if (hex.length === 3)
    hex = hex
      .split("")
      .map((c) => c + c)
      .join("");
  const n = parseInt(hex.slice(0, 6), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

export function defaultBackground(primary: string): string {
  return `linear-gradient(165deg, ${primary} 0%, ${darken(primary, 0.45)} 100%)`;
}

export const PATTERN_KINDS = [
  "waves",
  "dots",
  "grid",
  "lines",
  "zigzag",
  "rings",
  "crosses",
  "checker",
  "noise",
] as const;
export type PatternKind = (typeof PATTERN_KINDS)[number];

/** Built-in repeating patterns as SVG data URIs; `size` is the tile width in px. */
export function patternDataUri(kind: PatternKind, color: string, size: number): string {
  const c = encodeURIComponent(color);
  const sw = Math.max(1, Math.round(size * 0.02));
  let svg: string;
  const wrap = (inner: string, w = size, h = size) =>
    `<svg xmlns='http://www.w3.org/2000/svg' width='${w}' height='${h}' viewBox='0 0 ${w} ${h}'>${inner}</svg>`;
  if (kind === "waves") {
    const h = Math.round(size * 0.5);
    svg = wrap(
      `<path d='M0 ${h / 2} Q ${size / 4} 0 ${size / 2} ${h / 2} T ${size} ${h / 2}' fill='none' stroke='${c}' stroke-width='${sw}'/>`,
      size,
      h,
    );
  } else if (kind === "dots") {
    svg = wrap(`<circle cx='${size / 2}' cy='${size / 2}' r='${Math.max(1, size * 0.06)}' fill='${c}'/>`);
  } else if (kind === "grid") {
    svg = wrap(`<path d='M ${size} 0 L 0 0 0 ${size}' fill='none' stroke='${c}' stroke-width='${sw}'/>`);
  } else if (kind === "lines") {
    svg = wrap(
      `<path d='M0 ${size} L ${size} 0 M ${-size / 4} ${size / 4} L ${size / 4} ${-size / 4} M ${(size * 3) / 4} ${(size * 5) / 4} L ${(size * 5) / 4} ${(size * 3) / 4}' stroke='${c}' stroke-width='${sw}'/>`,
    );
  } else if (kind === "zigzag") {
    const h = Math.round(size * 0.4);
    svg = wrap(
      `<polyline points='0,${h * 0.75} ${size / 4},${h * 0.25} ${size / 2},${h * 0.75} ${(size * 3) / 4},${h * 0.25} ${size},${h * 0.75}' fill='none' stroke='${c}' stroke-width='${sw}'/>`,
      size,
      h,
    );
  } else if (kind === "rings") {
    svg = wrap(
      `<circle cx='${size / 2}' cy='${size / 2}' r='${size * 0.32}' fill='none' stroke='${c}' stroke-width='${sw}'/>`,
    );
  } else if (kind === "crosses") {
    const a = size * 0.18;
    svg = wrap(
      `<path d='M ${size / 2 - a} ${size / 2} H ${size / 2 + a} M ${size / 2} ${size / 2 - a} V ${size / 2 + a}' stroke='${c}' stroke-width='${sw}'/>`,
    );
  } else if (kind === "checker") {
    svg = wrap(
      `<rect x='0' y='0' width='${size / 2}' height='${size / 2}' fill='${c}'/><rect x='${size / 2}' y='${size / 2}' width='${size / 2}' height='${size / 2}' fill='${c}'/>`,
    );
  } else {
    // noise: deterministic fractal grain; patternColor is ignored (alpha comes from the matrix).
    svg = wrap(
      `<filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch' seed='7'/><feColorMatrix type='matrix' values='0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 0.35 0'/></filter><rect width='${size}' height='${size}' filter='url(#n)'/>`,
    );
  }
  return `url("data:image/svg+xml;utf8,${svg.replace(/#/g, "%23")}")`;
}

/**
 * Resolve the background layers: per-screen override wins, then the project
 * default (brand.background), then the brand gradient. backgroundImage "none"
 * cancels an inherited texture for one screen.
 */
export function backgroundCss(input: TemplateRenderInput<CommonOverrides>): string {
  const { overrides, brand, target } = input;
  const inherit = brand.backgroundDefaults ?? {};
  const base = overrides.background ?? inherit.background ?? defaultBackground(brand.primary);
  const imgRaw = overrides.backgroundImage ?? inherit.backgroundImage;
  const img = imgRaw === "none" ? undefined : imgRaw;
  if (!img) return base;
  if (img.startsWith("asset:")) {
    return `url("${input.assetUrl(img.slice("asset:".length))}") center / cover no-repeat, ${base}`;
  }
  const kind = img.slice("pattern:".length) as PatternKind;
  const color = overrides.patternColor ?? inherit.patternColor ?? "rgba(0,0,0,0.08)";
  const mult = overrides.patternScale ?? inherit.patternScale ?? 1;
  const tile = Math.max(8, Math.round(target.width * (kind === "waves" || kind === "zigzag" ? 0.12 : 0.05) * mult));
  return `${patternDataUri(kind, color, tile)} 0 0 / ${tile}px auto repeat, ${base}`;
}

/** Split a CSS background value into its top-level comma-separated layers. */
function cssLayers(value: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of value) {
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      out.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/**
 * Background as style props. Normally the `background` shorthand from
 * `backgroundCss`; when the project default has `span` and this screen
 * inherits it, every layer is stretched to the full strip width and shifted
 * so consecutive screens form one seamless background.
 */
export function backgroundStyle(input: TemplateRenderInput<CommonOverrides>): CSSProperties {
  const { overrides, brand } = input;
  const inherit = brand.backgroundDefaults ?? {};
  const strip = input.strip;
  const span =
    inherit.span === true &&
    strip !== undefined &&
    strip.width > input.canvasWidth &&
    overrides.background === undefined &&
    overrides.backgroundImage === undefined;
  if (!span) return { background: backgroundCss(input) };
  const off = strip.offsetX;
  const base = inherit.background ?? defaultBackground(brand.primary);
  const img = inherit.backgroundImage === "none" ? undefined : inherit.backgroundImage;
  const images: string[] = [];
  const sizes: string[] = [];
  const positions: string[] = [];
  const repeats: string[] = [];
  if (img?.startsWith("asset:")) {
    images.push(`url("${input.assetUrl(img.slice("asset:".length))}")`);
    sizes.push(`${strip.width}px 100%`);
    positions.push(`${-off}px 0`);
    repeats.push("no-repeat");
  } else if (img?.startsWith("pattern:")) {
    const kind = img.slice("pattern:".length) as PatternKind;
    const color = inherit.patternColor ?? "rgba(0,0,0,0.08)";
    const mult = inherit.patternScale ?? 1;
    const tile = Math.max(
      8,
      Math.round(input.target.width * (kind === "waves" || kind === "zigzag" ? 0.12 : 0.05) * mult),
    );
    // Patterns keep their tile size; shifting the phase by the strip offset keeps rows continuous across screens.
    images.push(patternDataUri(kind, color, tile));
    sizes.push(`${tile}px auto`);
    positions.push(`${-off}px 0`);
    repeats.push("repeat");
  }
  let color: string | undefined;
  for (const layer of cssLayers(base)) {
    if (layer.includes("(")) {
      images.push(layer);
      sizes.push(`${strip.width}px 100%`);
      positions.push(`${-off}px 0`);
      repeats.push("no-repeat");
    } else {
      color = layer;
    }
  }
  return {
    backgroundColor: color,
    backgroundImage: images.length ? images.join(", ") : undefined,
    backgroundSize: sizes.length ? sizes.join(", ") : undefined,
    backgroundPosition: positions.length ? positions.join(", ") : undefined,
    backgroundRepeat: repeats.length ? repeats.join(", ") : undefined,
  };
}

/** Extra image/text elements over the template (data-layer for selection/drag). */
export function LayerElements({ input }: { input: TemplateRenderInput<CommonOverrides> }): ReactElement | null {
  const layers = input.layers;
  if (!layers || layers.length === 0) return null;
  const W = input.target.width;
  return (
    <>
      {layers.map((layer) => {
        const common: CSSProperties = {
          position: "absolute",
          left: Math.round(W * layer.x),
          top: Math.round(W * layer.y),
          width: Math.round(W * layer.width),
          transform: `translate(-50%, -50%)${layer.rotate ? ` rotate(${layer.rotate}deg)` : ""}`,
          transformOrigin: "50% 50%",
          opacity: layer.opacity ?? 1,
        };
        if (layer.type === "image") {
          return (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={layer.id}
              src={layer.url}
              alt=""
              data-layer={layer.id}
              style={{ ...common, height: "auto", display: "block" }}
            />
          );
        }
        if (!layer.text) return null;
        return (
          <div
            key={layer.id}
            data-layer={layer.id}
            style={{
              ...common,
              fontSize: Math.round(W * layer.size),
              lineHeight: 1.2,
              fontWeight: layer.weight,
              color: layer.color ?? "inherit",
              textAlign: layer.align,
              fontFamily: layer.font === "headline" ? input.brand.headlineFontStack : undefined,
              overflowWrap: "break-word",
            }}
          >
            {layer.text}
          </div>
        );
      })}
    </>
  );
}

/** Root artwork element: exact canvas size, clips everything, sets font and direction. */
export function Artwork({
  input,
  children,
  style,
}: {
  input: TemplateRenderInput<CommonOverrides>;
  children: React.ReactNode;
  style?: CSSProperties;
}): ReactElement {
  const { target, brand, direction } = input;
  return (
    <div
      {...{ [ARTWORK_ATTR]: "" }}
      dir={direction}
      style={{
        position: "relative",
        width: input.canvasWidth,
        height: target.height,
        overflow: "hidden",
        ...backgroundStyle(input),
        color: input.overrides.textColor ?? brand.onPrimary,
        fontFamily: brand.fontStack,
        direction,
        boxSizing: "border-box",
        ...style,
      }}
    >
      {children}
      <LayerElements input={input} />
    </div>
  );
}

export interface DeviceShellProps {
  input: TemplateRenderInput<CommonOverrides>;
  /** Device width in px. */
  width: number;
  /** Device height in px (usually width / target aspect). */
  height: number;
  /** Absolute position inside the artwork (before tilt). */
  left: number;
  top: number;
}

/**
 * Device shell (plan §10.3). `width` x `height` is the display, so the capture
 * keeps its own aspect: the body is drawn around it. iPhones get the titanium
 * band, glass border, Dynamic Island and side buttons of an iPhone 16 Pro;
 * iPads and other phones the band and their buttons. "none" is the display
 * alone. The capture is cover-fitted, anchored to the top. Tilt rotates around
 * the device centre.
 */
export function DeviceShell({ input, width, height, left, top }: DeviceShellProps): ReactElement {
  const frame = input.frame;
  if (frame) {
    // Official frameit artwork: scale so the frame's screen cut-out width equals
    // the requested device width; the capture sits exactly in the cut-out.
    const s = width / frame.screenWidth;
    const tilt = input.overrides.deviceTilt ?? 0;
    // With a measured cut-out height the capture is cover-cropped to exactly
    // the cut-out, so a capture of a different aspect never spills past the
    // bezel or leaves a gap; without it (offsets.json fallback) the capture's
    // own height is trusted, as before.
    const screenH = frame.screenHeight ? frame.screenHeight * s : height;
    return (
      <div
        data-device=""
        style={{
          position: "absolute",
          left: left - frame.screenX * s,
          top: top - frame.screenY * s,
          width: frame.frameWidth * s,
          height: frame.frameHeight * s,
          transform: tilt ? `rotate(${tilt}deg)` : undefined,
          transformOrigin: "50% 50%",
        }}
      >
        <div
          style={{
            position: "absolute",
            left: frame.screenX * s,
            top: frame.screenY * s,
            width,
            height: screenH,
            overflow: "hidden",
            borderRadius: frame.screenRadius ? frame.screenRadius * s : undefined,
          }}
        >
          <ShellScreen input={input} />
        </div>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={frame.url}
          alt=""
          style={{ position: "absolute", left: 0, top: 0, width: "100%", height: "100%", pointerEvents: "none" }}
        />
      </div>
    );
  }
  const shell = input.overrides.shell === "light" || input.overrides.shell === "none" ? input.overrides.shell : "dark";
  const tilt = input.overrides.deviceTilt ?? 0;
  const landscape = width > height;
  // Proportions follow the display's short side, so a landscape device keeps a real one's look.
  const short = Math.min(width, height);
  const family = deviceFamilyOf(input.target);
  const iphone = family === "iphone";
  const tablet = family === "ipad" || family === "tablet";
  // Titanium band, then the black glass border around the display.
  const rim = Math.max(2, Math.round(short * (tablet ? 0.006 : 0.011)));
  const glass = Math.round(short * (tablet ? 0.022 : 0.021));
  const edge = shell === "none" ? 0 : rim + glass;
  // Outer corner radius: iPhone 16 Pro's corners are about 15% of its width, an iPad Pro's about 5.5%.
  const radius = Math.round((short + 2 * edge) * (tablet ? 0.055 : iphone ? 0.15 : 0.12));
  if (shell === "none") {
    return (
      <div
        data-device=""
        style={{
          position: "absolute",
          left,
          top,
          width,
          height,
          borderRadius: radius,
          overflow: "hidden",
          background: "#000",
          transform: tilt ? `rotate(${tilt}deg)` : undefined,
          transformOrigin: "50% 50%",
        }}
      >
        <ShellScreen input={input} />
      </div>
    );
  }
  const metal = shell === "light" ? LIGHT_TITANIUM : DARK_TITANIUM;
  const screenRadius = Math.max(0, radius - edge);
  const buttons = iphone ? IPHONE_BUTTONS : tablet ? IPAD_BUTTONS : PHONE_BUTTONS;
  // Buttons stand proud of the band by about its own thickness.
  const proud = Math.max(2, Math.round(rim * 0.9));
  const long = Math.max(width, height) + 2 * edge;
  // App Preview posters are video frames, not a device.
  const island = iphone && !input.target.id.startsWith("appreview-");
  const buttonEls = buttons.map((b) => {
    // Positions are given for the portrait device (side, centre along the long edge, length);
    // a landscape device is the portrait one turned a quarter anticlockwise.
    const along = Math.round(long * b.at);
    const length = Math.round(long * b.length);
    const portraitLeft = b.side === "left";
    const style: CSSProperties = landscape
      ? {
          left: along - length / 2,
          width: length,
          height: proud + rim,
          ...(portraitLeft ? { bottom: -proud } : { top: -proud }),
        }
      : {
          top: along - length / 2,
          height: length,
          width: proud + rim,
          ...(portraitLeft ? { left: -proud } : { right: -proud }),
        };
    return (
      <div
        key={b.name}
        data-button={b.name}
        style={{
          position: "absolute",
          borderRadius: proud,
          background: landscape ? metal.buttonH : metal.buttonV,
          boxShadow: "0 1px 2px rgba(0,0,0,0.35)",
          ...style,
        }}
      />
    );
  });
  return (
    <div
      data-device=""
      style={{
        position: "absolute",
        left: left - edge,
        top: top - edge,
        width: width + 2 * edge,
        height: height + 2 * edge,
        transform: tilt ? `rotate(${tilt}deg)` : undefined,
        transformOrigin: "50% 50%",
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: 0,
          borderRadius: radius,
          padding: rim,
          boxSizing: "border-box",
          background: metal.band,
          boxShadow: [
            `0 ${Math.round(short * 0.05)}px ${Math.round(short * 0.12)}px rgba(0,0,0,0.38)`,
            `0 ${Math.round(short * 0.012)}px ${Math.round(short * 0.025)}px rgba(0,0,0,0.3)`,
          ].join(", "),
        }}
      >
        <div
          style={{
            width: "100%",
            height: "100%",
            borderRadius: radius - rim,
            padding: glass,
            boxSizing: "border-box",
            background: "#050506",
            // The glass edge catches a little light.
            boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.08)",
          }}
        >
          <div
            style={{
              position: "relative",
              width: "100%",
              height: "100%",
              borderRadius: screenRadius,
              overflow: "hidden",
              background: "#000",
            }}
          >
            <ShellScreen input={input} />
            {island && <DynamicIsland short={short} landscape={landscape} />}
            <div
              style={{
                position: "absolute",
                inset: 0,
                pointerEvents: "none",
                background:
                  "linear-gradient(125deg, rgba(255,255,255,0.07) 0%, rgba(255,255,255,0.02) 32%, rgba(255,255,255,0) 33%)",
              }}
            />
          </div>
        </div>
      </div>
      {/* After the band, so its drop shadow does not darken them. */}
      {buttonEls}
    </div>
  );
}

function ShellScreen({ input }: { input: TemplateRenderInput<CommonOverrides> }): ReactElement {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={input.sourceImageUrl}
      alt=""
      data-source=""
      style={{ display: "block", width: "100%", height: "100%", objectFit: "cover", objectPosition: "top center" }}
    />
  );
}

/** The Dynamic Island: 126 x 37 pt, 11 pt from the top of a 402 pt wide display; on the left in landscape. */
function DynamicIsland({ short, landscape }: { short: number; landscape: boolean }): ReactElement {
  const length = Math.round(short * 0.313);
  const thickness = Math.round(short * 0.092);
  const inset = Math.round(short * 0.027);
  return (
    <div
      data-island=""
      style={{
        position: "absolute",
        borderRadius: thickness,
        background: "#000",
        ...(landscape
          ? { left: inset, top: "50%", width: thickness, height: length, marginTop: -length / 2 }
          : { top: inset, left: "50%", width: length, height: thickness, marginLeft: -length / 2 }),
      }}
    />
  );
}

interface ShellButton {
  name: string;
  /** Edge of the portrait device. */
  side: "left" | "right";
  /** Centre along the long edge, as a fraction of it, from the top. */
  at: number;
  length: number;
}

/** iPhone 16 Pro: Action button and volume on the left, side button and Camera Control on the right. */
const IPHONE_BUTTONS: ShellButton[] = [
  { name: "action", side: "left", at: 0.185, length: 0.045 },
  { name: "volume-up", side: "left", at: 0.265, length: 0.075 },
  { name: "volume-down", side: "left", at: 0.355, length: 0.075 },
  { name: "side", side: "right", at: 0.29, length: 0.11 },
  { name: "camera-control", side: "right", at: 0.55, length: 0.07 },
];

/** A generic Android phone: volume and power on the right. */
const PHONE_BUTTONS: ShellButton[] = [
  { name: "volume", side: "right", at: 0.3, length: 0.12 },
  { name: "power", side: "right", at: 0.46, length: 0.06 },
];

/** iPad Pro: top button (on the short edge, drawn here on the right near the top) and volume. */
const IPAD_BUTTONS: ShellButton[] = [
  { name: "volume-up", side: "right", at: 0.1, length: 0.04 },
  { name: "volume-down", side: "right", at: 0.16, length: 0.04 },
];

const DARK_TITANIUM = {
  band: "linear-gradient(135deg, #5b5d62 0%, #2a2b2f 18%, #45474c 42%, #1d1e21 64%, #4c4e53 86%, #2b2c30 100%)",
  buttonV: "linear-gradient(90deg, #2a2b2f 0%, #6a6c71 45%, #2a2b2f 100%)",
  buttonH: "linear-gradient(180deg, #2a2b2f 0%, #6a6c71 45%, #2a2b2f 100%)",
};

const LIGHT_TITANIUM = {
  band: "linear-gradient(135deg, #f4f2ee 0%, #c9c6c0 20%, #ebe8e2 44%, #b7b3ac 66%, #e6e3dd 88%, #c4c0b9 100%)",
  buttonV: "linear-gradient(90deg, #b9b5ae 0%, #f3f1ed 45%, #b9b5ae 100%)",
  buttonH: "linear-gradient(180deg, #b9b5ae 0%, #f3f1ed 45%, #b9b5ae 100%)",
};

/**
 * Text container that the in-page checker validates: fixed max height, no
 * visible overflow. `maxLines` x line-height defines the box.
 */
export function TextBlock({
  id,
  text,
  fontSize,
  lineHeight,
  maxLines,
  weight,
  style,
  align,
  fitMinScale = 1,
  fontFamily,
}: {
  id: string;
  text: string | null | undefined;
  fontSize: number;
  lineHeight: number;
  maxLines: number;
  weight: number;
  style?: CSSProperties;
  align: "start" | "center" | "end";
  /**
   * Lowest font-size scale the in-page fitter may shrink to (plan §12.2:
   * "only within a template-defined range"). 1 = no shrinking allowed.
   */
  fitMinScale?: number;
  /** Font stack for this block (headline font); inherits the artwork stack when omitted. */
  fontFamily?: string;
}): ReactElement | null {
  if (!text) return null;
  const lh = Math.round(fontSize * lineHeight);
  return (
    <div
      {...{
        "data-check": id,
        "data-line-height": lh,
        "data-max-lines": maxLines,
        "data-font-size": fontSize,
        "data-line-ratio": lineHeight,
        "data-fit-min": fitMinScale,
      }}
      style={{
        fontSize,
        lineHeight: `${lh}px`,
        fontWeight: weight,
        maxHeight: lh * maxLines,
        overflow: "hidden",
        textAlign: align,
        overflowWrap: "break-word",
        fontFamily,
        ...style,
      }}
    >
      {text}
    </div>
  );
}

/** Colour for secondary text (eyebrow, caption); undefined inherits the text colour. */
export function accentOf(input: TemplateRenderInput<CommonOverrides>): string | undefined {
  return input.overrides.accentColor ?? input.brand.accent;
}

export function textAlignOf(
  input: TemplateRenderInput<CommonOverrides>,
  fallback: "start" | "center" | "end" = "center",
) {
  return input.overrides.textAlign ?? fallback;
}

/**
 * Shared layout maths for "text block + device" templates. Returns absolute
 * boxes (px) for the text column and the device, honouring every positional
 * override. Templates pass their defaults; overrides win.
 */
export interface StackLayoutDefaults {
  textWidth: number;
  textSide: "start" | "end";
  scale: number;
  /** Gap below the text block before the device in the stacked layout (fraction of W). */
  gap: number;
  /** In the side layout: device left edge as a fraction of W (mirrored for textSide end / RTL). */
  sideDeviceLeft: number;
}

export interface StackLayout {
  pad: number;
  text: { left: number; top: number; width: number; height: number };
  device: { left: number; top: number; width: number; height: number };
  /** True when the text column is narrower than full width (device sits beside it). */
  narrow: boolean;
}

export function stackLayout(
  input: TemplateRenderInput<CommonOverrides>,
  textHeight: number,
  defaults: StackLayoutDefaults,
): StackLayout {
  const { target, overrides, direction } = input;
  const W = target.width;
  const U = typeUnit(target); // == W in portrait; the short side in landscape
  const CW = input.canvasWidth; // full artwork width (== W unless panorama)
  const pad = Math.round(U * 0.07);
  const usable = CW - 2 * pad;
  const textWidth = overrides.textWidth ?? defaults.textWidth;
  const narrow = textWidth < 0.999;
  const textW = Math.round(usable * textWidth);
  const side = overrides.textSide ?? defaults.textSide;
  const hugsLeft = (side === "start") !== (direction === "rtl"); // visual left
  const textLeft =
    (hugsLeft ? pad : CW - pad - textW) + Math.round(W * (overrides.textOffsetX ?? 0) * (direction === "rtl" ? -1 : 1));
  // The device anchors to the DEFAULT text position, not the offset one:
  // dragging the text must never move the phone (and vice versa).
  const baseTextTop = Math.round(U * (target.orientation === "landscape" ? 0.06 : 0.09));
  const textTop = baseTextTop + Math.round(W * (overrides.textOffsetY ?? 0));

  // Phone shells keep a phone aspect even on a 9:16 Play canvas; tablets and landscape sets use the canvas aspect.
  // Event media show the app's own iPhone capture, whichever way round the app runs.
  const devAspect =
    target.family === "event"
      ? (input.sourceAspect ?? 1320 / 2868)
      : target.family === "ipad" || target.family === "tablet" || target.orientation === "landscape"
        ? target.width / target.height
        : 1320 / 2868;
  const landscape = target.orientation === "landscape";
  const stackedTop = baseTextTop + textHeight + Math.round(U * defaults.gap);
  // Landscape: by default the whole device fits on the canvas (a sideways
  // screen cut off loses the game), at most defaults.scale wide: under the
  // text, or beside a side column in the space the column leaves.
  const sideGap = Math.round(U * 0.04);
  const sideW = W - 2 * pad - textW - sideGap;
  const sideH = target.height - baseTextTop - pad;
  const fitW = narrow ? Math.min(sideW, sideH * devAspect) : (target.height - stackedTop - pad) * devAspect;
  const fitScale = landscape ? Math.max(0.3, Math.min(defaults.scale, fitW / W)) : defaults.scale;
  const scale = overrides.screenshotScale ?? fitScale;
  const devW = Math.round(W * scale);
  const devH = Math.round(devW / devAspect);
  let devLeft: number;
  let devTop: number;
  if (narrow && landscape) {
    // Centred in the space beside the text column.
    const sideLeft = hugsLeft ? pad + textW + sideGap : CW - W + pad;
    devLeft = Math.round(sideLeft + (sideW - devW) / 2);
    devTop = Math.round(baseTextTop + (sideH - devH) / 2);
  } else if (narrow) {
    devLeft = hugsLeft ? Math.round(W * defaults.sideDeviceLeft) : Math.round(CW - W * defaults.sideDeviceLeft - devW);
    devTop = baseTextTop;
  } else {
    devLeft = Math.round((CW - devW) / 2);
    devTop = stackedTop;
  }
  devLeft += Math.round(W * (overrides.screenshotOffsetX ?? 0) * (direction === "rtl" ? -1 : 1));
  devTop += Math.round(W * (overrides.screenshotOffsetY ?? 0));
  return {
    pad,
    text: { left: textLeft, top: textTop, width: textW, height: textHeight },
    device: { left: devLeft, top: devTop, width: devW, height: devH },
    narrow,
  };
}
