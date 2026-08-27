/**
 * Render one example per template into `public/template-previews/<id>.jpg` for
 * the in-app catalogue at /templates. Run with `npm run previews` and commit the
 * result: the page must open instantly and must not depend on a project having
 * captures.
 *
 * Everything is deterministic — the demo app screens below are drawn from a
 * fixed SVG, and the artwork goes through the same renderer the export uses — so
 * re-running produces the same files unless a template actually changed.
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import sharp from "sharp";
import { templateModules } from "../templates";
import type { BrandTheme, TemplateRenderInput } from "../templates/types";
import { baseCss } from "../lib/render/html";
import { ExportRenderer } from "../lib/render/export";
import { renderStatic } from "../lib/render/ssr";
import { targetProfiles } from "../lib/targets";

const OUT = path.resolve(import.meta.dirname, "..", "public", "template-previews");
const WORK = path.resolve(import.meta.dirname, "..", ".next", "cache", "template-previews");
/** Thumbnail width per screenshot; a 3-slice strip is three times this. */
const THUMB = 420;

const BRAND: BrandTheme = {
  fontFamily: "Helvetica Neue",
  fontStack: '"Helvetica Neue", Helvetica, Arial, sans-serif',
  headlineFontStack: '"Helvetica Neue", Helvetica, Arial, sans-serif',
  primary: "#5B4BF0",
  onPrimary: "#ffffff",
};

const DEEP = "linear-gradient(165deg,#5B4BF0 0%,#231C6B 100%)";
const NIGHT = "#0F0D1A";
const SAND = "#F4F0E7";

// ---- the demo app whose screens appear inside the device shells ------------

const W = 1320;
const H = 2868;

function card(y: number, title: string, sub: string, hue: number, done: boolean): string {
  return `
  <rect x="70" y="${y}" width="${W - 140}" height="200" rx="44" fill="#fff" stroke="#e8eaf0" stroke-width="3"/>
  <rect x="110" y="${y + 50}" width="100" height="100" rx="34" fill="hsl(${hue} 85% 94%)"/>
  <circle cx="160" cy="${y + 100}" r="26" fill="hsl(${hue} 75% 58%)"/>
  <text x="248" y="${y + 88}" font-family="Helvetica" font-size="46" font-weight="600" fill="#15171c">${title}</text>
  <text x="248" y="${y + 142}" font-family="Helvetica" font-size="36" fill="#7b8194">${sub}</text>
  <circle cx="${W - 140}" cy="${y + 100}" r="30" fill="${done ? "#2ecc71" : "none"}" stroke="${done ? "#2ecc71" : "#d3d7e0"}" stroke-width="5"/>`;
}

function screen(title: string, sub: string, body: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs><linearGradient id="hdr" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5b4bf0"/><stop offset="1" stop-color="#7c5cf5"/></linearGradient></defs>
  <rect width="${W}" height="${H}" fill="#f5f6fa"/>
  <path d="M0 0 H${W} V560 Q${W / 2} 700 0 560 Z" fill="url(#hdr)"/>
  <text x="90" y="120" font-family="Helvetica" font-size="40" font-weight="600" fill="#fff">9:41</text>
  <rect x="${W - 210}" y="86" width="120" height="44" rx="14" fill="#fff" opacity="0.9"/>
  <text x="90" y="300" font-family="Helvetica" font-size="86" font-weight="700" fill="#fff">${title}</text>
  <text x="90" y="366" font-family="Helvetica" font-size="42" fill="#fff" opacity="0.82">${sub}</text>
  ${body}
  <rect x="0" y="2560" width="${W}" height="308" fill="#fff"/>
  <line x1="0" y1="2560" x2="${W}" y2="2560" stroke="#e8eaf0" stroke-width="3"/>
</svg>`;
}

const SCREENS = [
  screen(
    "Today",
    "Thursday, 27 August",
    `<text x="90" y="720" font-family="Helvetica" font-size="44" font-weight="700" fill="#15171c">This morning</text>
     ${card(780, "Morning review", "8:30 - Focus", 262, true)}${card(1010, "Team standup", "9:30 - Zoom", 200, false)}
     <text x="90" y="1360" font-family="Helvetica" font-size="44" font-weight="700" fill="#15171c">Later</text>
     ${card(1420, "Draft the proposal", "Due 17:00", 32, false)}${card(1650, "Call the studio", "18:15", 340, false)}
     <circle cx="${W - 170}" cy="2380" r="96" fill="#5b4bf0"/><path d="M ${W - 170} 2334 v92 M ${W - 216} 2380 h92" stroke="#fff" stroke-width="12" stroke-linecap="round"/>`,
  ),
  screen(
    "This week",
    "24 - 30 August",
    `${[0, 1, 2, 3, 4, 5, 6]
      .map((i) => {
        const x = 70 + i * 168;
        const on = i === 3;
        return `<rect x="${x}" y="640" width="150" height="200" rx="40" fill="${on ? "#5b4bf0" : "#ffffff"}" stroke="#e8eaf0" stroke-width="3"/>
      <text x="${x + 75}" y="710" text-anchor="middle" font-family="Helvetica" font-size="34" fill="${on ? "#ffffff" : "#7b8194"}">${["M", "T", "W", "T", "F", "S", "S"][i]}</text>
      <text x="${x + 75}" y="790" text-anchor="middle" font-family="Helvetica" font-size="54" font-weight="700" fill="${on ? "#ffffff" : "#15171c"}">${24 + i}</text>`;
      })
      .join("")}
     <text x="90" y="960" font-family="Helvetica" font-size="44" font-weight="700" fill="#15171c">Thursday</text>
     ${card(1020, "Design review", "10:00 - Studio", 262, false)}${card(1250, "Lunch with Sam", "12:30", 32, false)}
     ${card(1480, "Ship the update", "16:00", 150, true)}${card(1710, "Gym", "19:00", 200, false)}`,
  ),
  screen(
    "Progress",
    "August at a glance",
    `<rect x="70" y="640" width="${W - 140}" height="620" rx="52" fill="#fff" stroke="#e8eaf0" stroke-width="3"/>
     <text x="130" y="740" font-family="Helvetica" font-size="42" font-weight="600" fill="#15171c">Tasks finished</text>
     <text x="130" y="850" font-family="Helvetica" font-size="110" font-weight="700" fill="#5b4bf0">128</text>
     ${[40, 70, 55, 95, 120, 80, 140].map((h, i) => `<rect x="${150 + i * 140}" y="${1180 - h * 2.6}" width="86" height="${h * 2.6}" rx="26" fill="${i === 6 ? "#5b4bf0" : "#d9d5fb"}"/>`).join("")}
     <text x="90" y="1400" font-family="Helvetica" font-size="44" font-weight="700" fill="#15171c">Streak</text>
     ${card(1460, "12 days in a row", "Best: 21 days", 32, true)}${card(1690, "Weekly review done", "Sunday", 150, true)}`,
  ),
];

// ---- one example per template ---------------------------------------------

interface Example {
  fields: Record<string, string>;
  overrides?: Record<string, unknown>;
  slices?: number;
  targetId?: keyof typeof targetProfiles;
}

const EXAMPLES: Record<string, Example> = {
  "hero-top": {
    fields: {
      eyebrow: "A calmer day",
      headline: "Plan everything in one place",
      caption: "Tasks, reminders and notes that stay in sync.",
    },
    overrides: { background: DEEP },
  },
  spotlight: {
    fields: {
      headline: "Your day, ready when you are",
      caption: "Nothing to set up.",
      chip1: "Offline first",
      chip2: "No account",
      chip3: "2 taps",
    },
    overrides: { background: "linear-gradient(180deg,#1B1140 0%,#4B3AD8 100%)", halo: true, glowColor: "#9C8CFF" },
  },
  "zoom-detail": {
    fields: { eyebrow: "Made for focus", headline: "Tick it off in one tap", caption: "Every task is one tap away." },
    overrides: { background: "#1B1140", locator: true },
  },
  statement: {
    fields: {
      index: "03",
      eyebrow: "Why it works",
      headline: "One clear next step. Always.",
      caption: "No setup, no clutter, no streaks to protect.",
    },
    overrides: {
      background: SAND,
      textColor: "#171514",
      accentColor: "#D9542B",
      decor: "blob",
      decorPlacement: "top-end",
      decorOpacity: 0.16,
    },
  },
  "stat-hero": {
    fields: {
      eyebrow: "Loved by planners",
      headline: "The app people actually keep",
      stat: "4.9",
      statLabel: "App Store rating",
    },
    overrides: { background: DEEP },
  },
  "diagonal-band": {
    fields: {
      eyebrow: "Built for momentum",
      headline: "See today and what comes next",
      caption: "One list, one glance.",
    },
    overrides: { background: "#5B4BF0", bandAngle: -12, bandPosition: 0.48 },
  },
  "overlap-headline": {
    fields: {
      eyebrow: "Everything in reach",
      headline: "Plans that finish themselves",
      caption: "Sync across iPhone, iPad and the web.",
    },
    overrides: { background: NIGHT },
  },
  "split-caption": {
    fields: { headline: "Turn plans into progress", caption: "See what matters today." },
    overrides: {
      background: "#0F766E",
      textWidth: 0.42,
      screenshotScale: 0.72,
      screenshotOffsetX: 0.18,
      screenshotOffsetY: 0.3,
      deviceTilt: -10,
    },
  },
  "full-bleed-card": {
    fields: { headline: "The whole week, one screen", caption: "Swipe to move anything." },
    overrides: { background: NIGHT, screenshotScale: 0.92, cardColor: "rgba(15,13,26,0.92)" },
  },
  "feature-graphic": {
    fields: { headline: "Plan your calm day", caption: "Tasks and reminders in sync." },
    overrides: { background: DEEP },
    targetId: "play-feature-1024x500",
  },
  "strip-banner": {
    slices: 3,
    fields: {
      eyebrow: "Everyday planner",
      headline: "Plan the day, run the week, see the month",
      caption: "One app for all three.",
      label: "Today",
      label2: "This week",
      label3: "Progress",
    },
    overrides: { background: "linear-gradient(120deg,#5B4BF0 0%,#231C6B 100%)", alternateTilt: true },
  },
  "strip-arc": {
    slices: 3,
    fields: {
      eyebrow: "Everyday planner",
      headline: "Everything you planned, in one calm list",
      caption: "iPhone, iPad and the web.",
      label: "Today",
      label2: "This week",
      label3: "Progress",
    },
    overrides: { background: DEEP },
  },
  "strip-alternate": {
    slices: 3,
    fields: {
      eyebrow: "How it works",
      headline: "Add what matters",
      caption: "Two taps, no forms.",
      headline2: "See the week",
      caption2: "Everything on one screen.",
      headline3: "Watch it add up",
      caption3: "Streaks that survive a bad day.",
    },
    overrides: { background: "#12101E", bandColor: "#5B4BF0" },
  },
  "strip-quote": {
    slices: 3,
    fields: {
      eyebrow: "App Store review",
      headline: "I stopped keeping three lists in three apps. Everything lives here now, and I actually finish things.",
      caption: "Sarah - teacher, Lisbon",
    },
    overrides: { background: SAND, textColor: "#171514", starColor: "#D9542B" },
  },
  "strip-hero": {
    slices: 3,
    fields: {
      eyebrow: "Everyday planner",
      headline: "Your whole day, decided in a minute",
      caption: "Open it and you already know what to do.",
      headline2: "See the week",
      caption2: "One screen, no scrolling.",
      headline3: "Watch it add up",
      caption3: "Streaks that survive a bad day.",
    },
    overrides: { background: DEEP },
  },
  "strip-marquee": {
    slices: 3,
    fields: {
      marquee: "plan . do . done",
      eyebrow: "Everyday planner",
      headline: "Add what matters",
      caption: "Two taps, no forms.",
      headline2: "See the week",
      caption2: "Everything on one screen.",
      headline3: "Watch it add up",
      caption3: "Streaks that survive a bad day.",
    },
    overrides: { background: "#101018", marqueeColor: "#9C8CFF", marqueeOpacity: 0.22 },
  },
  "strip-story": {
    slices: 3,
    fields: {
      eyebrow: "How it works",
      headline: "Add what matters",
      caption: "Two taps, no forms.",
      headline2: "See the week",
      caption2: "Everything on one screen.",
      headline3: "Watch it add up",
      caption3: "Streaks that survive a bad day.",
    },
    overrides: { background: NIGHT, pathColor: "#9C8CFF", path: "dashed" },
  },
};

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  fs.mkdirSync(WORK, { recursive: true });
  const captures: string[] = [];
  for (const [i, svg] of SCREENS.entries()) {
    const file = path.join(WORK, `capture-${i + 1}.png`);
    await sharp(Buffer.from(svg)).png().toFile(file);
    captures.push(pathToFileURL(file).href);
  }

  const renderer = new ExportRenderer();
  await renderer.start();
  try {
    for (const [id, example] of Object.entries(EXAMPLES)) {
      const mod = templateModules[id];
      if (!mod) throw new Error(`No template "${id}" — update EXAMPLES in scripts/template-previews.ts`);
      const target = targetProfiles[example.targetId ?? "iphone-6.9-1320x2868"];
      const slices = example.slices ?? 1;
      const canvasWidth = target.width * slices;
      const input: TemplateRenderInput = {
        target,
        canvasWidth,
        locale: "en-US",
        direction: "ltr",
        fields: example.fields,
        sourceImageUrl: captures[0],
        sliceImageUrls: Array.from({ length: slices }, (_, i) => captures[i % captures.length]),
        brand: BRAND,
        overrides: mod.overridesSchema.parse(example.overrides ?? {}) as Record<string, unknown>,
        mode: "export",
        assetUrl: (rel) => rel,
      };
      const body = renderStatic(mod.render(input));
      const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><style>${baseCss()}</style></head><body style="width:${canvasWidth}px;height:${target.height}px;overflow:hidden;">${body}</body></html>`;
      const result = await renderer.render(id, html, target, {
        backgroundColor: "#ffffff",
        workDir: WORK,
        canvasWidth,
      });
      const problems = [
        ...result.checks.overflow.map((o) => `overflow:${o.id}`),
        ...result.checks.textOverlapsDevice.map((t) => `overlap:${t}`),
        ...result.checks.missingImages.map((m) => `missing-image:${m}`),
      ];
      if (problems.length) throw new Error(`${id}: ${problems.join(", ")} — fix the example or the template`);
      const width = THUMB * slices;
      await sharp(result.png)
        .resize({ width })
        .jpeg({ quality: 80, chromaSubsampling: "4:4:4" })
        .toFile(path.join(OUT, `${id}.jpg`));
      console.log(`wrote public/template-previews/${id}.jpg (${width}px)`);
    }
  } finally {
    await renderer.close();
  }

  const missing = Object.keys(templateModules).filter((id) => !EXAMPLES[id]);
  if (missing.length)
    throw new Error(`No example for: ${missing.join(", ")} — add one to scripts/template-previews.ts`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
