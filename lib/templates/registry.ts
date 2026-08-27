import { getTemplateModule, templateIds as ids } from "../../templates";
import type { TemplateDescriptor } from "../../templates/types";

export type { TemplateDescriptor } from "../../templates/types";

export const templateIds = ids;

export function getTemplate(id: string): TemplateDescriptor | undefined {
  return getTemplateModule(id)?.descriptor;
}

/**
 * Does a screen using this template need a raw capture? False only for pure
 * typography templates (statement); validate and generate skip the missing
 * capture error for those.
 */
export function templateUsesCapture(templateId: string): boolean {
  return getTemplate(templateId)?.usesCapture !== false;
}

export function templateFields(t: TemplateDescriptor): string[] {
  return [...t.requiredFields, ...t.optionalFields];
}
