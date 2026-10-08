import type { Layer } from "./schema";

/** The layers drawn on a target: those without `targets`, and those that name it. */
export function layersFor<T extends Pick<Layer, "targets">>(layers: T[], targetId: string): T[] {
  return layers.filter((layer) => !layer.targets || layer.targets.includes(targetId));
}
