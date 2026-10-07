/**
 * Cyberspace (docs/visualizer/scenes.md, "Five more, again"): a stub, being built.
 */
import type { SceneSpec } from "./index.ts";
import { cameraLooking, sceneDt, soundUniforms } from "./kit.ts";

interface StubState {
  z: number;
}

export const CYBERSPACE: SceneSpec<StubState> = {
  type: "cyberspace",
  label: "Cyberspace",
  params: [],
  glsl: /* glsl */ `
vec3 scene(vec2 uv) {
  return vec3(0.0);
}
`,
  init: () => ({ z: 0 }),
  step(s, frame) {
    s.z += sceneDt(frame);
  },
  uniforms(s, frame) {
    return [...cameraLooking([0, 0, s.z], [0, 0, 1], 0, 70), ...soundUniforms(frame)];
  },
};
