import { createGetUrl } from "fumadocs-core/source";

export const appName = "store-shots";
/** Where the site is served (store-shots.bavrk.com, deployed from enso-works/bavrk). */
export const siteUrl = "https://store-shots.bavrk.com";
export const summary =
  "App Store and Google Play screenshots, built from your app's real captures and checked against the rules that get listings rejected.";
export const docsRoute = "/docs";
export const docsImageRoute = "/og/docs";
export const docsContentRoute = "/llms.mdx/docs";

export const gitConfig = {
  user: "enso-works",
  repo: "appstore-management-tool",
  branch: "main",
  // Where the pages live in the repo, for "edit on GitHub".
  contentDir: "site/content/docs",
};

export const repoUrl = `https://github.com/${gitConfig.user}/${gitConfig.repo}`;

const getContentUrl = createGetUrl(docsContentRoute);

export function getPageMarkdownUrl(page: { slugs: string[]; locale?: string }) {
  const segments = [...page.slugs, "content.md"];

  return { segments, url: getContentUrl(segments, page.locale) };
}

const getImageUrl = createGetUrl(docsImageRoute);

export function getPageImageUrl(page: { slugs: string[]; locale?: string }) {
  const segments = [...page.slugs, "image.png"];

  return { segments, url: getImageUrl(segments, page.locale) };
}
