import type { Issue } from "../issues";
import type { InPageResult } from "../render/checks";
import type { FitResult } from "../render/fit";
import type { LocaleContent, Manifest, ScreenDefinition } from "../schema";
import type { TargetProfile } from "../targets";

/**
 * The message contract between the Mac app and the canvas page
 * (/projects/<app>/canvas). Version 1; see docs/canvas-bridge.md.
 *
 * The app owns every draft; the canvas renders what it is given and reports
 * what the user did on it.
 */

export const BRIDGE_VERSION = 1;

/** App -> canvas: everything the canvas shows. Sent whole, whenever any of it changes. */
export interface CanvasState {
  v: 1;
  manifest: Manifest;
  content: Record<string, LocaleContent>;
  /** The project's targets, as the snapshot lists them. */
  targets: TargetProfile[];
  targetId: string;
  locale: string;
  /** "" is the default page; otherwise a named set. */
  pageId: string;
  screenId: string;
  mode: "single" | "strip" | "locales";
  storeLook: boolean;
  guides: boolean;
  /** The selected element: "phone", "background", "text:<slice>" or "layer:<id>". */
  selected: string;
  /** Validation issues, for the status badges under each frame. */
  issues?: Issue[];
  failOnOverflow?: boolean;
  failOnTextOverlap?: boolean;
  /** Per screen id, bumped when its capture changes on disk: that screen's frames render again. */
  revisions?: Record<string, number>;
  /** Show the live App Store listing under the strip, from this storefront (e.g. "us"). */
  liveCountry?: string;
}

/** App -> canvas: zoom and layout commands from the native toolbar and menus. */
export type CanvasCommand = { action: "zoomIn" | "zoomOut" | "fit" | "actual" | "toggleWrap" };

/** Canvas -> app. */
export type CanvasMessage =
  | { type: "ready"; v: number }
  /** A finished drag or an arrow-key nudge: apply this patch to the screen (one undo step). */
  | { type: "patchScreen"; screenId: string; patch: Partial<ScreenDefinition> }
  /** An element was clicked in the artwork. */
  | { type: "select"; element: string }
  /** A frame was clicked in Strip or Languages: a screen id, or a locale in Languages. */
  | { type: "selectItem"; id: string }
  /** A frame was double-clicked: show it alone. */
  | { type: "openItem"; id: string }
  /** The selected layer should go (Delete key). */
  | { type: "deleteLayer"; screenId: string; layerId: string }
  /** The g key. */
  | { type: "toggleGuides" }
  /** The single preview's state: checks, fit results, text budgets. */
  | {
      type: "preview";
      screenId: string;
      locale: string;
      loading: boolean;
      error?: string;
      sourceExists?: boolean;
      budgets?: Record<string, number>;
      checks?: InPageResult;
      fits?: FitResult[];
    }
  /** Zoom and wrap, for the native toolbar. */
  | { type: "view"; scale: number; wrap: boolean; canWrap: boolean }
  /** The live listing's state when it is shown: its version, or why it is not there. */
  | { type: "live"; version?: string; error?: string };
