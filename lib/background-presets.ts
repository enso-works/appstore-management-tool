import type { BackgroundValues } from "./schema";

/**
 * Curated ready-made background styles for the editor's gallery. Each applies
 * a full set of background values in one click (to the current screen or as
 * the project default). Pure data — safe for client and server.
 */
export interface BackgroundPreset {
  id: string;
  name: string;
  values: BackgroundValues;
}

export const BACKGROUND_PRESETS: BackgroundPreset[] = [
  {
    id: "cream-waves",
    name: "Cream waves",
    values: { background: "#F4F0E7", backgroundImage: "pattern:waves", patternColor: "rgba(0,0,0,0.06)" },
  },
  {
    id: "paper-grain",
    name: "Paper grain",
    values: { background: "#F7F5F0", backgroundImage: "pattern:noise" },
  },
  {
    id: "soft-sky",
    name: "Soft sky",
    values: { background: "linear-gradient(170deg, #E8F1F8 0%, #CFE2F0 100%)" },
  },
  {
    id: "lavender",
    name: "Lavender",
    values: { background: "linear-gradient(160deg, #EEE9FB 0%, #CFC2F2 100%)" },
  },
  {
    id: "blush-rings",
    name: "Blush rings",
    values: { background: "#FBEFEA", backgroundImage: "pattern:rings", patternColor: "rgba(120,60,40,0.07)" },
  },
  {
    id: "ocean-zigzag",
    name: "Ocean zigzag",
    values: { background: "#E4F0F1", backgroundImage: "pattern:zigzag", patternColor: "rgba(0,80,90,0.08)" },
  },
  {
    id: "forest",
    name: "Forest",
    values: { background: "linear-gradient(165deg, #1F6F68 0%, #0F3833 100%)" },
  },
  {
    id: "sunset",
    name: "Sunset",
    values: { background: "linear-gradient(160deg, #FF9A76 0%, #E85D6A 100%)" },
  },
  {
    id: "midnight-dots",
    name: "Midnight dots",
    values: {
      background: "linear-gradient(170deg, #1A1B2E 0%, #0D0E1A 100%)",
      backgroundImage: "pattern:dots",
      patternColor: "rgba(255,255,255,0.07)",
    },
  },
  {
    id: "graphite-grid",
    name: "Graphite grid",
    values: { background: "#17181C", backgroundImage: "pattern:grid", patternColor: "rgba(255,255,255,0.05)" },
  },
  {
    id: "sand-lines",
    name: "Sand lines",
    values: { background: "#EFE7DA", backgroundImage: "pattern:lines", patternColor: "rgba(90,70,40,0.07)" },
  },
  {
    id: "mint-checker",
    name: "Mint checker",
    values: {
      background: "#EAF6F1",
      backgroundImage: "pattern:checker",
      patternColor: "rgba(20,110,80,0.05)",
      patternScale: 2,
    },
  },
];
