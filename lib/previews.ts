/**
 * App Preview sizes and limits (verified 2026-10-09), shared by readiness and
 * `asc push default`. Each size is accepted either way round: 886x1920 for
 * every iPhone with Face ID or Dynamic Island, 1080x1920 and 750x1334 for the
 * Home-button iPhones, 1200x1600 for iPads from 10.5" up, 900x1200 for 9.7"
 * and older 12.9". `type` is App Store Connect's preview type the push files
 * it under.
 */
export const PREVIEW_CLASSES: { device: string; width: number; height: number; type: string }[] = [
  { device: "iPhone", width: 886, height: 1920, type: "IPHONE_67" },
  { device: 'iPhone 5.5"', width: 1080, height: 1920, type: "IPHONE_55" },
  { device: 'iPhone 4.7"', width: 750, height: 1334, type: "IPHONE_47" },
  { device: "iPad", width: 1200, height: 1600, type: "IPAD_PRO_3GEN_129" },
  { device: 'iPad 9.7"', width: 900, height: 1200, type: "IPAD_97" },
];

export function previewClass(width: number, height: number) {
  return PREVIEW_CLASSES.find(
    (c) => (c.width === width && c.height === height) || (c.width === height && c.height === width),
  );
}

export const PREVIEW_LIMITS = { minSeconds: 15, maxSeconds: 30, maxFps: 30, maxBytes: 500 * 1024 * 1024, perSet: 3 };

/** The video files App Store Connect takes, by extension. */
export const VIDEO_MIME: Record<string, string> = {
  ".mp4": "video/mp4",
  ".m4v": "video/x-m4v",
  ".mov": "video/quicktime",
};
