// Singularity — a low orbit around a black hole, with the light bent for real.
//
// The sky is not a texture. For every pixel the shader works out the impact
// parameter of that ray against the hole, deflects it by 2·rs/b, and *then*
// samples the starfield — so the stars behind the hole smear around it, the
// shadow is a true silhouette, and the Einstein ring falls out of the geometry
// instead of being drawn on. The accretion disk is Keplerian (the inside laps
// the outside) with relativistic beaming, so the side rotating toward you is
// visibly the bright one, and the halo arcing over the shadow is the far side
// of that same disk seen over the top of the hole.
//
// Bass feeds the disk, onsets fire the polar jets and drop fresh debris into
// the inspiral, where tidal forces stretch it out before it crosses the horizon.

// Ported from vaudio: its state (the camera's orbit, inclination and lens, the jets' power, the debris'
// orbits) is stepped in shared/scenes/singularity.ts; this only shows it.

import * as THREE from "three";
import { DISK_INNER, DISK_OUTER, RS, SHADOW, SHARDS, liveShards, shardShapes } from "@shared/scenes/singularity";
import { clamp01, createMoteCloud, mergeParts, smoothstep } from "./kit";
import type { SceneDefinition, SceneSound } from "./types";

/** What the state says at a frame (`SINGULARITY.view`). */
interface View {
  time: number;
  orbit: number;
  inclination: number;
  jetPower: number;
  fov: number;
  radius: number[];
  angle: number[];
  drift: number;
}
/** Stacked copies of the ring that give the disk a vertical scale height. */
const DISK_LAYERS = 14;
const JET_LENGTH = 115;

/** Hash + value noise, shared by the sky, the disk and the jets. */
const NOISE = /* glsl */ `
  float hash13(vec3 p) {
    p = fract(p * 0.1031);
    p += dot(p, p.yzx + 33.33);
    return fract((p.x + p.y) * p.z);
  }
  float hash12(vec2 p) {
    vec3 q = fract(vec3(p.xyx) * 0.1031);
    q += dot(q, q.yzx + 33.33);
    return fract((q.x + q.y) * q.z);
  }
  float noise2(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(hash12(i), hash12(i + vec2(1.0, 0.0)), f.x),
      mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), f.x),
      f.y
    );
  }
  float fbm(vec2 p) {
    float total = 0.0;
    float amplitude = 0.5;
    for (int i = 0; i < 4; i++) {
      total += noise2(p) * amplitude;
      p *= 2.03;
      amplitude *= 0.5;
    }
    return total;
  }
`;

/**
 * The disk, as a stack of rings. A single flat annulus vanishes into a red hairline
 * the moment the camera drops into its plane — which is exactly the angle worth
 * looking at — so the geometry carries a layer index and the vertex shader flares
 * the stack outward into a real scale height.
 */
function buildDiskGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < DISK_LAYERS; i += 1) {
    const ring = new THREE.RingGeometry(DISK_INNER, DISK_OUTER, 152, 36);
    const layer = -1 + (2 * i) / (DISK_LAYERS - 1);
    const count = ring.getAttribute("position").count;
    ring.setAttribute(
      "aLayer",
      new THREE.BufferAttribute(new Float32Array(count).fill(layer), 1),
    );
    parts.push(ring);
  }
  return mergeParts(parts);
}

/** An irregular rock: an icosahedron with every vertex knocked out of place. */
function buildShardGeometry(): THREE.BufferGeometry {
  const geometry = new THREE.IcosahedronGeometry(1, 1);
  const position = geometry.getAttribute("position") as THREE.BufferAttribute;
  // Vertices are shared by index, so displace along a hash of the *direction*
  // and the faces stay welded.
  const vertex = new THREE.Vector3();
  for (let i = 0; i < position.count; i += 1) {
    vertex.fromBufferAttribute(position, i);
    const key =
      Math.abs(Math.sin(vertex.x * 12.9898 + vertex.y * 78.233 + vertex.z * 37.719));
    const scale = 0.62 + (key % 1) * 0.7;
    vertex.multiplyScalar(scale);
    position.setXYZ(i, vertex.x, vertex.y, vertex.z);
  }
  geometry.computeVertexNormals();
  return geometry;
}

type Shard = {
  /** Orbital plane tilt, so the inspiral is a shell rather than a ring. */
  tilt: number;
  node: number;
  size: number;
  spin: THREE.Vector3;
};

export const singularity: SceneDefinition<View> = {
  type: "singularity",
  environment: {
    top: "#1a1206",
    bottom: "#02040c",
    glow: "#2a1608",
    bar: "#ffd9a0",
    bars: 4,
    blur: 0.05,
  },
  look: {
    exposure: 1,
    bloom: { strength: 0.45, radius: 0.7, threshold: 0.66 },
  },

  build(ctx) {
    const { scene, camera, palette } = ctx;

    /* ------------------------------- palette -------------------------------- */

    const hot = palette.shade("#fff4d2", 0.1);
    const warm = palette.shade("#ff9a3c", 0.55);
    const cool = palette.shade("#ff4d2e", 0.95);
    const jetColor = palette.shade("#8fd8ff", 0.05);
    const starColor = palette.shade("#dce8ff", 0.2);

    scene.background = new THREE.Color(0x000000);

    /* ------------------------------ lensed sky ------------------------------ */

    // Centred on the camera every frame, so a fragment's direction from the
    // sphere origin *is* its view ray.
    const sky = new THREE.Mesh(
      ctx.track(new THREE.SphereGeometry(420, 40, 26)),
      ctx.track(
        new THREE.ShaderMaterial({
          side: THREE.BackSide,
          depthWrite: false,
          depthTest: false,
          uniforms: {
            uHoleDir: { value: new THREE.Vector3(0, 0, -1) },
            uDistance: { value: 100 },
            uRs: { value: RS },
            uStar: { value: starColor.clone() },
            uNebula: { value: warm.clone() },
            uRing: { value: hot.clone() },
            uRingGain: { value: 1 },
          },
          vertexShader: /* glsl */ `
            varying vec3 vDir;
            void main() {
              vDir = position;
              gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
          `,
          fragmentShader: /* glsl */ `
            uniform vec3 uHoleDir;
            uniform float uDistance;
            uniform float uRs;
            uniform vec3 uStar;
            uniform vec3 uNebula;
            uniform vec3 uRing;
            uniform float uRingGain;
            varying vec3 vDir;
            ${NOISE}

            /** One sparse layer of stars, addressed by direction. */
            float starLayer(vec3 d, float density, float cut) {
              vec3 p = d * density;
              vec3 cell = floor(p);
              vec3 f = fract(p) - 0.5;
              float h = hash13(cell);
              if (h < cut) return 0.0;
              // Jitter the star inside its cell so the grid never shows.
              vec3 offset = vec3(
                hash13(cell + 11.0), hash13(cell + 23.0), hash13(cell + 37.0)
              ) - 0.5;
              float r = length(f - offset * 0.7);
              return smoothstep(0.42, 0.0, r) * (0.35 + 0.65 * fract(h * 137.0));
            }

            void main() {
              vec3 d = normalize(vDir);
              vec3 h = uHoleDir;
              float cosT = clamp(dot(d, h), -1.0, 1.0);
              float theta = acos(cosT);
              // Impact parameter of this ray against the hole.
              float b = uDistance * sin(theta);
              float shadow = 2.598 * uRs;

              // Deflect the ray toward the hole before sampling the sky. Weak
              // field is 2rs/b; near the photon sphere it is much larger, which
              // is what smears the background into the ring.
              float alpha = 2.0 * uRs / max(b, shadow * 0.9);
              vec3 axis = cross(d, h);
              float axisLength = length(axis);
              vec3 bent = d;
              if (axisLength > 1e-5) {
                axis /= axisLength;
                float c = cos(alpha);
                float s = sin(alpha);
                bent = d * c + cross(axis, d) * s + axis * dot(axis, d) * (1.0 - c);
              }

              float stars =
                starLayer(bent, 190.0, 0.9955) * 1.0 +
                starLayer(bent, 95.0, 0.9975) * 1.6 +
                starLayer(bent, 340.0, 0.9975) * 0.5;

              // A dust lane, warped by the same deflection.
              float cloud = fbm(bent.xy * 2.2 + bent.z * 1.4);
              cloud = pow(smoothstep(0.45, 0.95, cloud), 2.0);

              vec3 color = uStar * stars * 2.2 + uNebula * cloud * 0.07;

              // Einstein ring: light that grazed the photon sphere and came back.
              float ring = exp(-max(0.0, b - shadow) / (0.32 * uRs));
              color += uRing * ring * 0.55 * uRingGain;

              // Inside the capture radius nothing escapes.
              color *= smoothstep(shadow * 0.94, shadow * 1.03, b);

              gl_FragColor = vec4(color, 1.0);
            }
          `,
        }),
      ),
    );
    sky.frustumCulled = false;
    sky.renderOrder = -10;
    scene.add(sky);

    /* ------------------------------- the hole ------------------------------- */

    // An opaque billboard the exact size of the shadow. It writes depth, so the
    // half of the disk passing behind the hole is correctly swallowed while the
    // near half still draws in front.
    const shadowDisk = new THREE.Mesh(
      ctx.track(new THREE.CircleGeometry(SHADOW, 64)),
      ctx.track(new THREE.MeshBasicMaterial({ color: 0x000000, toneMapped: false })),
    );
    shadowDisk.renderOrder = 0;
    scene.add(shadowDisk);

    /* ----------------------------- accretion disk --------------------------- */

    const diskUniforms = {
      uTime: { value: 0 },
      uInner: { value: DISK_INNER },
      uOuter: { value: DISK_OUTER },
      uHot: { value: hot.clone() },
      uWarm: { value: warm.clone() },
      uCool: { value: cool.clone() },
      uTurbulence: { value: 0.5 },
      uBrightness: { value: 1 },
      uBeat: { value: 0 },
      uHeight: { value: 1.0 },
    };
    const disk = new THREE.Mesh(
      ctx.track(buildDiskGeometry()),
      ctx.track(
        new THREE.ShaderMaterial({
          side: THREE.DoubleSide,
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          uniforms: diskUniforms,
          vertexShader: /* glsl */ `
            attribute float aLayer;
            uniform float uInner;
            uniform float uHeight;
            varying vec3 vWorld;
            varying vec3 vToCamera;
            varying float vLayer;
            void main() {
              vLayer = aLayer;
              vec3 p = position;
              // The ring lies in local XY and the mesh is turned into the world
              // XZ plane, so local +Z is the disk normal. Flare the stack with
              // radius: real disks are thin inside and puffy outside.
              float r = length(position.xy);
              p.z += aLayer * uHeight * pow(r / uInner, 1.05);
              vec4 world = modelMatrix * vec4(p, 1.0);
              vWorld = world.xyz;
              vToCamera = normalize(cameraPosition - world.xyz);
              gl_Position = projectionMatrix * viewMatrix * world;
            }
          `,
          fragmentShader: /* glsl */ `
            uniform float uTime;
            uniform float uInner;
            uniform float uOuter;
            uniform vec3 uHot;
            uniform vec3 uWarm;
            uniform vec3 uCool;
            uniform float uTurbulence;
            uniform float uBrightness;
            uniform float uBeat;
            varying vec3 vWorld;
            varying vec3 vToCamera;
            varying float vLayer;
            ${NOISE}

            void main() {
              float r = length(vWorld.xz);
              float angle = atan(vWorld.z, vWorld.x);

              // Keplerian shear: the inner edge laps the outer one, which is what
              // winds the plasma into spirals instead of turning it as a plate.
              float omega = pow(uInner / max(r, uInner), 1.5);
              float wound = angle * 4.0 + uTime * omega * 3.4;
              // Offsetting by layer decorrelates the sheets, so the stack reads
              // as turbulent gas rather than seven printed copies.
              float density =
                fbm(vec2(wound + vLayer * 2.4, r * 0.55 - uTime * 0.35)) * 0.7 +
                fbm(vec2(wound * 2.7, r * 1.4 + uTime * 0.2 + vLayer * 5.0)) * 0.3;
              density = pow(clamp(density * (0.75 + uTurbulence), 0.0, 1.0), 1.5);

              // Relativistic beaming: the limb rotating toward the camera is
              // boosted, the receding one is dimmed. This is the asymmetry that
              // tells you the disk is spinning and not just glowing.
              vec3 velocity = normalize(vec3(-vWorld.z, 0.0, vWorld.x));
              float beta = 0.52 * sqrt(uInner / max(r, uInner));
              float doppler = pow(clamp(1.0 + beta * dot(velocity, vToCamera), 0.05, 2.4), 3.0);

              // Temperature falls off outward; the inner edge is nearly white.
              float t = smoothstep(uInner, uOuter * 0.55, r);
              vec3 color = mix(uHot, uWarm, smoothstep(0.0, 0.5, t));
              color = mix(color, uCool, smoothstep(0.45, 1.0, t));
              color += uHot * exp(-(r - uInner) / (uInner * 0.45)) * 0.9;

              float edges =
                smoothstep(uInner, uInner * 1.18, r) *
                (1.0 - smoothstep(uOuter * 0.72, uOuter, r));
              // Thinning toward the faces keeps the slab soft-edged, and the
              // layers have to share one disk's worth of light between them.
              // Path length through the slab. Stacked sheets under-report it
              // badly at grazing angles — the flat middle sheet projects to a
              // hairline and leaves a dark lane down the midplane — so scale by
              // 1/cos(theta), which is what a real volume integral would give.
              float slab = clamp(0.35 / max(abs(vToCamera.y), 0.05), 1.0, 4.0);
              float alpha = density * edges * exp(-vLayer * vLayer * 1.5) * 0.3 * slab;

              gl_FragColor = vec4(
                color * alpha * doppler * uBrightness * (1.0 + uBeat * 0.7),
                alpha * 0.85
              );
            }
          `,
        }),
      ),
    );
    disk.rotation.x = -Math.PI * 0.5;
    disk.renderOrder = 2;
    scene.add(disk);

    // The lensed image of the disk's far side, arcing over and under the shadow.
    // It is a camera-facing annulus because that is what the real thing is: an
    // image wrapped around the photon sphere, not a body sitting in space.
    const haloUniforms = {
      uTime: { value: 0 },
      uInnerRadius: { value: SHADOW * 1.02 },
      uOuterRadius: { value: SHADOW * 1.85 },
      uHot: { value: hot.clone() },
      uWarm: { value: warm.clone() },
      uBrightness: { value: 1 },
      uTurbulence: { value: 0.5 },
      /** 1 when the camera sits in the disk plane, 0 when looking straight down. */
      uEdgeOn: { value: 1 },
    };
    const halo = new THREE.Mesh(
      ctx.track(new THREE.RingGeometry(SHADOW * 1.0, SHADOW * 1.9, 160, 8)),
      ctx.track(
        new THREE.ShaderMaterial({
          side: THREE.DoubleSide,
          transparent: true,
          depthWrite: false,
          depthTest: false,
          blending: THREE.AdditiveBlending,
          uniforms: haloUniforms,
          vertexShader: /* glsl */ `
            varying vec2 vLocal;
            void main() {
              vLocal = position.xy;
              gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
          `,
          fragmentShader: /* glsl */ `
            uniform float uTime;
            uniform float uInnerRadius;
            uniform float uOuterRadius;
            uniform vec3 uHot;
            uniform vec3 uWarm;
            uniform float uBrightness;
            uniform float uTurbulence;
            uniform float uEdgeOn;
            varying vec2 vLocal;
            ${NOISE}

            void main() {
              float r = length(vLocal);
              float angle = atan(vLocal.y, vLocal.x);

              // Material near the photon sphere orbits fast, so the arc streaks.
              float density =
                fbm(vec2(angle * 5.0 + uTime * 2.6, r * 1.2 - uTime * 0.8)) * 0.75 +
                fbm(vec2(angle * 11.0 - uTime * 1.4, r * 2.4)) * 0.25;
              density = pow(clamp(density * (0.8 + uTurbulence), 0.0, 1.0), 1.4);

              // Brightest hard against the shadow, gone by the outer edge.
              float radial =
                smoothstep(uInnerRadius * 0.99, uInnerRadius * 1.05, r) *
                pow(1.0 - smoothstep(uInnerRadius, uOuterRadius, r), 2.2);

              // Edge-on, the top and bottom arcs dominate; face-on it closes into
              // a full ring.
              float verticality = mix(1.0, abs(sin(angle)) * 0.85 + 0.15, uEdgeOn);

              float alpha = density * radial * verticality;
              vec3 color = mix(uWarm, uHot, radial);
              gl_FragColor = vec4(color * alpha * uBrightness * 2.4, alpha);
            }
          `,
        }),
      ),
    );
    halo.renderOrder = 3;
    scene.add(halo);

    /* --------------------------------- jets --------------------------------- */

    const jetUniforms = {
      uTime: { value: 0 },
      uColor: { value: jetColor.clone() },
      uIntensity: { value: 0.4 },
    };
    const jets: THREE.Mesh[] = [];
    const jetGeometry = ctx.track(
      new THREE.CylinderGeometry(0.5, 6.5, JET_LENGTH, 26, 24, true),
    );
    jetGeometry.translate(0, JET_LENGTH * 0.5, 0);
    const jetMaterial = ctx.track(
      new THREE.ShaderMaterial({
        side: THREE.DoubleSide,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        uniforms: jetUniforms,
        vertexShader: /* glsl */ `
          varying vec2 vUv;
          varying vec3 vNormal;
          varying vec3 vView;
          void main() {
            vUv = uv;
            vNormal = normalMatrix * normal;
            vec4 view = modelViewMatrix * vec4(position, 1.0);
            vView = -view.xyz;
            gl_Position = projectionMatrix * view;
          }
        `,
        fragmentShader: /* glsl */ `
          uniform float uTime;
          uniform vec3 uColor;
          uniform float uIntensity;
          varying vec2 vUv;
          varying vec3 vNormal;
          varying vec3 vView;
          ${NOISE}

          void main() {
            // Helical filaments streaming outward along the beam.
            float helix = fbm(vec2(vUv.x * 9.0 + vUv.y * 5.0, vUv.y * 6.0 - uTime * 2.2));
            float along = pow(1.0 - vUv.y, 1.9);
            // Grazing angles only: a solid-shaded cylinder reads as a painted
            // bar, whereas a silhouette-weighted one reads as a hollow column
            // of light you can see through.
            float rim = pow(1.0 - abs(dot(normalize(vNormal), normalize(vView))), 1.4);
            float alpha = along * rim * (0.35 + helix * 1.0) * uIntensity * 1.3;
            gl_FragColor = vec4(uColor * alpha * 2.4, alpha * 0.75);
          }
        `,
      }),
    );
    for (const direction of [1, -1]) {
      const jet = new THREE.Mesh(jetGeometry, jetMaterial);
      jet.scale.y = direction;
      jet.frustumCulled = false;
      jet.renderOrder = 1;
      jets.push(jet);
      scene.add(jet);
    }

    /* -------------------------------- debris -------------------------------- */

    const shardMaterial = ctx.track(
      new THREE.MeshStandardMaterial({
        color: palette.shade("#1c1410", 0.6),
        emissive: warm.clone(),
        emissiveIntensity: 0.05,
        roughness: 0.75,
        metalness: 0.35,
        flatShading: true,
        // Opaque draws always precede transparent ones whatever renderOrder
        // says, so the rocks have to join the transparent queue to be ordered
        // after the disk. depthWrite stays on: they still occlude each other.
        transparent: true,
        depthWrite: true,
      }),
    );
    const shards = new THREE.InstancedMesh(
      ctx.track(buildShardGeometry()),
      shardMaterial,
      SHARDS,
    );
    shards.frustumCulled = false;
    // Drawn after the disk: the rocks are opaque and write depth, so at edge-on
    // they otherwise punch a black seam straight through the additive gas they
    // are supposed to be embedded in. The shadow still swallows the ones behind
    // the hole, because that billboard wrote depth first.
    shards.renderOrder = 4;
    scene.add(shards);

    // The shards' shapes are the state's (shared/scenes/singularity.ts), so their orbits match.
    const shardList: Shard[] = shardShapes().shapes.map((shape) => ({ ...shape, spin: new THREE.Vector3(...shape.spin) }));

    // A point light at the inner edge stands in for the disk illuminating its
    // own debris; without it the shards read as flat silhouettes.
    const diskLight = new THREE.PointLight(hot.clone(), 420, 260, 1.7);
    scene.add(diskLight);
    scene.add(new THREE.HemisphereLight(0x30201a, 0x05060c, 0.35));

    const dust = createMoteCloud(ctx, {
      count: 900,
      extent: new THREE.Vector3(120, 70, 120),
      color: "#ffd9a8",
      size: 0.4,
    });
    scene.add(dust.object);

    /* -------------------------------- state --------------------------------- */

    const holeDirection = new THREE.Vector3();
    const shardPosition = new THREE.Vector3();
    const radial = new THREE.Vector3();
    const tangential = new THREE.Vector3();
    const normal = new THREE.Vector3();
    const shardMatrix = new THREE.Matrix4();
    const drift = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    const euler = new THREE.Euler();
    const scaleVector = new THREE.Vector3();
    const spinMatrix = new THREE.Matrix4();

    camera.position.set(0, 8, 100);

    return {
      update(view: View & SceneSound) {
        const audio = view;
        const { time, orbit, inclination } = view;
        const detail = clamp01(ctx.detail);
        const live = Math.min(liveShards(detail), view.radius.length);

        /* -------------------------------- camera --------------------------- */

        // A low, slow orbit: near the disk plane the lensing and the beaming are
        // both at their most extreme, which is the whole reason to be here.
        const distance = 96 + Math.sin(time * 0.09) * 12 - audio.punch * 6;
        camera.position.set(
          Math.cos(orbit) * distance * Math.cos(inclination),
          Math.sin(inclination) * distance,
          Math.sin(orbit) * distance * Math.cos(inclination),
        );
        camera.lookAt(
          Math.sin(time * 0.13) * 3,
          Math.sin(time * 0.11) * 2,
          Math.cos(time * 0.17) * 3,
        );
        camera.rotation.z += Math.sin(time * 0.08) * 0.1 + audio.beat * 0.03;
        camera.fov = view.fov;
        camera.updateMatrixWorld();

        sky.position.copy(camera.position);
        holeDirection.copy(camera.position).negate().normalize();
        const skyUniforms = (sky.material as THREE.ShaderMaterial).uniforms;
        skyUniforms.uHoleDir.value.copy(holeDirection);
        skyUniforms.uDistance.value = camera.position.length();
        skyUniforms.uRingGain.value = 0.55 + audio.level * 0.45 + audio.beat * 0.6;

        // Shadow and halo are images, not objects: they always face the lens.
        shadowDisk.quaternion.copy(camera.quaternion);
        halo.quaternion.copy(camera.quaternion);

        /* --------------------------------- disk ---------------------------- */

        diskUniforms.uTime.value = time;
        diskUniforms.uTurbulence.value = 0.35 + audio.mid * 0.7 + audio.punch * 0.5;
        diskUniforms.uBrightness.value = 0.7 + audio.bass * 0.55 + audio.level * 0.25;
        diskUniforms.uBeat.value = audio.beat;

        haloUniforms.uTime.value = time;
        haloUniforms.uTurbulence.value = diskUniforms.uTurbulence.value;
        haloUniforms.uBrightness.value = 0.4 + audio.bass * 0.4 + audio.beat * 0.35;
        // How close the camera is to the disk plane, 1 = edge on.
        haloUniforms.uEdgeOn.value =
          1 - smoothstep(0.15, 0.9, Math.abs(Math.sin(inclination)));

        diskLight.position.set(
          Math.cos(time * 0.8) * DISK_INNER * 1.2,
          0,
          Math.sin(time * 0.8) * DISK_INNER * 1.2,
        );
        diskLight.intensity = 340 + audio.level * 520 + audio.beat * 380;

        /* --------------------------------- jets ---------------------------- */

        jetUniforms.uTime.value = time;
        jetUniforms.uIntensity.value = view.jetPower * (0.4 + audio.level * 0.5);

        /* -------------------------------- debris --------------------------- */

        shards.count = live;
        for (let i = 0; i < live; i += 1) {
          const shard = shardList[i];
          const r = view.radius[i];
          const cos = Math.cos(view.angle[i]);
          const sin = Math.sin(view.angle[i]);
          shardPosition.set(cos * r, 0, sin * r);
          // Tilt the orbit about its own line of nodes.
          shardPosition.applyAxisAngle(
            normal.set(Math.cos(shard.node), 0, Math.sin(shard.node)),
            shard.tilt,
          );

          // Tidal stretching: strung out along the direction of travel as it
          // nears the horizon, and squeezed across it.
          const fall = smoothstep(DISK_INNER * 2.2, SHADOW, r);
          const stretch = 1 + fall * fall * 9;
          radial.copy(shardPosition).normalize();
          tangential.set(-radial.z, 0, radial.x).normalize();
          normal.crossVectors(radial, tangential).normalize();

          euler.set(
            shard.spin.x * time * 0.6,
            shard.spin.y * time * 0.6,
            shard.spin.z * time * 0.6,
          );
          quaternion.setFromEuler(euler);
          const size = shard.size * (1 - fall * 0.4);
          // Stretch along the orbit and squeeze across it — so it has to be
          // built in the orbit frame, with the tumble applied inside that.
          shardMatrix.makeBasis(
            scaleVector.copy(tangential).multiplyScalar(size * stretch),
            normal.clone().multiplyScalar(size * (1 - fall * 0.5)),
            radial.clone().multiplyScalar(size * (1 - fall * 0.5)),
          );
          shardMatrix.setPosition(shardPosition);
          spinMatrix.makeRotationFromQuaternion(quaternion);
          shardMatrix.multiply(spinMatrix);
          shards.setMatrixAt(i, shardMatrix);
        }
        shards.instanceMatrix.needsUpdate = true;
        shardMaterial.emissiveIntensity = 0.05 + audio.level * 0.16 + audio.beat * 0.2;

        /* ------------------------------- ambience -------------------------- */

        dust.setVisible(300 + detail * 600);
        dust.update(drift.set(0, 0, view.drift), camera.position);
        dust.material.opacity = 0.1 + audio.high * 0.2;

        ctx.post.bloom = 0.3 + audio.level * 0.22 + audio.beat * 0.3;
        ctx.post.exposure = 0.93 + audio.beat * 0.08;
      },
    };
  },
};
