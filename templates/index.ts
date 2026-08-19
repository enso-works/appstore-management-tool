import heroTop from "./hero-top";
import type { TemplateModule } from "./types";

/**
 * Template registry. Phase 2 ships hero-top; split-caption and full-bleed-card
 * arrive in Phase 6 and are registered here when they do.
 */
export const templateModules: Record<string, TemplateModule> = {
  [heroTop.descriptor.id]: heroTop as unknown as TemplateModule,
};

export const templateIds = Object.keys(templateModules);

export function getTemplateModule(id: string): TemplateModule | undefined {
  return templateModules[id];
}
