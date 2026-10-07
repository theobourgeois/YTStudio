/**
 * Subject filters (docs/photo/effects/scene-maps.md): looks made around the picture's subject, from its subject map
 * (`../../scene.ts`, read as `env.scene` / `scene_at`). Their references are `../../reference/filters/subject.ts`, their
 * WGSL `src/suites/photo/render/filters/subject.ts`.
 */
import type { EffectDefinition } from "../index.ts";

export const SUBJECT_FILTERS: EffectDefinition[] = [];
