/**
 * Reading a 3D model file (binary glTF, `.glb`) far enough to know what it is: the visualizer's models (Library
 * media of kind "model", docs/now-playing.md) are checked and summarised by the server from this, without a 3D
 * engine. Pure: bytes in, a summary out.
 */

/** "glTF", little-endian: every `.glb` starts with it. */
const MAGIC = 0x46546c67;
const JSON_CHUNK = 0x4e4f534a;
const HEADER = 12;

/** What a model file holds, as far as the visualizer cares. */
export interface GlbSummary {
  /** Its animations' names, in the file's order ("" for one without a name). */
  animations: string[];
  /** Triangles drawn (each mesh counted as often as nodes use it): how heavy it is. */
  triangles: number;
  /** Has a skeleton (a character, an animal), not only moving parts. */
  skinned: boolean;
  /** Extensions it can't be drawn without (Draco or meshopt compression, say). */
  extensions: string[];
}

/** Whether the first bytes of a file are a binary glTF's. */
export function isGlb(head: Uint8Array): boolean {
  return head.length >= 4 && new DataView(head.buffer, head.byteOffset, head.byteLength).getUint32(0, true) === MAGIC;
}

interface Accessor {
  count?: unknown;
}
interface Primitive {
  mode?: unknown;
  indices?: unknown;
  attributes?: { POSITION?: unknown };
}
interface Gltf {
  asset?: { version?: unknown };
  accessors?: Accessor[];
  meshes?: { primitives?: Primitive[] }[];
  nodes?: { mesh?: unknown }[];
  animations?: { name?: unknown }[];
  skins?: unknown[];
  extensionsRequired?: unknown[];
}

/** A `.glb`'s summary. Throws an Error saying what's wrong when it isn't one (or is glTF 1). */
export function readGlb(bytes: Uint8Array): GlbSummary {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < HEADER + 8 || !isGlb(bytes)) throw new Error("This isn't a binary glTF (.glb) file.");
  const version = view.getUint32(4, true);
  if (version !== 2) throw new Error(`This is glTF ${version}: only glTF 2 models can be shown.`);
  const length = Math.min(view.getUint32(8, true), bytes.length);
  const jsonLength = view.getUint32(HEADER, true);
  if (view.getUint32(HEADER + 4, true) !== JSON_CHUNK || HEADER + 8 + jsonLength > length) {
    throw new Error("This .glb file is damaged: it has no description of its model.");
  }
  let gltf: Gltf;
  try {
    gltf = JSON.parse(new TextDecoder().decode(bytes.subarray(HEADER + 8, HEADER + 8 + jsonLength))) as Gltf;
  } catch {
    throw new Error("This .glb file is damaged: its description isn't readable.");
  }
  if (!gltf || typeof gltf !== "object") throw new Error("This .glb file is damaged: its description isn't readable.");
  return summarise(gltf);
}

function summarise(gltf: Gltf): GlbSummary {
  const accessors = Array.isArray(gltf.accessors) ? gltf.accessors : [];
  const count = (index: unknown) => {
    const n = typeof index === "number" ? accessors[index]?.count : undefined;
    return typeof n === "number" && Number.isFinite(n) && n > 0 ? n : 0;
  };
  const meshes = Array.isArray(gltf.meshes) ? gltf.meshes : [];
  const meshTriangles = meshes.map((mesh) =>
    (Array.isArray(mesh?.primitives) ? mesh.primitives : []).reduce((sum, p) => {
      const vertices = p?.indices !== undefined ? count(p.indices) : count(p?.attributes?.POSITION);
      const mode = typeof p?.mode === "number" ? p.mode : 4;
      if (mode === 4) return sum + Math.floor(vertices / 3);
      // Strips and fans.
      if (mode === 5 || mode === 6) return sum + Math.max(0, vertices - 2);
      return sum;
    }, 0),
  );
  const nodes = Array.isArray(gltf.nodes) ? gltf.nodes : [];
  const used = nodes.filter((n) => typeof n?.mesh === "number" && n.mesh < meshes.length);
  const triangles = used.length
    ? used.reduce((sum, n) => sum + meshTriangles[n.mesh as number], 0)
    : meshTriangles.reduce((a, b) => a + b, 0);
  const animations = (Array.isArray(gltf.animations) ? gltf.animations : []).map((a) =>
    typeof a?.name === "string" ? a.name.slice(0, 80) : "",
  );
  const extensions = (Array.isArray(gltf.extensionsRequired) ? gltf.extensionsRequired : []).filter(
    (e): e is string => typeof e === "string",
  );
  return { animations, triangles, skinned: Array.isArray(gltf.skins) && gltf.skins.length > 0, extensions };
}

/**
 * A tiny but complete `.glb` (a box of two triangles a side, optionally with animations named `animations`, and
 * extensions it `requires`): what
 * tests and the stand-in model search hand out, so nothing needs a real model off the internet.
 */
export function sampleGlb(animations: string[] = [], requires: string[] = []): Uint8Array {
  const positions = new Float32Array([
    -1, -1, 1, 1, -1, 1, 1, 1, 1, -1, 1, 1, -1, -1, -1, 1, -1, -1, 1, 1, -1, -1, 1, -1,
  ]);
  const indices = new Uint16Array([
    0, 1, 2, 0, 2, 3, 5, 4, 7, 5, 7, 6, 4, 0, 3, 4, 3, 7, 1, 5, 6, 1, 6, 2, 3, 2, 6, 3, 6, 7, 4, 5, 1, 4, 1, 0,
  ]);
  const times = new Float32Array([0, 1]);
  const turns = new Float32Array([0, 0, 0, 1, 0, 0.7071, 0, 0.7071]);
  const parts = [positions, indices, times, turns].map((a) => new Uint8Array(a.buffer));
  const offsets: number[] = [];
  let at = 0;
  for (const part of parts) {
    offsets.push(at);
    at += Math.ceil(part.length / 4) * 4;
  }
  const bin = new Uint8Array(at);
  parts.forEach((part, i) => bin.set(part, offsets[i]));
  const gltf = {
    asset: { version: "2.0", generator: "YTStudio sample" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, name: "Box" }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
    materials: [],
    buffers: [{ byteLength: bin.length }],
    bufferViews: parts.map((part, i) => ({ buffer: 0, byteOffset: offsets[i], byteLength: part.length })),
    accessors: [
      { bufferView: 0, componentType: 5126, count: 8, type: "VEC3", min: [-1, -1, -1], max: [1, 1, 1] },
      { bufferView: 1, componentType: 5123, count: 36, type: "SCALAR" },
      { bufferView: 2, componentType: 5126, count: 2, type: "SCALAR", min: [0], max: [1] },
      { bufferView: 3, componentType: 5126, count: 2, type: "VEC4" },
    ],
    animations: animations.map((name) => ({
      name,
      samplers: [{ input: 2, output: 3, interpolation: "LINEAR" }],
      channels: [{ sampler: 0, target: { node: 0, path: "rotation" } }],
    })),
    ...(requires.length && { extensionsUsed: requires, extensionsRequired: requires }),
  };
  let json = new TextEncoder().encode(JSON.stringify(gltf));
  const padded = new Uint8Array(Math.ceil(json.length / 4) * 4).fill(0x20);
  padded.set(json);
  json = padded;
  const out = new Uint8Array(HEADER + 8 + json.length + 8 + bin.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, MAGIC, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, out.length, true);
  view.setUint32(HEADER, json.length, true);
  view.setUint32(HEADER + 4, JSON_CHUNK, true);
  out.set(json, HEADER + 8);
  const binAt = HEADER + 8 + json.length;
  view.setUint32(binAt, bin.length, true);
  view.setUint32(binAt + 4, 0x004e4942, true);
  out.set(bin, binAt + 8);
  return out;
}
