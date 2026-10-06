/** Storm Sea (docs/visualizer/scenes.md). */
import type { SceneSpec } from "./index.ts";
import { cameraUniforms, soundUniforms } from "./kit.ts";

export const STORM_SEA: SceneSpec<{ time: number }> = {
  type: "storm-sea",
  label: "Storm Sea",
  params: [],
  glsl: /* glsl */ `
vec3 scene(vec2 uv) { return vec3(uv, 0.5); }
`,
  init: () => ({ time: 0 }),
  step(s, frame) {
    s.time += frame.dt;
  },
  uniforms: (_s, frame) => [...cameraUniforms([0, 0, 0], [0, 0, 1], 0, 60), ...soundUniforms(frame)],
};
