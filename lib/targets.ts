/**
 * Device profile registry (plan §8.3).
 *
 * Keys embed the exact output resolution because Apple accepts several
 * resolutions per display class. Review against Apple's screenshot
 * specification page whenever this table changes:
 * https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications/
 */
export type Platform = "ios" | "android";
export type DeviceFamily = "iphone" | "ipad" | "phone" | "tablet" | "feature-graphic" | "event" | "creative";
export type Orientation = "portrait" | "landscape";

export interface TargetProfile {
  id: string;
  platform: Platform;
  family: DeviceFamily;
  displayClass: string;
  orientation: Orientation;
  width: number;
  height: number;
  /** Token used in generated filenames, e.g. 01_home_IPHONE_69.png */
  fileToken: string;
}

export const targetProfiles = {
  "iphone-6.9-1320x2868": {
    id: "iphone-6.9-1320x2868",
    platform: "ios",
    family: "iphone",
    displayClass: "6.9-inch",
    orientation: "portrait",
    width: 1320,
    height: 2868,
    fileToken: "IPHONE_69",
  },
  // iPhone with Dynamic Island (medium display), the size Apple names as
  // required (verified 2026-10-08). deliver files 1206x2622 as APP_IPHONE_61.
  // Its aspect matches 6.9", so it renders from the same raw captures.
  "iphone-6.1-1206x2622": {
    id: "iphone-6.1-1206x2622",
    platform: "ios",
    family: "iphone",
    displayClass: "6.1-inch",
    orientation: "portrait",
    width: 1206,
    height: 2622,
    fileToken: "IPHONE_61",
  },
  "ipad-13-2064x2752": {
    id: "ipad-13-2064x2752",
    platform: "ios",
    family: "ipad",
    displayClass: "13-inch",
    orientation: "portrait",
    width: 2064,
    height: 2752,
    fileToken: "IPAD_PRO_129",
  },
  // Landscape sets for apps that run sideways (games). Same display classes;
  // deliver tells them apart by pixel size, the token keeps filenames apart.
  "iphone-6.9-2868x1320": {
    id: "iphone-6.9-2868x1320",
    platform: "ios",
    family: "iphone",
    displayClass: "6.9-inch",
    orientation: "landscape",
    width: 2868,
    height: 1320,
    fileToken: "IPHONE_69_LANDSCAPE",
  },
  "iphone-6.1-2622x1206": {
    id: "iphone-6.1-2622x1206",
    platform: "ios",
    family: "iphone",
    displayClass: "6.1-inch",
    orientation: "landscape",
    width: 2622,
    height: 1206,
    fileToken: "IPHONE_61_LANDSCAPE",
  },
  "ipad-13-2752x2064": {
    id: "ipad-13-2752x2064",
    platform: "ios",
    family: "ipad",
    displayClass: "13-inch",
    orientation: "landscape",
    width: 2752,
    height: 2064,
    fileToken: "IPAD_PRO_129_LANDSCAPE",
  },
  // Google Play phone screenshots: 9:16, >= 1080 px, max/min side ratio <= 2:1.
  // Output goes to fastlane/metadata/android/<locale>/images/phoneScreenshots/ (supply layout).
  "play-phone-1080x1920": {
    id: "play-phone-1080x1920",
    platform: "android",
    family: "phone",
    displayClass: "phone",
    orientation: "portrait",
    width: 1080,
    height: 1920,
    fileToken: "PLAY_PHONE",
  },
  // Google Play feature graphic: one landscape banner per locale, uploaded by
  // supply from <play-locale>/images/featureGraphic.png.
  "play-feature-1024x500": {
    id: "play-feature-1024x500",
    platform: "android",
    family: "feature-graphic",
    displayClass: "feature graphic",
    orientation: "landscape",
    width: 1024,
    height: 500,
    fileToken: "PLAY_FEATURE",
  },
  // App Preview poster (first video frame) for the 6.9-inch class: 886x1920.
  // Written under store/generated/posters/<locale>/ - never uploaded by deliver.
  "appreview-6.9-886x1920": {
    id: "appreview-6.9-886x1920",
    platform: "ios",
    family: "iphone",
    displayClass: "6.9-inch app preview",
    orientation: "portrait",
    width: 886,
    height: 1920,
    fileToken: "APP_PREVIEW_69",
  },
  // In-app event media (App Store Connect, verified 2026-10-09): the event card
  // is 16:9 from 1920x1080, the event details page 9:16 from 1080x1920. Both
  // render from the iPhone captures and are uploaded by hand in App Store
  // Connect, so they go to store/generated/events/<locale>/.
  "event-card-1920x1080": {
    id: "event-card-1920x1080",
    platform: "ios",
    family: "event",
    displayClass: "event card",
    orientation: "landscape",
    width: 1920,
    height: 1080,
    fileToken: "EVENT_CARD",
  },
  "event-detail-1080x1920": {
    id: "event-detail-1080x1920",
    platform: "ios",
    family: "event",
    displayClass: "event details",
    orientation: "portrait",
    width: 1080,
    height: 1920,
    fileToken: "EVENT_DETAIL",
  },
  // App Store creative assets (Asset Library, live 2026-10-05, iOS 27 and later;
  // sizes from Apple's reference data, verified 2026-10-09): one product page
  // header and one search results image per page and locale. The 16:9 image is
  // "universal": App Store Connect crops it to 21:9 for the header and 3:2 for
  // search results, so it can serve both. All render from the iPhone captures
  // into store/generated/creative/<locale>/ and go up with `asc push`.
  "header-3840x1646": {
    id: "header-3840x1646",
    platform: "ios",
    family: "creative",
    displayClass: "product page header",
    orientation: "landscape",
    width: 3840,
    height: 1646,
    fileToken: "HEADER",
  },
  "search-3840x2560": {
    id: "search-3840x2560",
    platform: "ios",
    family: "creative",
    displayClass: "search results",
    orientation: "landscape",
    width: 3840,
    height: 2560,
    fileToken: "SEARCH",
  },
  "universal-5244x2950": {
    id: "universal-5244x2950",
    platform: "ios",
    family: "creative",
    displayClass: "header and search results",
    orientation: "landscape",
    width: 5244,
    height: 2950,
    fileToken: "UNIVERSAL",
  },
} as const satisfies Record<string, TargetProfile>;

export type TargetId = keyof typeof targetProfiles;

export const targetIds = Object.keys(targetProfiles) as TargetId[];

export function getTarget(id: string): TargetProfile | undefined {
  return (targetProfiles as Record<string, TargetProfile>)[id];
}

export function isTargetId(id: string): id is TargetId {
  return id in targetProfiles;
}

/**
 * A screenshot set the store shows on the product page (and deliver or supply
 * uploads), as opposed to App Preview posters, in-app event media and
 * creative assets.
 */
export function isScreenshotSet(target: TargetProfile | string): boolean {
  const t = typeof target === "string" ? getTarget(target) : target;
  return !!t && !t.id.startsWith("appreview-") && t.family !== "event" && t.family !== "creative";
}

/** Which creative placements a target's image fills: the universal one fills both. */
export type CreativePlacement = "header" | "search";

export function creativePlacementsOf(target: TargetProfile | string): CreativePlacement[] {
  const t = typeof target === "string" ? getTarget(target) : target;
  if (!t || t.family !== "creative") return [];
  return t.id.startsWith("header-") ? ["header"] : t.id.startsWith("search-") ? ["search"] : ["header", "search"];
}

/**
 * Which of a page's screens give its header and search results images: a
 * dedicated image wins over the universal one for its placement.
 */
export function pageCreative(
  screens: readonly { id: string; targets?: readonly string[] }[],
  configured: readonly string[],
): Partial<Record<CreativePlacement, string>> {
  const out: Partial<Record<CreativePlacement, string>> = {};
  for (const screen of screens) {
    for (const t of screen.targets ?? []) {
      if (!configured.includes(t)) continue;
      const placements = creativePlacementsOf(t);
      for (const p of placements) if (placements.length === 1 || !out[p]) out[p] = screen.id;
    }
  }
  return out;
}

/**
 * The part of a creative asset every placement shows, in canvas pixels. App
 * Store Connect crops the universal 16:9 image to 21:9 for the header and to
 * 3:2 for search results, both centred, so only their overlap is safe. Other
 * targets show the whole canvas.
 */
export function safeAreaOf(target: { id: string; width: number; height: number }): {
  left: number;
  top: number;
  width: number;
  height: number;
} {
  if (!target.id.startsWith("universal-")) return { left: 0, top: 0, width: target.width, height: target.height };
  const width = Math.min(target.width, Math.round((target.height * 3) / 2));
  const height = Math.min(target.height, Math.round((target.width * 9) / 21));
  return {
    left: Math.round((target.width - width) / 2),
    top: Math.round((target.height - height) / 2),
    width,
    height,
  };
}

/**
 * One picture made for a purpose, not a screen of the listing: the Play feature
 * graphic, in-app event media and App Store creative assets. A screen renders
 * for them only when it names them in `targets`; screens without a list stay
 * on the screenshot sets.
 */
export function isOptInTarget(target: TargetProfile | string): boolean {
  const t = typeof target === "string" ? getTarget(target) : target;
  return !!t && (t.family === "event" || t.family === "feature-graphic" || t.family === "creative");
}

/** One wide or tall picture that shows the app's own iPhone capture: event media and creative assets. */
export function showsIphoneCapture(target: TargetProfile): boolean {
  return target.family === "event" || target.family === "creative";
}

/** The device a target shows: event media and creative assets show the iPhone app, everything else its own family. */
export function deviceFamilyOf(target: TargetProfile): DeviceFamily {
  return showsIphoneCapture(target) ? "iphone" : target.family;
}

/**
 * A short name for a target in the editor: `iPhone 6.9"`, `iPad 13"`, `Play
 * phone`. Pass the targets shown alongside it to add the orientation when the
 * same display class appears in both.
 */
export function shortLabel(target: TargetProfile, alongside: readonly TargetProfile[] = []): string {
  const inches = target.displayClass.match(/^[\d.]+/)?.[0];
  const base = target.id.startsWith("appreview-")
    ? `Preview ${inches}"`
    : target.family === "event"
      ? target.displayClass === "event card"
        ? "Event card"
        : "Event details"
      : target.family === "creative"
        ? target.id.startsWith("header-")
          ? "Header"
          : target.id.startsWith("search-")
            ? "Search results"
            : "Header + search"
        : target.family === "iphone"
          ? `iPhone ${inches}"`
          : target.family === "ipad"
            ? `iPad ${inches}"`
            : target.family === "feature-graphic"
              ? "Feature graphic"
              : `Play ${target.family}`;
  const twin = alongside.some(
    (t) => t.id !== target.id && t.family === target.family && t.displayClass === target.displayClass,
  );
  return twin ? `${base} ${target.orientation}` : base;
}

/**
 * Store targets for an app: the iPhone sets Apple asks for (6.9" and 6.1"),
 * iPad 13" for iPad apps and the Play phone set for Play apps, all in one
 * orientation. App Preview posters and the Play feature graphic stay opt-in.
 */
export function targetsFor(choice: { orientation: Orientation; ipad: boolean; play: boolean }): string[] {
  return targetIds.filter((id) => {
    const t = getTarget(id)!;
    if (!isScreenshotSet(t) || t.family === "feature-graphic") return false;
    if (t.platform === "android") return choice.play && t.family === "phone";
    if (t.orientation !== choice.orientation) return false;
    return t.family === "iphone" || (choice.ipad && t.family === "ipad");
  });
}

/**
 * Type unit: the canvas's short side. Templates size type, padding and shells
 * from it, so a landscape canvas gets the same type as its portrait twin
 * instead of type scaled to the long edge.
 */
export function typeUnit(target: { width: number; height: number }): number {
  return Math.min(target.width, target.height);
}

/**
 * Apple allows 1-10 screenshots per device class per locale (verified
 * 2026-08-19). Projects may narrow this via validation.screensPerTarget.
 */
export const APPLE_SCREENSHOTS_PER_SET = { min: 1, max: 10 } as const;

/** Where `deliver` / `supply` expect screenshots for a target's platform. */
export function outputDirFor(
  target: TargetProfile,
  locale: string,
  paths: { outputScreenshots: string; outputPlay: string; generated?: string },
): string {
  // Posters are working assets for App Preview videos, not deliver screenshots.
  if (target.id.startsWith("appreview-")) {
    return `${paths.generated ?? "store/generated"}/posters/${locale}`;
  }
  if (target.family === "event") {
    return `${paths.generated ?? "store/generated"}/events/${locale}`;
  }
  if (target.family === "creative") {
    return `${paths.generated ?? "store/generated"}/creative/${locale}`;
  }
  if (target.platform === "android") {
    const kind =
      target.family === "tablet" ? "tenInchScreenshots" : target.family === "feature-graphic" ? "" : "phoneScreenshots";
    return kind
      ? `${paths.outputPlay}/${playLocaleFor(locale)}/images/${kind}`
      : `${paths.outputPlay}/${playLocaleFor(locale)}/images`;
  }
  return `${paths.outputScreenshots}/${locale}`;
}

/** App Store locale -> Google Play locale where they differ (supply directory names). */
const PLAY_LOCALES: Record<string, string> = {
  da: "da-DK",
  fi: "fi-FI",
  he: "iw-IL",
  id: "id",
  ja: "ja-JP",
  ko: "ko-KR",
  no: "no-NO",
  sv: "sv-SE",
  th: "th",
  tr: "tr-TR",
  vi: "vi",
  cs: "cs-CZ",
  el: "el-GR",
  hu: "hu-HU",
  pl: "pl-PL",
  ro: "ro",
  ru: "ru-RU",
  sk: "sk",
  uk: "uk",
  hr: "hr",
  ms: "ms",
  ca: "ca",
  hi: "hi-IN",
  "zh-Hans": "zh-CN",
  "zh-Hant": "zh-TW",
};

export function playLocaleFor(locale: string): string {
  return PLAY_LOCALES[locale] ?? locale;
}
