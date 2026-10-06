// Tesseract Vault — a four-dimensional crystal, honestly computed.
//
// Every vertex here lives in 4-space. The scene keeps six rotation angles (one
// per coordinate plane, three of which involve W) and projects the result into
// 3D with a perspective divide on W, so parts of the structure genuinely swell,
// pass through each other and turn inside out — none of it is possible in three
// dimensions, and none of it is faked with keyframes.
//
// W is also the colour axis: warm means "toward you in the fourth dimension",
// cool means "away". Once you can see W, the rotation stops looking like a
// glitch and starts looking like a shape. Onsets kick the rotation into a new
// plane and fire a shockwave out through the surrounding lattice.

// Ported from vaudio: its state (the angles and their rates, the shockwaves, the hero's size, the
// camera's orbit and lens) is stepped in shared/scenes/tesseract.ts; this only shows it.

import * as THREE from "three";
import { clamp01, createMoteCloud, dimTo, mergeParts, smoothstep, softDotTexture } from "./kit";
import type { SceneDefinition, SceneSound } from "./types";

/** Viewer distance along W. Must exceed every |w| or the divide flips sign. */
const W_EYE = 2.9;
/** The six coordinate planes a 4D rotation can happen in. */
const PLANES: [number, number][] = [
  [0, 1], // XY — an ordinary spin
  [0, 2], // XZ
  [1, 2], // YZ
  [0, 3], // XW — the impossible ones
  [1, 3], // YW
  [2, 3], // ZW
];
const CELLS = 96;
/** Tesseract edges per lattice cell. */
const CELL_EDGES = 32;
const SHOCKWAVES = 5;

type Polytope = {
  /** Vertices as flat x,y,z,w. */
  points: Float32Array;
  count: number;
  /** Vertex index pairs. */
  edges: Int32Array;
};

/** The 8-cell: 16 vertices at (±1,±1,±1,±1), joined when they differ in one axis. */
function tesseractPolytope(): Polytope {
  const points = new Float32Array(16 * 4);
  for (let i = 0; i < 16; i += 1) {
    for (let axis = 0; axis < 4; axis += 1) {
      points[i * 4 + axis] = i & (1 << axis) ? 1 : -1;
    }
  }
  const edges: number[] = [];
  for (let a = 0; a < 16; a += 1) {
    for (let axis = 0; axis < 4; axis += 1) {
      const b = a ^ (1 << axis);
      if (b > a) edges.push(a, b);
    }
  }
  return { points, count: 16, edges: new Int32Array(edges) };
}

/**
 * The 24-cell: every permutation of (±1,±1,0,0). It has no 3D analogue at all —
 * self-dual, 24 vertices, 96 edges — which is exactly why it belongs here.
 */
function cell24(): Polytope {
  const list: number[] = [];
  for (let i = 0; i < 4; i += 1) {
    for (let j = i + 1; j < 4; j += 1) {
      for (const si of [-1, 1]) {
        for (const sj of [-1, 1]) {
          const vertex = [0, 0, 0, 0];
          vertex[i] = si;
          vertex[j] = sj;
          list.push(...vertex);
        }
      }
    }
  }
  const points = new Float32Array(list);
  const count = list.length / 4;
  const edges: number[] = [];
  for (let a = 0; a < count; a += 1) {
    for (let b = a + 1; b < count; b += 1) {
      let squared = 0;
      for (let axis = 0; axis < 4; axis += 1) {
        const d = points[a * 4 + axis] - points[b * 4 + axis];
        squared += d * d;
      }
      // Nearest-neighbour distance in the 24-cell is exactly sqrt(2).
      if (Math.abs(squared - 2) < 1e-6) edges.push(a, b);
    }
  }
  return { points, count, edges: new Int32Array(edges) };
}

/** The tesseract's 24 square faces: two axes vary, the other two are pinned. */
function tesseractFaces(): Int32Array {
  const faces: number[] = [];
  const indexOf = (v: number[]) =>
    (v[0] > 0 ? 1 : 0) | (v[1] > 0 ? 2 : 0) | (v[2] > 0 ? 4 : 0) | (v[3] > 0 ? 8 : 0);
  for (let i = 0; i < 4; i += 1) {
    for (let j = i + 1; j < 4; j += 1) {
      const fixed = [0, 1, 2, 3].filter((axis) => axis !== i && axis !== j);
      for (const sa of [-1, 1]) {
        for (const sb of [-1, 1]) {
          const corner = [0, 0, 0, 0];
          corner[fixed[0]] = sa;
          corner[fixed[1]] = sb;
          // Wound around the square, not across it.
          for (const [di, dj] of [
            [-1, -1],
            [1, -1],
            [1, 1],
            [-1, 1],
          ]) {
            corner[i] = di;
            corner[j] = dj;
            faces.push(indexOf(corner));
          }
        }
      }
    }
  }
  return new Int32Array(faces);
}

/**
 * Map a projection factor onto 0..1 across the whole W range a unit polytope can
 * reach, so both ends of the colour axis actually get used.
 */
function wDepth(nearness: number): number {
  const near = W_EYE / (W_EYE - 1);
  const far = W_EYE / (W_EYE + 1);
  return clamp01((nearness - far) / (near - far));
}

/** Rotate 4D points through all six planes, in place from `source` to `target`. */
function rotate4(
  source: Float32Array,
  target: Float32Array,
  count: number,
  angles: Float32Array,
): void {
  target.set(source.subarray(0, count * 4));
  for (let p = 0; p < PLANES.length; p += 1) {
    const angle = angles[p];
    if (Math.abs(angle) < 1e-6) continue;
    const [u, v] = PLANES[p];
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    for (let i = 0; i < count; i += 1) {
      const o = i * 4;
      const a = target[o + u];
      const b = target[o + v];
      target[o + u] = a * cos - b * sin;
      target[o + v] = a * sin + b * cos;
    }
  }
}

/** A node: an octahedral core inside three orthogonal rings, like a gimbal. */
function buildNodeGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [new THREE.OctahedronGeometry(0.5, 0)];
  const rings: [number, number][] = [
    [0, 0],
    [Math.PI * 0.5, 0],
    [0, Math.PI * 0.5],
  ];
  for (const [rx, ry] of rings) {
    const ring = new THREE.TorusGeometry(0.8, 0.055, 4, 18);
    ring.rotateX(rx);
    ring.rotateY(ry);
    parts.push(ring);
  }
  return mergeParts(parts);
}

/**
 * A beam of total length exactly 1 along Y, tapered at both ends. The length
 * has to be exact: the instance matrix scales Y by the edge length, so any
 * overhang in the geometry shows up as a spike past every vertex.
 */
function buildBeamGeometry(sides: number): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [
    new THREE.CylinderGeometry(0.5, 0.5, 0.8, sides, 1),
  ];
  for (const end of [-1, 1]) {
    const cap = new THREE.ConeGeometry(0.5, 0.2, sides);
    cap.scale(1, end, 1);
    cap.translate(0, end * 0.4, 0);
    parts.push(cap);
  }
  return mergeParts(parts);
}

type Cell = {
  position: THREE.Vector3;
  scale: number;
  /** Distance from the origin — drives when a shockwave reaches it. */
  radius: number;
  phase: number;
  /** Fixed 3D orientation — the 4D pose is shared, the framing should not be. */
  tilt: THREE.Quaternion;
};

/** What the state says at a frame (`TESSERACT.view`). */
interface View {
  time: number;
  angles: number[];
  shockwaves: number[];
  heroScale: number;
  orbit: number;
  fov: number;
  drift: number;
}

export const tesseract: SceneDefinition<View> = {
  type: "tesseract",
  environment: {
    top: "#141d3e",
    bottom: "#03030a",
    glow: "#1a1440",
    bar: "#cfe0ff",
    bars: 9,
    blur: 0.015,
  },
  look: {
    exposure: 0.98,
    bloom: { strength: 0.55, radius: 0.65, threshold: 0.55 },
  },

  build(ctx) {
    const { scene, camera, palette } = ctx;

    /* ------------------------------- palette -------------------------------- */

    // The two ends of the W axis. Everything else is a mix of these, so the
    // fourth dimension stays legible no matter what the colour pickers do.
    const nearW = palette.shade("#ff5ce0", 0.95);
    const farW = palette.shade("#39d8ff", 0.05);
    const metal = palette.shade("#8fa6c8", 0.4);
    const voidColor = dimTo(palette.shade("#05060f", 0.35), 0.006);

    scene.background = voidColor.clone();
    scene.fog = new THREE.FogExp2(voidColor.getHex(), 0.016);

    scene.add(new THREE.HemisphereLight(0x6f8dff, 0x120a2a, 0.65));
    const keyLight = new THREE.PointLight(nearW.clone(), 260, 120, 1.7);
    keyLight.position.set(14, 18, 16);
    scene.add(keyLight);
    const rimLight = new THREE.PointLight(farW.clone(), 220, 120, 1.7);
    rimLight.position.set(-18, -10, -14);
    scene.add(rimLight);

    /* ------------------------------ geometry -------------------------------- */

    const outer = cell24();
    const inner = tesseractPolytope();
    const faces = tesseractFaces();

    const outerRotated = new Float32Array(outer.count * 4);
    const innerRotated = new Float32Array(inner.count * 4);
    const outerProjected = new Float32Array(outer.count * 3);
    const innerProjected = new Float32Array(inner.count * 3);
    /** Perspective factor per vertex — how near it is along W. */
    const outerNearness = new Float32Array(outer.count);
    const innerNearness = new Float32Array(inner.count);

    const beamGeometry = ctx.track(buildBeamGeometry(6));
    const beamMaterial = ctx.track(
      new THREE.MeshBasicMaterial({ toneMapped: false }),
    );
    const outerEdgeCount = outer.edges.length / 2;
    const innerEdgeCount = inner.edges.length / 2;
    const heroBeams = new THREE.InstancedMesh(
      beamGeometry,
      beamMaterial,
      outerEdgeCount + innerEdgeCount,
    );
    heroBeams.frustumCulled = false;
    scene.add(heroBeams);

    const nodeMaterial = ctx.track(
      new THREE.MeshPhysicalMaterial({
        color: metal,
        metalness: 1,
        roughness: 0.16,
        clearcoat: 1,
        clearcoatRoughness: 0.1,
        envMapIntensity: 2.2,
      }),
    );
    const nodes = new THREE.InstancedMesh(
      ctx.track(buildNodeGeometry()),
      nodeMaterial,
      outer.count + inner.count,
    );
    nodes.frustumCulled = false;
    scene.add(nodes);

    // The tesseract's 24 square faces, as additive glass. Their vertices are
    // rewritten every frame from the projection — a static mesh cannot do this,
    // because in 3D these squares do not stay square.
    const faceCount = faces.length / 4;
    const facePositions = new Float32Array(faceCount * 4 * 3);
    const faceColors = new Float32Array(faceCount * 4 * 3);
    const faceUvs = new Float32Array(faceCount * 4 * 2);
    const faceIndices: number[] = [];
    const CORNERS = [0, 0, 1, 0, 1, 1, 0, 1];
    for (let f = 0; f < faceCount; f += 1) {
      const o = f * 4;
      faceIndices.push(o, o + 1, o + 2, o, o + 2, o + 3);
      faceUvs.set(CORNERS, f * 8);
    }
    const faceGeometry = ctx.track(new THREE.BufferGeometry());
    const facePositionAttribute = new THREE.BufferAttribute(facePositions, 3);
    const faceColorAttribute = new THREE.BufferAttribute(faceColors, 3);
    facePositionAttribute.setUsage(THREE.DynamicDrawUsage);
    faceColorAttribute.setUsage(THREE.DynamicDrawUsage);
    faceGeometry.setAttribute("position", facePositionAttribute);
    faceGeometry.setAttribute("color", faceColorAttribute);
    faceGeometry.setAttribute("uv", new THREE.BufferAttribute(faceUvs, 2));
    faceGeometry.setIndex(faceIndices);
    const faceMesh: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial> = new THREE.Mesh(
      faceGeometry,
      // Filled squares stack into a solid blob; lighting only their rims keeps
      // all 24 faces readable while they pass through each other.
      ctx.track(
        new THREE.ShaderMaterial({
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          side: THREE.DoubleSide,
          uniforms: { uFill: { value: 0.04 }, uRim: { value: 0.6 } },
          vertexShader: /* glsl */ `
            attribute vec3 color;
            varying vec3 vColor;
            varying vec2 vUv;
            void main() {
              vColor = color;
              vUv = uv;
              gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
          `,
          fragmentShader: /* glsl */ `
            uniform float uFill;
            uniform float uRim;
            varying vec3 vColor;
            varying vec2 vUv;
            void main() {
              float edge = min(min(vUv.x, 1.0 - vUv.x), min(vUv.y, 1.0 - vUv.y));
              float rim = smoothstep(0.11, 0.0, edge);
              float alpha = uFill + rim * uRim;
              gl_FragColor = vec4(vColor * alpha, alpha);
            }
          `,
        }),
      ),
    );
    faceMesh.frustumCulled = false;
    scene.add(faceMesh);

    // A core inside the polytope: it lights the metal nodes from within, which
    // is what stops them reading as flat grey beads against the void.
    const coreLight = new THREE.PointLight(nearW.clone(), 0, 90, 1.6);
    scene.add(coreLight);
    const core = new THREE.Mesh(
      ctx.track(new THREE.IcosahedronGeometry(1, 3)),
      ctx.track(
        new THREE.MeshBasicMaterial({
          transparent: true,
          opacity: 0.85,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          toneMapped: false,
        }),
      ),
    );
    scene.add(core);

    /* ----------------------------- shockwaves ------------------------------- */

    // Each onset blows a rim-lit shell out through the lattice. Fresnel-only, so
    // it stays a surface you can see through rather than a wall of white.
    const shellGeometry = ctx.track(new THREE.IcosahedronGeometry(1, 4));
    const shells: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>[] = [];
    for (let i = 0; i < SHOCKWAVES; i += 1) {
      const material = ctx.track(
        new THREE.ShaderMaterial({
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          side: THREE.DoubleSide,
          uniforms: {
            uColor: { value: nearW.clone() },
            uIntensity: { value: 0 },
          },
          vertexShader: /* glsl */ `
            varying vec3 vNormal;
            varying vec3 vView;
            void main() {
              vNormal = normalMatrix * normal;
              vec4 view = modelViewMatrix * vec4(position, 1.0);
              vView = -view.xyz;
              gl_Position = projectionMatrix * view;
            }
          `,
          fragmentShader: /* glsl */ `
            uniform vec3 uColor;
            uniform float uIntensity;
            varying vec3 vNormal;
            varying vec3 vView;
            void main() {
              float facing = abs(dot(normalize(vNormal), normalize(vView)));
              float rim = pow(1.0 - facing, 3.0);
              gl_FragColor = vec4(uColor * rim * uIntensity, rim * uIntensity);
            }
          `,
        }),
      );
      const shell = new THREE.Mesh(shellGeometry, material);
      shell.frustumCulled = false;
      shell.visible = false;
      shells.push(shell);
      scene.add(shell);
    }

    /* ------------------------------- lattice -------------------------------- */

    // A shell of smaller tesseracts filling the void, all sharing the hero's 4D
    // rotation, so the entire space turns through W together.
    const cells: Cell[] = [];
    for (let i = 0; i < CELLS; i += 1) {
      // Jittered spherical shell: a regular grid would read as a wallpaper.
      const radius = 36 + Math.pow(ctx.random(), 0.5) * 86;
      const theta = ctx.random() * Math.PI * 2;
      const y = (ctx.random() - 0.5) * 2;
      const ring = Math.sqrt(Math.max(0, 1 - y * y));
      cells.push({
        position: new THREE.Vector3(
          Math.cos(theta) * ring * radius,
          y * radius * 0.72,
          Math.sin(theta) * ring * radius,
        ),
        scale: 1.1 + ctx.random() * 2.4,
        radius,
        phase: ctx.random() * Math.PI * 2,
        tilt: new THREE.Quaternion().setFromEuler(
          new THREE.Euler(
            ctx.random() * Math.PI * 2,
            ctx.random() * Math.PI * 2,
            ctx.random() * Math.PI * 2,
          ),
        ),
      });
    }
    cells.sort((a, b) => a.radius - b.radius);

    const latticeMaterial = ctx.track(
      new THREE.MeshBasicMaterial({ toneMapped: false }),
    );
    const lattice = new THREE.InstancedMesh(
      ctx.track(buildBeamGeometry(3)),
      latticeMaterial,
      CELLS * CELL_EDGES,
    );
    lattice.frustumCulled = false;
    scene.add(lattice);

    /* ------------------------------- 4D dust -------------------------------- */

    // Motes that also live in 4-space: they swirl when the rotation changes
    // plane, which is what makes the *space* feel four-dimensional rather than
    // just the object sitting in it.
    const MOTES = 1400;
    const motePoints = new Float32Array(MOTES * 4);
    const moteRotated = new Float32Array(MOTES * 4);
    for (let i = 0; i < MOTES; i += 1) {
      for (let axis = 0; axis < 4; axis += 1) {
        motePoints[i * 4 + axis] = (ctx.random() - 0.5) * 2;
      }
      // Push out to a shell so the middle of the frame stays clear.
      const o = i * 4;
      let length = 0;
      for (let axis = 0; axis < 4; axis += 1) length += motePoints[o + axis] ** 2;
      length = Math.sqrt(length) || 1;
      const target = 0.55 + ctx.random() * 0.45;
      for (let axis = 0; axis < 4; axis += 1) {
        motePoints[o + axis] *= target / length;
      }
    }
    const moteGeometry = ctx.track(new THREE.BufferGeometry());
    const motePositions = new Float32Array(MOTES * 3);
    const motePositionAttribute = new THREE.BufferAttribute(motePositions, 3);
    motePositionAttribute.setUsage(THREE.DynamicDrawUsage);
    moteGeometry.setAttribute("position", motePositionAttribute);
    const moteMaterial = ctx.track(
      new THREE.PointsMaterial({
        size: 0.42,
        map: softDotTexture(ctx, 48),
        color: farW.clone(),
        transparent: true,
        opacity: 0.7,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        sizeAttenuation: true,
      }),
    );
    const moteField = new THREE.Points(moteGeometry, moteMaterial);
    moteField.frustumCulled = false;
    scene.add(moteField);

    const drift = createMoteCloud(ctx, {
      count: 900,
      extent: new THREE.Vector3(70, 50, 70),
      color: "#b9cdff",
      size: 0.16,
    });
    scene.add(drift.object);

    /* -------------------------------- state --------------------------------- */

    const angles = new Float32Array(PLANES.length);
    const offset = new THREE.Vector3();

    const dummy = new THREE.Object3D();
    const tint = new THREE.Color();
    const edgeTint = new THREE.Color();
    const from = new THREE.Vector3();
    const to = new THREE.Vector3();
    const axis = new THREE.Vector3();
    const axisX = new THREE.Vector3();
    const axisY = new THREE.Vector3();
    const axisZ = new THREE.Vector3();
    const beamMatrix = new THREE.Matrix4();
    const cellMatrix = new THREE.Matrix4();
    const localMatrix = new THREE.Matrix4();
    const worldMatrix = new THREE.Matrix4();
    const projected = new THREE.Vector3();
    const cellScale = new THREE.Vector3();
    const localEdges: THREE.Matrix4[] = [];
    for (let i = 0; i < CELL_EDGES; i += 1) localEdges.push(new THREE.Matrix4());


    /** Project one rotated 4D point, writing xyz and returning its W nearness. */
    function project(
      source: Float32Array,
      index: number,
      radius: number,
      out: Float32Array,
      outIndex: number,
    ): number {
      const o = index * 4;
      const nearness = W_EYE / (W_EYE - source[o + 3]);
      const k = radius * nearness;
      out[outIndex * 3] = source[o] * k;
      out[outIndex * 3 + 1] = source[o + 1] * k;
      out[outIndex * 3 + 2] = source[o + 2] * k;
      return nearness;
    }

    /** Lay a beam between two projected points; thickness rides W nearness. */
    function beam(
      positions: Float32Array,
      a: number,
      b: number,
      thickness: number,
      target: THREE.Matrix4,
    ): void {
      from.fromArray(positions, a * 3);
      to.fromArray(positions, b * 3);
      axis.copy(to).sub(from);
      const length = axis.length() || 1e-4;
      axis.multiplyScalar(1 / length);
      // Any perpendicular will do — a beam is rotationally symmetric.
      axisX.set(axis.y, -axis.x, 0);
      if (axisX.lengthSq() < 1e-6) axisX.set(1, 0, 0);
      axisX.normalize();
      axisZ.crossVectors(axisX, axis);
      target.makeBasis(
        axisX.multiplyScalar(thickness),
        axisY.copy(axis).multiplyScalar(length),
        axisZ.multiplyScalar(thickness),
      );
      target.setPosition(
        (from.x + to.x) * 0.5,
        (from.y + to.y) * 0.5,
        (from.z + to.z) * 0.5,
      );
    }

    return {
      update(view: View & SceneSound) {
        const audio = view;
        const { time, shockwaves, heroScale } = view;
        const detail = clamp01(ctx.detail);
        const liveCells = Math.round(24 + detail * (CELLS - 24));

        /* ---------------------------- 4D rotation -------------------------- */

        for (let p = 0; p < PLANES.length; p += 1) angles[p] = view.angles[p] ?? 0;
        rotate4(outer.points, outerRotated, outer.count, angles);
        rotate4(inner.points, innerRotated, inner.count, angles);

        for (let i = 0; i < outer.count; i += 1) {
          outerNearness[i] = project(outerRotated, i, heroScale, outerProjected, i);
        }
        for (let i = 0; i < inner.count; i += 1) {
          innerNearness[i] = project(
            innerRotated,
            i,
            heroScale * 0.52,
            innerProjected,
            i,
          );
        }

        /* ------------------------------- hero ------------------------------ */

        const glow = 0.55 + audio.level * 0.9 + audio.beat * 1.1;
        let slot = 0;
        for (let e = 0; e < outerEdgeCount; e += 1) {
          const a = outer.edges[e * 2];
          const b = outer.edges[e * 2 + 1];
          const w = wDepth((outerNearness[a] + outerNearness[b]) * 0.5);
          beam(outerProjected, a, b, 0.055 + w * 0.14, beamMatrix);
          heroBeams.setMatrixAt(slot, beamMatrix);
          heroBeams.setColorAt(
            slot,
            edgeTint.copy(farW).lerp(nearW, w).multiplyScalar(glow * (0.5 + w * 0.9)),
          );
          slot += 1;
        }
        for (let e = 0; e < innerEdgeCount; e += 1) {
          const a = inner.edges[e * 2];
          const b = inner.edges[e * 2 + 1];
          const w = wDepth((innerNearness[a] + innerNearness[b]) * 0.5);
          beam(innerProjected, a, b, 0.05 + w * 0.11, beamMatrix);
          heroBeams.setMatrixAt(slot, beamMatrix);
          heroBeams.setColorAt(
            slot,
            edgeTint
              .copy(nearW)
              .lerp(farW, w)
              .multiplyScalar(glow * (0.5 + audio.high * 0.8)),
          );
          slot += 1;
        }
        heroBeams.instanceMatrix.needsUpdate = true;
        if (heroBeams.instanceColor) heroBeams.instanceColor.needsUpdate = true;

        let nodeSlot = 0;
        for (const [points, nearness, count, size] of [
          [outerProjected, outerNearness, outer.count, 0.42],
          [innerProjected, innerNearness, inner.count, 0.3],
        ] as const) {
          for (let i = 0; i < count; i += 1) {
            projected.fromArray(points, i * 3);
            const w = wDepth(nearness[i]);
            dummy.position.copy(projected);
            dummy.rotation.set(time * 0.4 + i, time * 0.3, time * 0.22 + i * 0.5);
            dummy.scale.setScalar(size * (0.6 + w * 1.1) * (1 + audio.punch * 0.3));
            dummy.updateMatrix();
            nodes.setMatrixAt(nodeSlot, dummy.matrix);
            nodeSlot += 1;
          }
        }
        nodes.instanceMatrix.needsUpdate = true;

        // Faces: four projected corners each, tinted by their own W depth.
        for (let f = 0; f < faceCount; f += 1) {
          for (let c = 0; c < 4; c += 1) {
            const vertex = faces[f * 4 + c];
            const target = (f * 4 + c) * 3;
            facePositions[target] = innerProjected[vertex * 3];
            facePositions[target + 1] = innerProjected[vertex * 3 + 1];
            facePositions[target + 2] = innerProjected[vertex * 3 + 2];
            const w = wDepth(innerNearness[vertex]);
            tint
              .copy(farW)
              .lerp(nearW, w)
              .multiplyScalar(0.2 + w * 0.6 + audio.beat * 0.35);
            faceColors[target] = tint.r;
            faceColors[target + 1] = tint.g;
            faceColors[target + 2] = tint.b;
          }
        }
        facePositionAttribute.needsUpdate = true;
        faceColorAttribute.needsUpdate = true;

        /* ------------------------------ lattice ---------------------------- */

        // The cell shape is projected once, then stamped into every cell — the
        // whole lattice shares one 4D orientation for the cost of one.
        for (let i = 0; i < inner.count; i += 1) {
          project(innerRotated, i, 1, innerProjected, i);
        }
        for (let e = 0; e < CELL_EDGES; e += 1) {
          const a = inner.edges[e * 2];
          const b = inner.edges[e * 2 + 1];
          beam(innerProjected, a, b, 0.032, localEdges[e]);
        }

        lattice.count = liveCells * CELL_EDGES;
        for (let c = 0; c < liveCells; c += 1) {
          const cell = cells[c];
          let hit = 0;
          for (const wave of shockwaves) {
            hit += Math.max(0, 1 - Math.abs(cell.radius - wave) / 16);
          }
          const breathe = 1 + Math.sin(time * 0.9 + cell.phase) * 0.07 + hit * 0.5;
          cellMatrix.compose(
            cell.position,
            cell.tilt,
            cellScale.setScalar(cell.scale * breathe),
          );

          const brightness =
            0.14 +
            audio.bands[c % audio.bands.length] * 0.26 +
            hit * hit * 1.6 +
            audio.level * 0.12;
          edgeTint
            .copy(farW)
            .lerp(nearW, clamp01(hit * 0.8 + cell.phase * 0.05))
            .multiplyScalar(brightness);

          for (let e = 0; e < CELL_EDGES; e += 1) {
            worldMatrix.multiplyMatrices(cellMatrix, localMatrix.copy(localEdges[e]));
            const index = c * CELL_EDGES + e;
            lattice.setMatrixAt(index, worldMatrix);
            lattice.setColorAt(index, edgeTint);
          }
        }
        lattice.instanceMatrix.needsUpdate = true;
        if (lattice.instanceColor) lattice.instanceColor.needsUpdate = true;

        /* ------------------------------- motes ----------------------------- */

        rotate4(motePoints, moteRotated, MOTES, angles);
        for (let i = 0; i < MOTES; i += 1) {
          const nearness = W_EYE / (W_EYE - moteRotated[i * 4 + 3]);
          const k = 60 * nearness;
          motePositions[i * 3] = moteRotated[i * 4] * k;
          motePositions[i * 3 + 1] = moteRotated[i * 4 + 1] * k;
          motePositions[i * 3 + 2] = moteRotated[i * 4 + 2] * k;
        }
        motePositionAttribute.needsUpdate = true;
        moteGeometry.setDrawRange(0, Math.round(400 + detail * (MOTES - 400)));
        moteMaterial.opacity = 0.3 + audio.high * 0.5;
        moteMaterial.color.copy(farW).lerp(nearW, audio.beat * 0.5);

        core.scale.setScalar(
          (0.8 + audio.bass * 0.9 + audio.beat * 0.6) * (heroScale * 0.14),
        );
        core.material.color
          .copy(nearW)
          .lerp(farW, 0.35 + Math.sin(time * 0.4) * 0.3)
          .multiplyScalar(0.5 + audio.level * 0.9 + audio.beat * 0.8);
        coreLight.intensity = 120 + audio.level * 260 + audio.beat * 200;

        for (let i = 0; i < shells.length; i += 1) {
          const shell = shells[i];
          const wave = shockwaves[i];
          shell.visible = wave !== undefined;
          if (wave === undefined) continue;
          shell.scale.setScalar(Math.max(0.01, wave));
          // Fades as it expands, so the shell dies out around the far lattice.
          shell.material.uniforms.uIntensity.value =
            0.9 * Math.pow(1 - clamp01(wave / 130), 1.4);
          shell.material.uniforms.uColor.value
            .copy(nearW)
            .lerp(farW, clamp01(wave / 100));
        }

        /* ------------------------------- camera ---------------------------- */

        // A slow boom around the hero, never so close that a swelling face can
        // reach the lens.
        const { orbit } = view;
        // The polytope swells toward the lens whenever W rotates it forward, so
        // the boom radius has to ride its current size rather than sit fixed.
        const radius =
          12 + heroScale * 1.35 + Math.sin(time * 0.11) * 4 - audio.punch * 2;
        camera.position.set(
          Math.cos(orbit) * radius,
          Math.sin(time * 0.17) * 9 + 2,
          Math.sin(orbit) * radius,
        );
        camera.lookAt(
          Math.sin(time * 0.21) * 2,
          Math.sin(time * 0.19) * 1.5,
          Math.cos(time * 0.23) * 2,
        );
        camera.rotation.z += Math.sin(time * 0.13) * 0.12 + audio.beat * 0.05;
        camera.fov = view.fov;

        drift.setVisible(300 + detail * 600);
        drift.update(offset.set(0, view.drift, 0), camera.position);
        drift.material.opacity = 0.22 + audio.mid * 0.28;

        keyLight.intensity = 180 + audio.level * 220;
        rimLight.intensity = 150 + audio.mid * 200;

        ctx.post.bloom =
          0.38 + audio.level * 0.35 + audio.beat * 0.4 + smoothstep(0, 1, audio.high) * 0.1;
        ctx.post.exposure = 0.95 + audio.beat * 0.12;
      },
    };
  },
};
