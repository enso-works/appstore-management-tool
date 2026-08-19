/**
 * (Re)create the fixture project under fixtures/demo-app: two screens, two
 * locales (en-US and RTL ar-SA), both targets, solid-colour raw captures at
 * half the target resolution (same aspect), a valid icon and full metadata.
 * Idempotent; run with `npm run fixtures`.
 */
import fs from "node:fs";
import path from "node:path";
import { writeSolidPng } from "../lib/png-write";
import { targetProfiles } from "../lib/targets";

const root = path.resolve(import.meta.dirname, "..", "fixtures", "demo-app");
fs.mkdirSync(root, { recursive: true });

function write(rel: string, text: string) {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, text.endsWith("\n") ? text : text + "\n");
}

write(
  "app.json",
  JSON.stringify(
    {
      expo: {
        name: "Demo App",
        slug: "demo-app",
        version: "1.2.0",
        orientation: "portrait",
        icon: "./assets/icon.png",
        ios: {
          supportsTablet: true,
          bundleIdentifier: "com.example.demo",
          infoPlist: { CFBundleLocalizations: ["en", "ar"] },
        },
      },
    },
    null,
    2,
  ),
);

write(
  "store-shots.config.json",
  JSON.stringify(
    {
      $schema: "../../schema/project.schema.json",
      projectName: "Demo App",
      bundleId: "com.example.demo",
      defaultLocale: "en-US",
      locales: ["en-US", "ar-SA"],
      targets: ["iphone-6.9-1320x2868", "ipad-13-2064x2752"],
      brand: {
        font: { family: "Inter", source: "google", weights: [400, 700] },
        primary: "#6946F4",
        onPrimary: "#FFFFFF",
      },
      validation: { screensPerTarget: { min: 2, max: 10 } },
      fastlane: { enabled: false },
    },
    null,
    2,
  ),
);

write(
  "store/manifest.json",
  JSON.stringify(
    {
      $schema: "../../../schema/manifest.schema.json",
      screens: [
        {
          id: "home",
          order: 1,
          enabled: true,
          template: "hero-top",
          source: { filePattern: "{order}-{id}.png", localized: true },
          overrides: { background: "linear-gradient(160deg, #6946F4, #312A91)" },
        },
        {
          id: "planning",
          order: 2,
          enabled: true,
          template: "hero-top",
          source: { filePattern: "{order}-{id}.png", localized: false },
          overrides: { background: "#0F766E", shell: "light", textAlign: "start" },
        },
      ],
    },
    null,
    2,
  ),
);

write(
  "store/content/en-US.json",
  JSON.stringify(
    {
      $schema: "../../../../schema/content.schema.json",
      locale: "en-US",
      direction: "ltr",
      screens: {
        home: {
          eyebrow: "A calmer day",
          headline: "Plan everything in one place",
          caption: "Tasks, reminders, and notes that stay in sync.",
        },
        planning: { headline: "Turn plans into progress", caption: "See what matters today and what comes next." },
      },
    },
    null,
    2,
  ),
);

write(
  "store/content/ar-SA.json",
  JSON.stringify(
    {
      $schema: "../../../../schema/content.schema.json",
      locale: "ar-SA",
      direction: "rtl",
      screens: {
        home: {
          eyebrow: "يوم أهدأ",
          headline: "خطّط لكل شيء في مكان واحد",
          caption: "مهام وتذكيرات وملاحظات تبقى متزامنة.",
        },
        planning: { headline: "حوّل الخطط إلى تقدّم", caption: "اعرف ما يهم اليوم وما يأتي بعده." },
      },
    },
    null,
    2,
  ),
);

// Raw captures: half resolution of each target, distinct colours per screen/locale.
const colours: Record<string, [number, number, number]> = {
  "home/en-US": [64, 120, 220],
  "home/ar-SA": [220, 120, 64],
  "planning/en-US": [80, 180, 120],
};
for (const t of Object.values(targetProfiles)) {
  const device = t.family;
  const w = t.width / 2;
  const h = t.height / 2;
  for (const [key, color] of Object.entries(colours)) {
    const [screen, locale] = key.split("/");
    const order = screen === "home" ? "01" : "02";
    writeSolidPng(path.join(root, "store", "raw", device, locale, `${order}-${screen}.png`), {
      width: w,
      height: h,
      color,
      colorBottom: [color[0] / 2, color[1] / 2, color[2] / 2].map(Math.round) as [number, number, number],
    });
  }
}

for (const sub of ["fonts", "logos", "backgrounds"]) write(`store/assets/${sub}/.gitkeep`, "");
write("store/generated/.gitignore", "*\n!.gitignore\n");

writeSolidPng(path.join(root, "assets", "icon.png"), { width: 1024, height: 1024, color: [105, 70, 244] });

const metadata: Record<string, Record<string, string>> = {
  "en-US": {
    name: "Demo App",
    subtitle: "Plan your day with less effort",
    keywords: "planner,tasks,reminders,notes,focus,calendar,todo,habits",
    promotional_text: "A clearer way to organize work and life.",
    description:
      "Demo App keeps tasks, reminders and notes in one calm place.\n\nThis is fixture text used by the store tool's tests.",
    release_notes: "Bug fixes and performance improvements.",
    support_url: "https://example.com/support",
    marketing_url: "https://example.com",
    privacy_url: "https://example.com/privacy",
  },
  "ar-SA": {
    name: "تطبيق تجريبي",
    subtitle: "خطّط ليومك بجهد أقل",
    keywords: "مخطط,مهام,تذكيرات,ملاحظات,تركيز",
    promotional_text: "طريقة أوضح لتنظيم العمل والحياة.",
    description: "يحفظ التطبيق التجريبي المهام والتذكيرات والملاحظات في مكان هادئ واحد.",
    release_notes: "إصلاحات وتحسينات في الأداء.",
    support_url: "https://example.com/support",
    marketing_url: "https://example.com",
    privacy_url: "https://example.com/privacy",
  },
};
for (const [locale, fields] of Object.entries(metadata)) {
  for (const [field, value] of Object.entries(fields)) write(`fastlane/metadata/${locale}/${field}.txt`, value);
}
// Output dir exists but is never committed with content: tests and manual runs write here.
write("fastlane/screenshots/.gitignore", "*\n!.gitignore\n");

console.log(`fixture written to ${root}`);
