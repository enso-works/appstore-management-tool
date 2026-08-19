import featureGraphic from "./feature-graphic";
import fullBleedCard from "./full-bleed-card";
import heroTop from "./hero-top";
import splitCaption from "./split-caption";
import type { TemplateModule } from "./types";

/** Template registry (plan §10.2). */
export const templateModules: Record<string, TemplateModule> = {
  [heroTop.descriptor.id]: heroTop as unknown as TemplateModule,
  [splitCaption.descriptor.id]: splitCaption as unknown as TemplateModule,
  [fullBleedCard.descriptor.id]: fullBleedCard as unknown as TemplateModule,
  [featureGraphic.descriptor.id]: featureGraphic as unknown as TemplateModule,
};

export const templateIds = Object.keys(templateModules);

export function getTemplateModule(id: string): TemplateModule | undefined {
  return templateModules[id];
}
