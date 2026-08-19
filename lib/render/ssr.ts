import { createRequire } from "node:module";
import type { ReactElement } from "react";

/**
 * Render a React element to static HTML on the server.
 *
 * Next.js forbids importing "react-dom/server" statically anywhere in the app
 * layer (it assumes you want a Server Component), but rendering a template to
 * an HTML string for Playwright is exactly what we need. A runtime require
 * through Node's own `createRequire` keeps the bundler out of it and resolves
 * the same react-dom this package depends on (relative to this file, not cwd).
 */
let cached: ((el: ReactElement) => string) | undefined;

export function renderStatic(el: ReactElement): string {
  if (!cached) {
    const req = createRequire(import.meta.url);
    const mod = req("react-dom/server") as { renderToStaticMarkup: (el: ReactElement) => string };
    cached = mod.renderToStaticMarkup;
  }
  return cached(el);
}
