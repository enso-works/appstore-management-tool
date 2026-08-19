/**
 * App Store Connect locale codes as accepted by fastlane `deliver`
 * (metadata/<locale>/ and screenshots/<locale>/ directory names).
 * Source: deliver's documented locale list; recheck on fastlane upgrades.
 */
export const APP_STORE_LOCALES = [
  "ar-SA",
  "ca",
  "cs",
  "da",
  "de-DE",
  "el",
  "en-AU",
  "en-CA",
  "en-GB",
  "en-US",
  "es-ES",
  "es-MX",
  "fi",
  "fr-CA",
  "fr-FR",
  "he",
  "hi",
  "hr",
  "hu",
  "id",
  "it",
  "ja",
  "ko",
  "ms",
  "nl-NL",
  "no",
  "pl",
  "pt-BR",
  "pt-PT",
  "ro",
  "ru",
  "sk",
  "sv",
  "th",
  "tr",
  "uk",
  "vi",
  "zh-Hans",
  "zh-Hant",
] as const;

export type AppStoreLocale = (typeof APP_STORE_LOCALES)[number];

export function isAppStoreLocale(code: string): code is AppStoreLocale {
  return (APP_STORE_LOCALES as readonly string[]).includes(code);
}

const RTL_LANGUAGES = new Set(["ar", "he", "fa", "ur"]);

export type TextDirection = "ltr" | "rtl";

/** Derive text direction from the language subtag when content does not set it. */
export function directionForLocale(code: string): TextDirection {
  const lang = code.split("-")[0].toLowerCase();
  return RTL_LANGUAGES.has(lang) ? "rtl" : "ltr";
}

/**
 * Map an Expo/iOS app language (CFBundleLocalizations entry) to the store
 * locales it most plausibly ships to. Used by `init` to propose a locale
 * list; the user edits the config afterwards.
 */
export const APP_LANGUAGE_TO_STORE_LOCALES: Record<string, AppStoreLocale[]> = {
  en: ["en-US"],
  de: ["de-DE"],
  es: ["es-ES", "es-MX"],
  fr: ["fr-FR"],
  nl: ["nl-NL"],
  da: ["da"],
  it: ["it"],
  pt: ["pt-BR", "pt-PT"],
  sv: ["sv"],
  nb: ["no"],
  no: ["no"],
  fi: ["fi"],
  pl: ["pl"],
  ja: ["ja"],
  ko: ["ko"],
  zh: ["zh-Hans", "zh-Hant"],
  ar: ["ar-SA"],
  he: ["he"],
  tr: ["tr"],
  ru: ["ru"],
  uk: ["uk"],
  cs: ["cs"],
  hu: ["hu"],
  ro: ["ro"],
  el: ["el"],
  hr: ["hr"],
  sk: ["sk"],
  id: ["id"],
  ms: ["ms"],
  th: ["th"],
  vi: ["vi"],
  hi: ["hi"],
  ca: ["ca"],
};
