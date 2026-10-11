import { paletteFrom, rgba, type Palette } from "./color";
import type { BackgroundValues } from "./schema";
import type { Orientation } from "./targets";

/**
 * Starter themes (docs/themes-plan.md): the choices that make a page look like a
 * finished listing, made up front. A theme is data: applying one writes
 * ordinary config and manifest values (lib/apply-theme.ts), so everything it
 * sets can be changed afterwards with the usual controls, and an app never
 * depends on the theme staying as it is. Every colour comes from one accent.
 * Pure data and functions, safe for client and server.
 */

export interface ThemeFont {
  family: string;
  weights: number[];
}

/** What a theme writes into config.brand. */
export interface ThemeBrand {
  primary: string;
  onPrimary: string;
  accent: string;
  background: BackgroundValues;
}

export interface ThemeScreenContext {
  palette: Palette;
  /** Position on the page, 0 = the first screen. */
  index: number;
  orientation: Orientation;
}

export interface ThemeScreen {
  template: string;
  overrides: Record<string, unknown>;
}

export interface Theme {
  id: string;
  name: string;
  description: string;
  /** Headline face; body text keeps the app's font (Inter for a new app). */
  headlineFont: ThemeFont;
  brand: (p: Palette) => ThemeBrand;
  /** Layout and background for the screen at a position on the page. */
  screen: (ctx: ThemeScreenContext) => ThemeScreen;
}

/** Positions that cycle: screen i takes item i mod length. */
const cycle = <T>(items: T[], i: number): T => items[i % items.length];

// Aurora: two soft glows in the accent and a turned hue, moving from screen to screen.
const GLOWS: [number, number, number, number][] = [
  [25, 15, 85, 95],
  [75, 20, 15, 90],
  [20, 25, 90, 85],
  [80, 15, 20, 80],
  [30, 80, 80, 20],
];

const aurora: Theme = {
  id: "aurora",
  name: "Aurora",
  description: "Near-black, with two soft glows in your colour that move from screen to screen",
  headlineFont: { family: "Poppins", weights: [600, 700] },
  brand: (p) => ({
    primary: p.night,
    onPrimary: "#FFFFFF",
    accent: p.accentLight,
    background: { background: p.night, backgroundImage: "none" },
  }),
  screen: ({ palette: p, index, orientation }) => {
    const [x1, y1, x2, y2] = cycle(GLOWS, index);
    return {
      template: "hero-top",
      overrides: {
        background:
          `radial-gradient(circle at ${x1}% ${y1}%, ${rgba(p.accent, 0.62)} 0%, ${rgba(p.night, 0)} 58%), ` +
          `radial-gradient(circle at ${x2}% ${y2}%, ${rgba(p.glow, 0.5)} 0%, ${rgba(p.night, 0)} 55%), ${p.night}`,
        backgroundImage: "none",
        textColor: "#FFFFFF",
        accentColor: p.accentLight,
        shell: "dark",
        ...(orientation === "portrait" ? { screenshotScale: 0.78 } : {}),
      },
    };
  },
};

// Bold: the accent as a solid fill, a heavy centred headline, the phone large and running off the bottom.
const bold: Theme = {
  id: "bold",
  name: "Bold",
  description: "Your colour as a solid fill, a heavy headline, and a big phone running off the bottom",
  headlineFont: { family: "Archivo", weights: [700, 800] },
  brand: (p) => ({
    primary: p.accent,
    onPrimary: p.onAccent,
    accent: p.onAccent,
    background: { background: p.accent, backgroundImage: "none" },
  }),
  screen: ({ palette: p, orientation }) => ({
    template: "hero-top",
    overrides: {
      background: `linear-gradient(180deg, ${p.accent} 0%, ${p.accent} 55%, ${p.accentDark} 140%)`,
      backgroundImage: "none",
      textColor: p.onAccent,
      accentColor: p.onAccent,
      textAlign: "center",
      shell: "dark",
      ...(orientation === "portrait" ? { screenshotScale: 0.92, screenshotOffsetY: 0.14 } : {}),
    },
  }),
};

// Paper: warm off-white with a faint grain, dark serif headlines aligned to the start.
const paper: Theme = {
  id: "paper",
  name: "Paper",
  description: "Warm off-white, dark serif headlines, your colour in the small type",
  headlineFont: { family: "Instrument Serif", weights: [400] },
  brand: (p) => ({
    primary: p.paper,
    onPrimary: p.ink,
    accent: p.accentDark,
    background: { background: p.paper, backgroundImage: "none" },
  }),
  screen: ({ palette: p, orientation }) => ({
    template: "hero-top",
    overrides: {
      background: `linear-gradient(180deg, ${p.paper} 0%, ${p.tint} 100%)`,
      backgroundImage: "none",
      textColor: p.ink,
      accentColor: p.accentDark,
      textAlign: "start",
      shell: "dark",
      ...(orientation === "portrait" ? { screenshotScale: 0.8 } : {}),
    },
  }),
};

// Swing: phones that alternate sides with a slight tilt, the text following them, on a gradient across the strip.
const swing: Theme = {
  id: "swing",
  name: "Swing",
  description: "Phones that swing left and right with a slight tilt, on one gradient that runs across the strip",
  headlineFont: { family: "Nunito", weights: [800, 900] },
  brand: (p) => ({
    primary: p.deep,
    onPrimary: "#FFFFFF",
    accent: p.accentLight,
    background: {
      background:
        `radial-gradient(ellipse 60% 70% at 30% 60%, ${rgba(p.accent, 0.45)} 0%, ${rgba(p.accent, 0)} 70%), ` +
        `radial-gradient(ellipse 60% 70% at 75% 40%, ${rgba(p.glow, 0.35)} 0%, ${rgba(p.glow, 0)} 70%), ` +
        `linear-gradient(90deg, ${p.deep} 0%, ${p.deeper} 50%, ${p.deep} 100%)`,
      backgroundImage: "none",
      span: true,
    },
  }),
  screen: ({ palette: p, index, orientation }) => {
    const side = index % 2 === 0 ? 1 : -1;
    const shift = orientation === "portrait" ? 0.1 : 0.12;
    return {
      template: "hero-top",
      overrides: {
        textColor: "#FFFFFF",
        accentColor: p.accentLight,
        textAlign: "center",
        screenshotOffsetX: side * shift,
        textOffsetX: side * shift * 0.6,
        deviceTilt: side * 4,
        shell: "dark",
        ...(orientation === "portrait" ? { screenshotScale: 0.74 } : { screenshotScale: 0.6 }),
      },
    };
  },
};

// Split: text and phone on opposite sides, the phone large and running off the bottom corner, alternating.
const split: Theme = {
  id: "split",
  name: "Split",
  description: "Text on one side, a big phone off the opposite corner, alternating, on a deep shade of your colour",
  headlineFont: { family: "Manrope", weights: [700, 800] },
  brand: (p) => ({
    primary: p.deep,
    onPrimary: "#FFFFFF",
    accent: p.accentLight,
    background: { background: `linear-gradient(160deg, ${p.deep} 0%, ${p.deeper} 100%)`, backgroundImage: "none" },
  }),
  screen: ({ palette: p, index, orientation }) => {
    const start = index % 2 === 0;
    // Toward the end side is positive: the phone goes the other way from the text.
    const away = start ? 1 : -1;
    return {
      template: "hero-top",
      overrides: {
        background: `linear-gradient(${start ? 160 : 200}deg, ${p.deep} 0%, ${p.deeper} 100%)`,
        backgroundImage: "none",
        textColor: "#FFFFFF",
        accentColor: p.accentLight,
        textSide: start ? "start" : "end",
        textAlign: start ? "start" : "end",
        shell: "dark",
        ...(orientation === "portrait"
          ? { screenshotScale: 0.8, screenshotOffsetX: away * 0.18, screenshotOffsetY: 0.06, deviceTilt: away * 7 }
          : { textWidth: 0.36 }),
      },
    };
  },
};

// Card: the capture fills the screen, the copy on a card in the accent, alternating top and bottom.
const card: Theme = {
  id: "card",
  name: "Card",
  description: "The capture fills the screen and the copy sits on a card in your colour; for games and photos",
  headlineFont: { family: "Space Grotesk", weights: [600, 700] },
  brand: (p) => ({
    primary: p.accent,
    onPrimary: p.onAccent,
    accent: p.onAccent,
    background: { background: p.deeper, backgroundImage: "none" },
  }),
  screen: ({ palette: p, index }) => ({
    template: "full-bleed-card",
    overrides: {
      background: p.deeper,
      backgroundImage: "none",
      cardColor: p.accent,
      cardPosition: index % 2 === 0 ? "bottom" : "top",
      textColor: p.onAccent,
    },
  }),
};

export const THEMES: Theme[] = [aurora, bold, paper, swing, split, card];

export function getTheme(id: string): Theme | undefined {
  return THEMES.find((t) => t.id === id);
}

export { paletteFrom };

/**
 * Copy a theme writes into new screens, to be replaced. Validation reports any
 * field still holding one of these, so a prompt cannot ship by mistake.
 */
export const STARTER_PROMPTS = {
  eyebrow: "WHAT IT IS",
  headline: "What does this screen let you do?",
  caption: "One line on why it matters.",
} as const;

export const STARTER_SCREEN_IDS = ["hero", "feature-1", "feature-2", "feature-3", "feature-4"] as const;

export function isStarterPrompt(value: unknown): boolean {
  return typeof value === "string" && (Object.values(STARTER_PROMPTS) as string[]).includes(value);
}
