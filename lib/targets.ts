/**
 * Device profile registry (plan §8.3).
 *
 * Keys embed the exact output resolution because Apple accepts several
 * resolutions per display class. Review against Apple's screenshot
 * specification page whenever this table changes:
 * https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications/
 */
export type Platform = "ios" | "android";
export type DeviceFamily = "iphone" | "ipad" | "phone" | "tablet" | "feature-graphic";
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
