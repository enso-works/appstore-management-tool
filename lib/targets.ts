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
  // Phase 8 (Google Play):
  // "play-phone-1080x1920": { ... family: "phone" ... },
  // "play-feature-1024x500": { ... family: "feature-graphic" ... },
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
