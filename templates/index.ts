import diagonalBand from "./diagonal-band";
import featureGraphic from "./feature-graphic";
import fullBleedCard from "./full-bleed-card";
import heroTop from "./hero-top";
import overlapHeadline from "./overlap-headline";
import splitCaption from "./split-caption";
import spotlight from "./spotlight";
import statHero from "./stat-hero";
import statement from "./statement";
import stripAlternate from "./strip-alternate";
import stripArc from "./strip-arc";
import stripBanner from "./strip-banner";
import stripHero from "./strip-hero";
import stripMarquee from "./strip-marquee";
import stripQuote from "./strip-quote";
import stripStory from "./strip-story";
import zoomDetail from "./zoom-detail";
import type { TemplateModule } from "./types";

/** Template registry (plan §10.2). */
export const templateModules: Record<string, TemplateModule> = {
  [heroTop.descriptor.id]: heroTop as unknown as TemplateModule,
  [splitCaption.descriptor.id]: splitCaption as unknown as TemplateModule,
  [fullBleedCard.descriptor.id]: fullBleedCard as unknown as TemplateModule,
  [featureGraphic.descriptor.id]: featureGraphic as unknown as TemplateModule,
  [statement.descriptor.id]: statement as unknown as TemplateModule,
  [statHero.descriptor.id]: statHero as unknown as TemplateModule,
  [zoomDetail.descriptor.id]: zoomDetail as unknown as TemplateModule,
  [diagonalBand.descriptor.id]: diagonalBand as unknown as TemplateModule,
  [spotlight.descriptor.id]: spotlight as unknown as TemplateModule,
  [overlapHeadline.descriptor.id]: overlapHeadline as unknown as TemplateModule,
  [stripBanner.descriptor.id]: stripBanner as unknown as TemplateModule,
  [stripStory.descriptor.id]: stripStory as unknown as TemplateModule,
  [stripArc.descriptor.id]: stripArc as unknown as TemplateModule,
  [stripAlternate.descriptor.id]: stripAlternate as unknown as TemplateModule,
  [stripQuote.descriptor.id]: stripQuote as unknown as TemplateModule,
  [stripHero.descriptor.id]: stripHero as unknown as TemplateModule,
  [stripMarquee.descriptor.id]: stripMarquee as unknown as TemplateModule,
};

export const templateIds = Object.keys(templateModules);

/** Templates that compose the whole strip (chosen in the editor's Strip tab). */
export const stripTemplateIds = templateIds.filter((id) => templateModules[id].descriptor.strip === true);

/** Templates for a single screen (everything else). */
export const screenTemplateIds = templateIds.filter((id) => templateModules[id].descriptor.strip !== true);

export function getTemplateModule(id: string): TemplateModule | undefined {
  return templateModules[id];
}
