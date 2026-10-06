// Procedural PBR environment. Everything metallic in a scene reflects this, so
// it does most of the work of making chrome read as chrome — no asset files,
// no network, and the colors can be themed per scene.

import * as THREE from "three";

export type EnvironmentOptions = {
  /** Zenith / floor colors of the surrounding gradient. */
  top?: THREE.ColorRepresentation;
  bottom?: THREE.ColorRepresentation;
  /** Horizon haze. */
  glow?: THREE.ColorRepresentation;
  /** Vertical light strips — these become the sharp streaks across metal. */
  bar?: THREE.ColorRepresentation;
  /** How many strips run around the horizon. */
  bars?: number;
  /** Blur applied to the prefiltered map, in radians. */
  blur?: number;
};

const ENV_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const ENV_FRAG = /* glsl */ `
uniform vec3 uTop;
uniform vec3 uBottom;
uniform vec3 uGlow;
uniform vec3 uBar;
uniform float uBars;
varying vec3 vDir;

void main() {
  vec3 d = normalize(vDir);
  float h = clamp(d.y * 0.5 + 0.5, 0.0, 1.0);
  vec3 col = mix(uBottom, uTop, pow(h, 1.6));
  col += uGlow * exp(-abs(d.y) * 6.0) * 0.6;
  col += uTop * smoothstep(0.55, 1.0, d.y) * 0.9;

  float a = atan(d.z, d.x);
  float strip = 0.5 + 0.5 * cos(a * uBars);
  float mask = smoothstep(0.9, 0.999, strip) * smoothstep(-0.6, 0.4, d.y);
  col += uBar * mask * 1.8;

  gl_FragColor = vec4(col, 1.0);
}
`;

export type Environment = {
  texture: THREE.Texture;
  dispose(): void;
};

export function createEnvironment(
  renderer: THREE.WebGLRenderer,
  options: EnvironmentOptions = {},
): Environment {
  const geometry = new THREE.SphereGeometry(12, 48, 24);
  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      uTop: { value: new THREE.Color(options.top ?? "#2b3a52") },
      uBottom: { value: new THREE.Color(options.bottom ?? "#05060a") },
      uGlow: { value: new THREE.Color(options.glow ?? "#12212e") },
      uBar: { value: new THREE.Color(options.bar ?? "#cfe6ff") },
      uBars: { value: options.bars ?? 7 },
    },
    vertexShader: ENV_VERT,
    fragmentShader: ENV_FRAG,
  });

  const scene = new THREE.Scene();
  scene.add(new THREE.Mesh(geometry, material));

  const pmrem = new THREE.PMREMGenerator(renderer);
  const target = pmrem.fromScene(scene, options.blur ?? 0.02, 0.1, 60);

  geometry.dispose();
  material.dispose();
  pmrem.dispose();

  return {
    texture: target.texture,
    dispose() {
      target.dispose();
    },
  };
}
