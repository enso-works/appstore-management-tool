import { getTemplateModule, templateIds as ids } from "../../templates";
import type { TemplateDescriptor } from "../../templates/types";

export type { TemplateDescriptor } from "../../templates/types";

export const templateIds = ids;

export function getTemplate(id: string): TemplateDescriptor | undefined {
  return getTemplateModule(id)?.descriptor;
}

export function templateFields(t: TemplateDescriptor): string[] {
  return [...t.requiredFields, ...t.optionalFields];
}
