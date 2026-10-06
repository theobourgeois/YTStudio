/**
 * Building blocks for 3D scenes' renderers (vaudio's kit). What moves over time comes from the state
 * (`shared/scenes/`): the dust and motes here are placed from how far they've drifted, never stepped.
 */
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { clamp01, smoothstep, wrap } from "@shared/scenes/kit";
import type { SceneContext } from "./types";

export { clamp01, smoothstep, wrap };

/**
 * Force a color to a fixed luminance, keeping its hue. Backdrops and fog have to
 * go through this: `palette.shade` will happily hand back a bright pick, and a
 * bright fog washes the whole world out no matter what else the scene does.
 */
export function dimTo(color: THREE.Color, luminance: number): THREE.Color {
  const current = Math.max(
    color.r * 0.2126 + color.g * 0.7152 + color.b * 0.0722,
    1e-4,
  );
  return color.multiplyScalar(luminance / current);
}

/** Evenly spread unit vectors over a sphere (no clustering at the poles). */
export function fibonacciDirections(count: number): THREE.Vector3[] {
  const golden = Math.PI * (3 - Math.sqrt(5));
  const out: THREE.Vector3[] = [];
  for (let i = 0; i < count; i += 1) {
    const y = 1 - (i / Math.max(1, count - 1)) * 2;
    const radius = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = golden * i;
    out.push(
      new THREE.Vector3(Math.cos(theta) * radius, y, Math.sin(theta) * radius),
    );
  }
  return out;
}

/**
 * Merge sub-geometries into one buffer so a whole prop (arch, column, plinth)
 * can be drawn as a single instanced mesh. Inputs are disposed.
 */
export function mergeParts(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  // The primitives disagree about indexing — Cylinder/Torus/Cone are indexed,
  // the polyhedra (Octahedron, Icosahedron, Shape) are not — and mergeGeometries
  // refuses a mixed list. Flatten to non-indexed only when the list is mixed.
  const indexed = parts.filter((part) => part.index !== null).length;
  let input = parts;
  let temporary: THREE.BufferGeometry[] = [];
  if (indexed > 0 && indexed < parts.length) {
    temporary = parts.map((part) =>
      part.index === null ? part : part.toNonIndexed(),
    );
    input = temporary;
  }

  const merged = mergeGeometries(input, false);
  for (const part of temporary) if (!parts.includes(part)) part.dispose();
  for (const part of parts) part.dispose();
  if (!merged) throw new Error("scene3d: could not merge geometry parts");
  return merged;
}

/** Soft round sprite for particles. */
export function softDotTexture(ctx: SceneContext, size = 64): THREE.Texture {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context2d = canvas.getContext("2d");
  if (context2d) {
    const gradient = context2d.createRadialGradient(
      size / 2,
      size / 2,
      0,
      size / 2,
      size / 2,
      size / 2,
    );
    gradient.addColorStop(0, "rgba(255,255,255,1)");
    gradient.addColorStop(0.35, "rgba(255,255,255,0.55)");
    gradient.addColorStop(1, "rgba(255,255,255,0)");
    context2d.fillStyle = gradient;
    context2d.fillRect(0, 0, size, size);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return ctx.track(texture);
}

export type DustField = {
  object: THREE.Points;
  /** Place the motes `travel` along (towards +Z, past a camera flying towards -Z), at `brightness`. */
  update(travel: number, brightness: number): void;
  /** Draw only the first `count` motes, so Detail stays live. */
  setVisible(count: number): void;
};

/** Additive motes filling a box around the origin: cheap atmospheric depth. */
export function createDustField(
  ctx: SceneContext,
  options: {
    count?: number;
    width?: number;
    height?: number;
    depth?: number;
    color?: THREE.ColorRepresentation;
    size?: number;
    /** Motes recycle before they get this close to the origin. */
    near?: number;
  } = {},
): DustField {
  const count = options.count ?? 800;
  const width = options.width ?? 26;
  const height = options.height ?? 16;
  const depth = options.depth ?? 180;
  const near = options.near ?? 7;
  const positions = new Float32Array(count * 3);
  const start = new Float32Array(count);
  const drift = new Float32Array(count);
  for (let i = 0; i < count; i += 1) {
    positions[i * 3] = (ctx.random() - 0.5) * width;
    positions[i * 3 + 1] = (ctx.random() - 0.5) * height;
    start[i] = -near - ctx.random() * (depth - near);
    positions[i * 3 + 2] = start[i];
    drift[i] = 0.4 + ctx.random() * 1.6;
  }

  const geometry = ctx.track(new THREE.BufferGeometry());
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const material = ctx.track(
    new THREE.PointsMaterial({
      size: options.size ?? 0.13,
      map: softDotTexture(ctx, 48),
      color: new THREE.Color(options.color ?? "#cfe4ff"),
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
    }),
  );
  const object = new THREE.Points(geometry, material);
  object.frustumCulled = false;

  return {
    object,
    update(travel, brightness) {
      const attribute = geometry.getAttribute("position") as THREE.BufferAttribute;
      const array = attribute.array as Float32Array;
      for (let i = 0; i < count; i += 1) array[i * 3 + 2] = wrap(start[i] + drift[i] * travel, -depth, depth - near);
      attribute.needsUpdate = true;
      material.opacity = brightness;
    },
    setVisible(visible) {
      geometry.setDrawRange(0, Math.max(0, Math.min(count, Math.round(visible))));
    },
  };
}

export type Ribbon = {
  mesh: THREE.Mesh;
  /** Write rib `i`: two edge points and the shared normal. */
  set(
    i: number,
    inner: THREE.Vector3,
    outer: THREE.Vector3,
    normal: THREE.Vector3,
  ): void;
  /** Call once after writing every rib. */
  commit(): void;
};

/**
 * A quad strip whose vertices are rewritten every frame — the way to get a
 * membrane (a fin, a banner, a warped disk) that actually flows, since no
 * amount of instancing will bend a surface along a curve.
 *
 * UVs run 0..1 along the strip and 0..1 across it.
 */
export function createRibbon(
  ctx: SceneContext,
  ribs: number,
  material: THREE.Material,
): Ribbon {
  const positions = new Float32Array(ribs * 6);
  const normals = new Float32Array(ribs * 6);
  const uvs = new Float32Array(ribs * 4);
  const indices: number[] = [];
  for (let i = 0; i < ribs; i += 1) {
    const u = i / (ribs - 1);
    uvs[i * 4] = u;
    uvs[i * 4 + 1] = 0;
    uvs[i * 4 + 2] = u;
    uvs[i * 4 + 3] = 1;
    if (i < ribs - 1) {
      const a = i * 2;
      indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }

  const geometry = ctx.track(new THREE.BufferGeometry());
  const positionAttribute = new THREE.BufferAttribute(positions, 3);
  const normalAttribute = new THREE.BufferAttribute(normals, 3);
  positionAttribute.setUsage(THREE.DynamicDrawUsage);
  normalAttribute.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute("position", positionAttribute);
  geometry.setAttribute("normal", normalAttribute);
  geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(indices);

  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;

  return {
    mesh,
    set(i, inner, outer, normal) {
      const o = i * 6;
      positions[o] = inner.x;
      positions[o + 1] = inner.y;
      positions[o + 2] = inner.z;
      positions[o + 3] = outer.x;
      positions[o + 4] = outer.y;
      positions[o + 5] = outer.z;
      normals[o] = normals[o + 3] = normal.x;
      normals[o + 1] = normals[o + 4] = normal.y;
      normals[o + 2] = normals[o + 5] = normal.z;
    },
    commit() {
      positionAttribute.needsUpdate = true;
      normalAttribute.needsUpdate = true;
    },
  };
}

export type MoteCloud = {
  object: THREE.Points;
  material: THREE.PointsMaterial;
  /**
   * Place every mote `offset` from where it started (times its own rate), wrapped inside the box; `origin`
   * moves the box itself, so a free camera never flies out of the weather.
   */
  update(offset: THREE.Vector3, origin?: THREE.Vector3): void;
  /** Draw only the first `count` motes, so Detail stays live. */
  setVisible(count: number): void;
};

/**
 * A box of additive motes that wraps in all three axes. Unlike `createDustField`
 * this has no forward axis, so it suits a camera that looks anywhere: snow,
 * embers, drifting debris.
 */
export function createMoteCloud(
  ctx: SceneContext,
  options: {
    count?: number;
    /** Half-extents of the wrap box. */
    extent?: THREE.Vector3;
    color?: THREE.ColorRepresentation;
    size?: number;
  } = {},
): MoteCloud {
  const count = options.count ?? 900;
  const extent = options.extent ?? new THREE.Vector3(40, 40, 40);
  const positions = new Float32Array(count * 3);
  const start = new Float32Array(count * 3);
  const rate = new Float32Array(count);
  for (let i = 0; i < count; i += 1) {
    start[i * 3] = (ctx.random() - 0.5) * 2 * extent.x;
    start[i * 3 + 1] = (ctx.random() - 0.5) * 2 * extent.y;
    start[i * 3 + 2] = (ctx.random() - 0.5) * 2 * extent.z;
    rate[i] = 0.35 + ctx.random() * 1.5;
  }
  positions.set(start);

  const geometry = ctx.track(new THREE.BufferGeometry());
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const material = ctx.track(
    new THREE.PointsMaterial({
      size: options.size ?? 0.12,
      map: softDotTexture(ctx, 48),
      color: new THREE.Color(options.color ?? "#cfe4ff"),
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
    }),
  );
  const object = new THREE.Points(geometry, material);
  object.frustumCulled = false;

  return {
    object,
    material,
    update(offset, origin) {
      const attribute = geometry.getAttribute("position") as THREE.BufferAttribute;
      const array = attribute.array as Float32Array;
      for (let i = 0; i < count; i += 1) {
        const o = i * 3;
        array[o] = wrap(start[o] + offset.x * rate[i], -extent.x, extent.x * 2);
        array[o + 1] = wrap(start[o + 1] + offset.y * rate[i], -extent.y, extent.y * 2);
        array[o + 2] = wrap(start[o + 2] + offset.z * rate[i], -extent.z, extent.z * 2);
      }
      attribute.needsUpdate = true;
      if (origin) object.position.copy(origin);
    },
    setVisible(visible) {
      geometry.setDrawRange(0, Math.max(0, Math.min(count, Math.round(visible))));
    },
  };
}

/** Hollow cone that fades out along its length — a light shaft / god ray. */
export function createLightShaft(
  ctx: SceneContext,
  options: { length?: number; spread?: number; color?: THREE.ColorRepresentation } = {},
): THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial> {
  const length = options.length ?? 30;
  const geometry = ctx.track(
    new THREE.CylinderGeometry(0.06, options.spread ?? 3, length, 18, 1, true),
  );
  geometry.translate(0, -length / 2, 0);
  const material = ctx.track(
    new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      uniforms: {
        uColor: { value: new THREE.Color(options.color ?? "#9fd0ff") },
        uIntensity: { value: 0.5 },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor;
        uniform float uIntensity;
        varying vec2 vUv;
        void main() {
          // Bright at the source, gone by the far end; soft at the silhouette.
          float along = pow(clamp(vUv.y, 0.0, 1.0), 1.7);
          float edge = sin(vUv.x * 3.14159);
          gl_FragColor = vec4(uColor * uIntensity * along * edge, along * edge);
        }
      `,
    }),
  );
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  return mesh;
}
