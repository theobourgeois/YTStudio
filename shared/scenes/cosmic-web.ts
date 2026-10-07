/**
 * Cosmic Web (docs/visualizer/scenes.md, "Five more, again"): flying through the largest structure there is,
 * filaments of galaxies meeting in bright clusters round black voids. Light on black: nothing but what glows is drawn,
 * so Screen or Add lays it over a clip.
 *
 * The web is a graph, not noise. Its nodes (clusters) sit one to a cell of a lattice, jittered hard, some of them
 * missing (the voids: fewer nodes and filaments where a slow periodic field is low, more in its superclusters); each
 * joins some of its 26 neighbours (along the axes, the faces' and the cube's diagonals, kept by a hash, more likely the
 * shorter the edge) by a filament bowed through two hashed control points (a cubic Bézier: arcs and S-bends). It all
 * comes from **integer hashes** (`uint` in the GLSL, `Math.imul` here), so TypeScript knows the graph exactly
 * (`webNode`, `webEdge`, `webNeighbours`, `webNear`) and the camera flies along real filaments.
 * It isn't marched: the ray walks the lattice's cells (a DDA), and in each cell every filament and cluster that can be
 * near it (those of the 3x3x3 nodes round it: jitter and bow are bounded, so nothing else comes within `MARGIN` of the
 * cell) adds its light analytically from the ray's closest approach to it, counted in the cell where that approach
 * lies so each is counted once. So nothing bands or speckles, a far filament is a pixel wide and fainter for it, and a
 * near one is wide and soft. A filament is a soft string of gas strung with galaxies (real points in 3D, scattered
 * through its width), thickening into its clusters; a cluster is a hot core, a halo and a swarm of member galaxies.
 * The lattice repeats every `WEB_PERIOD` cells (its hashes taken on cells modulo it) and the camera wraps, so the
 * flight never ends.
 * Stepped: the camera's walk beside a filament from node to node, picking the next at each node (straight on mostly,
 * sharper turns after hits), on whichever side of it keeps furthest from the filaments round it, eased, then held
 * `CLEAR_OF_CLUSTERS` from every cluster and `CLEAR_OF_FILAMENTS` from every filament (`keepClear`); its look eased
 * ahead along the walk, its up carried with it (space has none), banked into turns; the speed on the bass. And the
 * pulses: each hit flashes the cluster ahead and sends a front of light out from it along the filaments it crosses,
 * white, the palette's colour in its wake. Each cluster's brightness is a band of the spectrum (read in the GLSL), the
 * bass swells them, the level is the glow.
 * Neural makes it a brain: cyan cell bodies, each with a few short dendrite trees of its own, joined by violet
 * dendrites that taper out of them and branch; the cells fire on their own (more of them the louder it is), flashing
 * and sending signals racing down their dendrites and lighting the branches they pass.
 */
import type { ParamValues } from "../types.ts";
import type { SceneSpec } from "./index.ts";
import {
  type Vec3,
  add,
  cameraLooking,
  clamp01,
  cross,
  dot,
  float,
  length,
  normalize,
  num,
  random,
  scale,
  sceneDt,
  smoothstep,
  smoothTo,
  soundUniforms,
  sub,
  vec4,
} from "./kit.ts";

/** A lattice cell's size (world units), and how many cells the web repeats over along each axis. */
export const WEB_CELL = 10;
export const WEB_PERIOD = 32;
/** How far a node strays from its cell's centre (a fraction of a cell, each way), and the most a filament bows (units). */
const JITTER = 0.24;
const BOW = 0.7;
/** Nothing outside a cell's 3x3x3 nodes comes nearer the cell than these (units): a filament's light and a cluster's stop there. */
const MARGIN = (0.5 - JITTER) * WEB_CELL - BOW;
const NODE_REACH = (1.5 - JITTER) * WEB_CELL - 0.6;
/** Pulses at once, and how fast their fronts run (units a second). */
const PULSES = 4;
const PULSE_SPEED = 14;
/** How far beside its filament the camera flies (units). */
const SIDE = 1.4;

/** The 13 directions an edge is owned along (the other 13 are theirs from the other end). */
const DIRS: readonly Vec3[] = [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
  [1, 1, 0],
  [1, -1, 0],
  [1, 0, 1],
  [1, 0, -1],
  [0, 1, 1],
  [0, 1, -1],
  [1, 1, 1],
  [1, 1, -1],
  [1, -1, 1],
  [1, -1, -1],
];
/** How likely an edge along each kind of direction is kept (axes, faces' diagonals, the cube's). */
const keepOf = (k: number) => (k < 3 ? 0.7 : k < 9 ? 0.42 : 0.4);

/** A lattice cell (integers). */
export type Cell = [number, number, number];

// The integer hashes, exactly as the GLSL's (`cwMix`: lowbias32).
const mix32 = (x: number) => {
  let h = x >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b);
  h ^= h >>> 16;
  return h >>> 0;
};
/** The next 0..1 of a hash stream (24 bits, exact in a float32 too). */
const rand = (st: { h: number }) => {
  st.h = mix32(st.h + 0x9e3779b9);
  return (st.h >>> 8) / 16777216;
};
const wrapCell = (c: number) => ((c % WEB_PERIOD) + WEB_PERIOD) % WEB_PERIOD;
const cellHash = (u: Cell) => {
  let h = mix32(Math.imul(u[2], 0xc2b2ae3d) + 0x27d4eb2f);
  h = mix32((Math.imul(u[1], 0x85ebca77) >>> 0) + h);
  return mix32((Math.imul(u[0], 0x9e3779b1) >>> 0) + h);
};
/** The large-scale field (0..1, periodic): superclusters where it's high, voids where it's low. */
const macroOf = (u: Cell) => {
  const f = u.map((v) => (v * Math.PI * 2) / WEB_PERIOD);
  const a = Math.sin(2 * f[0] + f[1] + 1.3) + Math.sin(2 * f[1] - f[2] + 4.1) + Math.sin(2 * f[2] + f[0] + 2.2);
  return clamp01(0.5 + a * 0.3);
};

export interface WebNode {
  pos: Vec3;
  /** Its stream's start (the edges it owns hash from it) and the large-scale field there. */
  hash: number;
  macro: number;
}

/** The cluster in a cell, or null where there's none (the GLSL's `cwCell` nodes). */
export function webNode(cell: Cell): WebNode | null {
  const u: Cell = [wrapCell(cell[0]), wrapCell(cell[1]), wrapCell(cell[2])];
  const hash = cellHash(u);
  const macro = macroOf(u);
  const st = { h: hash };
  const j = [rand(st) - 0.5, rand(st) - 0.5, rand(st) - 0.5];
  if (rand(st) >= 0.25 + 0.85 * macro) return null;
  const pos = cell.map((c, i) => (c + 0.5 + j[i] * 2 * JITTER) * WEB_CELL) as Vec3;
  return { pos, hash, macro };
}

/** A filament: its cubic Bézier from one node to the other. */
export type Curve = [Vec3, Vec3, Vec3, Vec3];

/** The filament `owner` owns along direction `k` (0..12, `DIRS`), or null where it's dropped (the GLSL's edge loop). */
export function webEdge(owner: Cell, k: number, density: number): Curve | null {
  const a = webNode(owner);
  const b = webNode(add(owner, DIRS[k]));
  if (!a || !b) return null;
  const st = { h: mix32((a.hash + (Math.imul(k, 0x632be5ab) >>> 0) + 0x1b873593) >>> 0) };
  const chord = sub(b.pos, a.pos);
  const len = length(chord) / WEB_CELL;
  const keep = density * keepOf(k) * (1 - smoothstep(1.05, 1.9, len)) * (0.25 + 0.425 * (a.macro + b.macro));
  if (rand(st) >= keep) return null;
  const dn = normalize(chord);
  const bow = (): Vec3 => {
    let o: Vec3 = [(rand(st) - 0.5) * 2 * BOW, (rand(st) - 0.5) * 2 * BOW, (rand(st) - 0.5) * 2 * BOW];
    o = sub(o, scale(dn, dot(o, dn)));
    return scale(o, Math.min(1, BOW / Math.max(length(o), 1e-6)));
  };
  const o1 = bow();
  const o2 = bow();
  return [a.pos, add(add(a.pos, scale(chord, 1 / 3)), o1), add(add(a.pos, scale(chord, 2 / 3)), o2), b.pos];
}

const reversed = (c: Curve): Curve => [c[3], c[2], c[1], c[0]];

/** The filaments leaving a node: where each goes and its curve from this node. */
export function webNeighbours(cell: Cell, density: number): { to: Cell; curve: Curve }[] {
  const out: { to: Cell; curve: Curve }[] = [];
  if (!webNode(cell)) return out;
  DIRS.forEach((d, k) => {
    const ahead = webEdge(cell, k, density);
    if (ahead) out.push({ to: add(cell, d), curve: ahead });
    const from = sub(cell, d);
    const behind = webEdge(from, k, density);
    if (behind) out.push({ to: from, curve: reversed(behind) });
  });
  return out;
}

/** A point of a filament at `s` (0..1). */
export function curvePoint(c: Curve, s: number): Vec3 {
  const r = 1 - s;
  const [k0, k1, k2, k3] = [r * r * r, 3 * r * r * s, 3 * r * s * s, s * s * s];
  return [0, 1, 2].map((i) => c[0][i] * k0 + c[1][i] * k1 + c[2][i] * k2 + c[3][i] * k3) as Vec3;
}

const curveLength = (c: Curve) => {
  let sum = 0;
  let prev = c[0];
  for (let i = 1; i <= 12; i++) {
    const p = curvePoint(c, i / 12);
    sum += length(sub(p, prev));
    prev = p;
  }
  return sum;
};
const chordDir = (c: Curve) => normalize(sub(c[3], c[0]));

interface Pulse {
  x: number;
  y: number;
  z: number;
  age: number;
  power: number;
}

interface CosmicState {
  started: boolean;
  time: number;
  /** The walk: the filament it's beside (from one node to the next), the one it'll take after, how far along. */
  from: Cell;
  to: Cell;
  next: Cell;
  curve: Curve;
  nextCurve: Curve;
  s: number;
  len: number;
  /** Which side of the filament it flies on (a unit vector, square to it). */
  side: Vec3;
  pos: Vec3;
  fwd: Vec3;
  up: Vec3;
  roll: number;
  speed: number;
  /** After a hit, the walk prefers a sharper turn at the next node (1, easing to 0). */
  twist: number;
  /** The level (the glow), the bass (the clusters' swell) and, for Neural, how many cells fire. */
  glow: number;
  swell: number;
  fire: number;
  pulses: Pulse[];
  rng: { seed: number };
}

/** The Density value: how many filaments are kept. */
const densityOf = (values: ParamValues) => Math.max(0.3, num(values, "density", 1));

/** Where the walk goes from `to` (having come from `from`): mostly straight on, a sharper turn when `twist` is high. */
function chooseNext(s: CosmicState, from: Cell, to: Cell, inDir: Vec3, dens: number): { to: Cell; curve: Curve } {
  const options = neighboursOf(to, dens).filter((n) => n.to.some((v, i) => v !== from[i]));
  const ahead = options.filter((n) => dot(chordDir(n.curve), inDir) > -0.35);
  const pool = ahead.length ? ahead : options;
  if (!pool.length) {
    // A dead end: back the way it came.
    const back = neighboursOf(to, dens).find((n) => n.to.every((v, i) => v === from[i]));
    if (back) return back;
    const a = webNode(to)?.pos ?? [0, 0, 0];
    const b = webNode(from)?.pos ?? add(a, [WEB_CELL, 0, 0]);
    return { to: from, curve: [a, add(a, scale(sub(b, a), 1 / 3)), add(a, scale(sub(b, a), 2 / 3)), b] };
  }
  const bias = 1 - 2.2 * s.twist;
  let best = pool[0];
  let bestScore = -Infinity;
  for (const n of pool) {
    const score = bias * dot(chordDir(n.curve), inDir) + 0.9 * random(s.rng);
    if (score > bestScore) {
      bestScore = score;
      best = n;
    }
  }
  return best;
}

const neighbourCache = new Map<string, { to: Cell; curve: Curve }[]>();
/** `webNeighbours`, remembered (the walk asks about the same few nodes every frame). */
function neighboursOf(cell: Cell, dens: number) {
  const key = `${cell.join(",")}|${dens}`;
  let found = neighbourCache.get(key);
  if (!found) {
    if (neighbourCache.size > 256) neighbourCache.clear();
    neighbourCache.set(key, (found = webNeighbours(cell, dens)));
  }
  return found;
}

/** A filament as the walk checks its clearance from it: its curve as eight chords, and a sphere round it. */
export interface Filament {
  curve: Curve;
  points: Vec3[];
  centre: Vec3;
  radius: number;
}

function filament(curve: Curve): Filament {
  const points = Array.from({ length: 9 }, (_, i) => curvePoint(curve, i / 8));
  return { curve, points, centre: scale(add(curve[0], curve[3]), 0.5), radius: length(sub(curve[3], curve[0])) / 2 + BOW };
}

/** The point of a filament nearest `q` (on its chords), and how far. (Scalar maths: it runs thousands of times a frame.) */
function nearestOn(q: Vec3, f: Filament): [Vec3, number] {
  let bx = 0;
  let by = 0;
  let bz = 0;
  let bestD2 = Infinity;
  for (let i = 1; i < f.points.length; i++) {
    const a = f.points[i - 1];
    const b = f.points[i];
    const abx = b[0] - a[0];
    const aby = b[1] - a[1];
    const abz = b[2] - a[2];
    const t = clamp01(((q[0] - a[0]) * abx + (q[1] - a[1]) * aby + (q[2] - a[2]) * abz) / Math.max(abx * abx + aby * aby + abz * abz, 1e-9));
    const x = a[0] + abx * t;
    const y = a[1] + aby * t;
    const z = a[2] + abz * t;
    const d2 = (q[0] - x) ** 2 + (q[1] - y) ** 2 + (q[2] - z) ** 2;
    if (d2 < bestD2) {
      bestD2 = d2;
      bx = x;
      by = y;
      bz = z;
    }
  }
  return [[bx, by, bz], Math.sqrt(bestD2)];
}

const nearCache = new Map<string, { filaments: Filament[]; nodes: Vec3[] }>();
/**
 * Every cluster in the 3x3x3 cells round a cell and every filament between them (all that can come near the cell),
 * remembered.
 */
export function webNear(cell: Cell, dens: number): { filaments: Filament[]; nodes: Vec3[] } {
  const key = `${cell.join(",")}|${dens}`;
  let found = nearCache.get(key);
  if (found) return found;
  const filaments: Filament[] = [];
  const nodes: Vec3[] = [];
  for (let i = 0; i < 27; i++) {
    const c: Cell = [cell[0] + (i % 3) - 1, cell[1] + (Math.floor(i / 3) % 3) - 1, cell[2] + Math.floor(i / 9) - 1];
    const n = webNode(c);
    if (!n) continue;
    nodes.push(n.pos);
    DIRS.forEach((d, k) => {
      if (add(c, d).some((v, j) => Math.abs(v - cell[j]) > 1)) return;
      const e = webEdge(c, k, dens);
      if (e) filaments.push(filament(e));
    });
  }
  if (nearCache.size > 64) nearCache.clear();
  nearCache.set(key, (found = { filaments, nodes }));
  return found;
}

const cellOf = (p: Vec3): Cell => [Math.floor(p[0] / WEB_CELL), Math.floor(p[1] / WEB_CELL), Math.floor(p[2] / WEB_CELL)];

/** The filaments about the walk within `reach` of `q`, but the one it's beside. */
function nearby(s: CosmicState, dens: number, q: Vec3, reach: number): Filament[] {
  const own = (c: Curve) =>
    (length(sub(c[0], s.curve[0])) < 1e-6 && length(sub(c[3], s.curve[3])) < 1e-6) || (length(sub(c[0], s.curve[3])) < 1e-6 && length(sub(c[3], s.curve[0])) < 1e-6);
  return webNear(cellOf(q), dens).filaments.filter((f) => length(sub(q, f.centre)) < f.radius + reach && !own(f.curve));
}

/** The filament's direction at `at`. */
const tangentAt = (c: Curve, at: number) => normalize(sub(curvePoint(c, Math.min(1, at + 0.02)), curvePoint(c, Math.max(0, at - 0.02))));

/** `v` made square to `d` and unit (any square direction if it's along `d`). */
function square(v: Vec3, d: Vec3): Vec3 {
  const f = sub(v, scale(d, dot(v, d)));
  if (length(f) > 1e-4) return normalize(f);
  return normalize(cross(d, Math.abs(d[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]));
}

/**
 * The side of its filament the camera should fly on now: of the directions square to it, the one that keeps furthest
 * from the other filaments (here and a little ahead, so it's round in time), a little in favour of the side it's on.
 * At a node that's square to the filaments in and out, so it passes the cluster at `SIDE` and cuts no corner into it.
 */
function bestSide(s: CosmicState, dens: number): Vec3 {
  const t = tangentAt(s.curve, s.s);
  const u = square(s.side, t);
  const v = cross(t, u);
  const here = curvePoint(s.curve, s.s);
  const later = ahead(s, s.s, 3);
  const others = nearby(s, dens, scale(add(here, later), 0.5), SIDE + 4.5);
  if (!others.length) return u;
  let best = u;
  let bestScore = -Infinity;
  for (let k = 0; k < 12; k++) {
    const theta = (k / 12) * Math.PI * 2;
    const side = add(scale(u, Math.cos(theta)), scale(v, Math.sin(theta)));
    const a = add(here, scale(side, SIDE));
    const b = add(later, scale(side, SIDE));
    let clear = 3;
    for (const f of others) clear = Math.min(clear, nearestOn(a, f)[1], nearestOn(b, f)[1]);
    const score = clear + 0.3 * Math.cos(theta);
    if (score > bestScore) {
      bestScore = score;
      best = side;
    }
  }
  return best;
}

/** How near the camera may come to a cluster's centre, and to a filament's spine (units). */
export const CLEAR_OF_CLUSTERS = 1.2;
export const CLEAR_OF_FILAMENTS = 0.8;

/**
 * The camera's place moved out of every cluster's sphere and every filament's tube it has strayed into (easing round a
 * corner cuts it): `CLEAR_OF_CLUSTERS` from every cluster, `CLEAR_OF_FILAMENTS` from every filament.
 */
export function keepClear(q: Vec3, dens: number): Vec3 {
  const near = webNear(cellOf(q), dens);
  const filaments = near.filaments.filter((f) => length(sub(q, f.centre)) < f.radius + 2);
  let p = q;
  for (let pass = 0; pass < 3; pass++) {
    for (const f of filaments) {
      const [x, d] = nearestOn(p, f);
      if (d < CLEAR_OF_FILAMENTS && d > 1e-6) p = add(x, scale(sub(p, x), CLEAR_OF_FILAMENTS / d));
    }
    for (const n of near.nodes) {
      const v = sub(p, n);
      const d = length(v);
      if (d < CLEAR_OF_CLUSTERS && d > 1e-6) p = add(n, scale(v, CLEAR_OF_CLUSTERS / d));
    }
  }
  return p;
}

/** `from` turned towards `to` by at most `most` radians (about `axis` when they're opposite). */
function turnTowards(from: Vec3, to: Vec3, most: number, axis: Vec3): Vec3 {
  const angle = Math.acos(Math.max(-1, Math.min(1, dot(from, to))));
  if (angle < 1e-5) return to;
  let k = cross(from, to);
  k = length(k) > 1e-5 ? normalize(k) : axis;
  const phi = Math.min(angle, most);
  return normalize(add(add(scale(from, Math.cos(phi)), scale(cross(k, from), Math.sin(phi))), scale(k, dot(k, from) * (1 - Math.cos(phi)))));
}

/** A point `distance` units ahead of `at` on the walk (into the next filament if it's past this one's end). */
function ahead(s: CosmicState, at: number, distance: number): Vec3 {
  const u = at + distance / s.len;
  if (u <= 1) return curvePoint(s.curve, u);
  return curvePoint(s.nextCurve, Math.min(1, ((u - 1) * s.len) / curveLength(s.nextCurve)));
}

/** Where the camera wants to be: beside the filament at `s.s`. */
const besideAt = (s: CosmicState): Vec3 => add(curvePoint(s.curve, s.s), scale(square(s.side, tangentAt(s.curve, s.s)), SIDE));

/** The walk's start: a well-connected node near the middle of the period, heading along one of its filaments. */
function start(s: CosmicState, dens: number) {
  const mid = WEB_PERIOD / 2;
  let from: Cell = [mid, mid, mid];
  search: for (let r = 0; r < 6; r++) {
    for (let k = 0; k < 27; k++) {
      const c: Cell = [mid + ((k % 3) - 1) * r, mid + ((Math.floor(k / 3) % 3) - 1) * r, mid + (Math.floor(k / 9) - 1) * r];
      if (neighboursOf(c, dens).length >= 3) {
        from = c;
        break search;
      }
    }
  }
  const options = neighboursOf(from, dens);
  const first = options.find((n) => Math.abs(chordDir(n.curve)[1]) < 0.6) ?? options[0];
  if (!first) return;
  s.from = from;
  s.to = first.to;
  s.curve = first.curve;
  s.len = curveLength(first.curve);
  const nxt = chooseNext(s, from, first.to, chordDir(first.curve), dens);
  s.next = nxt.to;
  s.nextCurve = nxt.curve;
  s.s = 0.15;
  s.side = square([0, 1, 0], chordDir(first.curve));
  for (let i = 0; i < 4; i++) s.side = bestSide(s, dens);
  s.pos = besideAt(s);
  s.fwd = normalize(sub(ahead(s, s.s, 8), s.pos));
  s.up = normalize(sub([0, 1, 0], scale(s.fwd, s.fwd[1])));
  s.started = true;
}

/** The world repeats every `WEB_PERIOD` cells: keep the walk in the period it started in, moving all it carries. */
function wrapWorld(s: CosmicState) {
  for (let i = 0; i < 3; i++) {
    const shift = -Math.floor(s.from[i] / WEB_PERIOD) * WEB_PERIOD;
    if (!shift) continue;
    const units = shift * WEB_CELL;
    for (const c of [s.from, s.to, s.next]) c[i] += shift;
    for (const p of [...s.curve, ...s.nextCurve, s.pos]) p[i] += units;
    for (const p of s.pulses) {
      if (i === 0) p.x += units;
      else if (i === 1) p.y += units;
      else p.z += units;
    }
  }
}

export const COSMIC_WEB: SceneSpec<CosmicState> = {
  type: "cosmic-web",
  label: "Cosmic Web",
  params: [
    {
      kind: "choice",
      key: "style",
      label: "Style",
      default: "cosmic",
      options: [
        { value: "cosmic", label: "Cosmic" },
        { value: "neural", label: "Neural" },
        { value: "dark", label: "Dark Matter" },
        { value: "mono", label: "Mono" },
      ],
    },
    { kind: "number", key: "density", label: "Density", default: 1, min: 0.3, max: 2, scale: 100, unit: "%", step: 1, decimals: 0, slider: true },
    { kind: "number", key: "glow", label: "Glow", default: 1, min: 0, max: 2, scale: 100, unit: "%", step: 1, decimals: 0, slider: true },
  ],
  audio: () => ({ rows: 1, span: 0, fall: 0.2, window: 0 }),
  glsl: /* glsl */ `
uniform float cwTime;
uniform float cwGlow;
uniform float cwSwell;
uniform float cwFire;
uniform vec4 cwPulse0;
uniform vec4 cwPulse1;
uniform vec4 cwPulse2;
uniform vec4 cwPulse3;
uniform vec4 cwPower;

const float CW_S = ${WEB_CELL.toFixed(1)};
const int CW_P = ${WEB_PERIOD};
const float CW_J = ${JITTER};
const float CW_BOW = ${BOW};
const float CW_M = ${MARGIN.toFixed(3)};
const float CW_REACH = ${NODE_REACH.toFixed(3)};
const float CW_PULSE_SPEED = ${PULSE_SPEED.toFixed(1)};
// Neural: how long a dendrite's branches are at most, and how fast signals run (units, units a second).
const float CW_TWIG = 1.3;
const float CW_SIGNAL_SPEED = 7.0;
const ivec3 CW_DIRS[13] = ivec3[13](
  ivec3(1, 0, 0), ivec3(0, 1, 0), ivec3(0, 0, 1),
  ivec3(1, 1, 0), ivec3(1, -1, 0), ivec3(1, 0, 1), ivec3(1, 0, -1), ivec3(0, 1, 1), ivec3(0, 1, -1),
  ivec3(1, 1, 1), ivec3(1, 1, -1), ivec3(1, -1, 1), ivec3(1, -1, -1));

// Set once a pixel: how far the ray looks, a pixel's width a unit away, the style's colours.
float cwEnd;
float cwPixel;
vec3 cwFil;
vec3 cwCluster;
vec3 cwBead;
vec3 cwSignal;

// The graph's integer hashes (TypeScript's mix32, rand, cellHash: the same bits).
uint cwMix(uint h) {
  h ^= h >> 16;
  h *= 0x7feb352du;
  h ^= h >> 15;
  h *= 0x846ca68bu;
  h ^= h >> 16;
  return h;
}
float cwRand(inout uint h) {
  h = cwMix(h + 0x9e3779b9u);
  return float(h >> 8u) * (1.0 / 16777216.0);
}
uvec3 cwWrap(ivec3 c) { return uvec3(c + ivec3(CW_P * 4096)) % uint(CW_P); }
uint cwCellHash(uvec3 u) {
  uint h = cwMix(u.z * 0xc2b2ae3du + 0x27d4eb2fu);
  h = cwMix(u.y * 0x85ebca77u + h);
  return cwMix(u.x * 0x9e3779b1u + h);
}
float cwMacro(uvec3 u) {
  vec3 f = vec3(u) * (6.28318531 / float(CW_P));
  float a = sin(2.0 * f.x + f.y + 1.3) + sin(2.0 * f.y - f.z + 4.1) + sin(2.0 * f.z + f.x + 2.2);
  return clamp(0.5 + a * 0.3, 0.0, 1.0);
}

vec3 cwBezier(vec3 a, vec3 b, vec3 c, vec3 d, float s) {
  float r = 1.0 - s;
  return r * r * r * a + 3.0 * r * r * s * b + 3.0 * r * s * s * c + s * s * s * d;
}

// The ray's closest approach to a segment: (distance, t along the ray, u along the segment).
vec3 cwRaySeg(vec3 ro, vec3 rd, vec3 a, vec3 b) {
  vec3 ba = b - a;
  vec3 oa = ro - a;
  float bb = max(dot(ba, ba), 1e-6);
  float bd = dot(ba, rd);
  float bo = dot(ba, oa);
  float od = dot(rd, oa);
  float u = clamp((bo - od * bd) / max(bb - bd * bd, 1e-6), 0.0, 1.0);
  float t = max(u * bd - od, 0.0);
  u = clamp((bo + t * bd) / bb, 0.0, 1.0);
  t = max(u * bd - od, 0.0);
  return vec3(length(oa + rd * t - ba * u), t, u);
}

// The pulses' light at a point: x the white front, y the coloured wake behind it, z the flash of the cluster it left.
vec3 cwPulses(vec3 p) {
  vec3 r = vec3(0.0);
  for (int i = 0; i < 4; i++) {
    vec4 pu = i == 0 ? cwPulse0 : i == 1 ? cwPulse1 : i == 2 ? cwPulse2 : cwPulse3;
    if (pu.w < 0.0) continue;
    float x = length(p - pu.xyz) - pu.w * CW_PULSE_SPEED;
    float fade = cwPower[i] * exp(-pu.w * 0.55);
    r.x += fade * exp(-x * x * 1.5);
    r.y += fade * (x < 0.0 ? exp(x * 0.5) : 0.0);
    r.z += cwPower[i] * exp(-pu.w * 5.0) * exp(-dot(p - pu.xyz, p - pu.xyz) * 2.0);
  }
  return r;
}

void cwPalette() {
  if (style == 1) {
    cwFil = vec3(0.42, 0.16, 1.0); cwCluster = vec3(0.12, 0.85, 1.0); cwBead = vec3(0.75, 0.45, 1.0); cwSignal = vec3(0.85, 0.95, 1.0);
  } else if (style == 2) {
    cwFil = vec3(1.0, 0.1, 0.55); cwCluster = vec3(0.22, 0.16, 1.0); cwBead = vec3(1.0, 0.5, 0.85); cwSignal = vec3(1.0, 0.85, 1.0);
  } else if (style == 3) {
    cwFil = vec3(0.7); cwCluster = vec3(1.0); cwBead = vec3(0.95); cwSignal = vec3(1.0);
  } else {
    cwFil = vec3(1.0, 0.5, 0.14); cwCluster = vec3(0.6, 0.78, 1.0); cwBead = vec3(1.0, 0.82, 0.55); cwSignal = vec3(1.0, 0.95, 0.88);
  }
}

// The distance from the ray to a point, and how far along the ray it is.
vec2 cwToPoint(vec3 ro, vec3 rd, vec3 p) {
  vec3 v = p - ro;
  float t = dot(v, rd);
  return vec2(length(v - rd * t), t);
}

// A cluster (or in Neural, a cell body) the ray passes d away from, t along it.
vec3 cwNodeLight(vec3 ro, vec3 rd, float d, float t, vec4 info, vec3 p, uint h) {
  float px = cwPixel * t;
  float level = spectrum(0.04 + 0.82 * info.y);
  vec3 pulse = cwPulses(p);
  float energy = info.x * (0.3 + 1.6 * level * level + 0.8 * cwSwell) + 0.8 * pulse.x + 2.0 * pulse.z;
  // Neural: a cell that fires flashes.
  if (info.z >= 0.0) energy += 2.0 * exp(-info.z * 5.0);
  float fade = (1.0 - smoothstep(cwEnd * 0.3, cwEnd, t)) * exp(-t * 0.015);
  float window = 1.0 - smoothstep(CW_REACH * 0.3, CW_REACH, d);
  vec3 col;
  if (style == 1) {
    // A cell body: a soft glowing ball, its membrane brightest at the rim, a nucleus inside (thinned by the lens).
    float r = 0.22 + 0.12 * min(info.x, 1.5);
    float re = max(r, px);
    float x = d / re;
    float k = (r / re) * (r / re);
    float ball = exp(-x * x * 2.2) * 0.35;
    float rim = smoothstep(1.1, 0.85, x) * x * x * x * x * 0.5;
    float nucleus = exp(-x * x * 30.0) * 1.2;
    float q = d / (r * 2.0);
    float halo = window / ((1.0 + q * q) * (1.0 + q * q));
    float nearLens = smoothstep(1.5, 6.0, t);
    col = (cwCluster * ((ball + rim) * k + halo * 0.1 * glow) + cwSignal * nucleus * k) * energy * nearLens;
  } else {
    float r = 0.07 + 0.1 * info.x;
    float re = max(r, px * 0.8);
    float core = (r / re) * (r / re) * exp(-d * d / (re * re)) * 3.0;
    float q = d / (r * 4.0);
    float halo = window / ((1.0 + q * q) * (1.0 + q * q));
    // (Dark Matter: each cluster sits in a wide halo of it.)
    float gas = exp(-d * (style == 2 ? 0.9 : 1.6)) * window * (style == 2 ? 0.03 : 0.012);
    // (A cluster the camera passes close by would fill the frame with its halo: it thins near the lens.)
    float near = smoothstep(1.0, 6.0, t);
    col = mix(cwCluster, vec3(1.0), 0.5) * core * energy * mix(0.25, 1.0, near) + cwCluster * (halo * 0.3 + gas) * glow * (energy / (1.0 + 0.3 * energy)) * near;
    // Its member galaxies, a swarm round the core.
    if (d < 2.2 + px * 2.0) {
      for (int m = 0; m < 10; m++) {
        vec3 o = vec3(cwRand(h), cwRand(h), cwRand(h)) * 2.0 - 1.0;
        float rr = cwRand(h);
        vec3 g = p + normalize(o + 1e-4) * (0.25 + 1.4 * rr * rr) * (0.6 + 0.5 * info.x);
        vec2 dt = cwToPoint(ro, rd, g);
        float r0 = 0.025 + 0.035 * cwRand(h);
        float rb = max(r0, cwPixel * max(dt.y, 0.0) * 0.8);
        float lum = 0.4 + 5.0 * pow(cwRand(h), 3.0);
        col += mix(cwBead, vec3(1.0), 0.4) * lum * (r0 / rb) * (r0 / rb) * exp(-dt.x * dt.x / (rb * rb)) * (0.5 + 0.5 * energy) * smoothstep(1.5, 4.0, dt.y);
      }
    }
  }
  // A hit's flash: the cluster a pulse leaves blooms.
  float fq = d / 0.7;
  col += mix(cwSignal, cwCluster, 0.4) * pulse.z * window * 1.2 / ((1.0 + fq * fq) * (1.0 + fq * fq));
  return col * fade;
}

// A filament (the curve a, b, c, e) the ray passes d away from, t along it, at s (0..1) of its curve.
vec3 cwFilamentLight(vec3 ro, vec3 rd, float d, float t, float s, float len, vec3 a, vec3 b, vec3 c, vec3 e, uint h, float bright, vec4 infoA, vec4 infoB) {
  vec3 p = cwBezier(a, b, c, e, s);
  float px = cwPixel * t;
  float fade = (1.0 - smoothstep(cwEnd * 0.3, cwEnd, t)) * exp(-t * 0.015);
  float x = s * len;
  float toNode = min(x, len - x);
  bool neural = style == 1;
  // Dendrites taper out of their cells; the cosmos's filaments of gas thicken into their clusters.
  float w = neural ? 0.018 + 0.12 * exp(-toNode * 0.7) : 0.2 + 0.35 * exp(-toNode * 0.4);
  float we = max(w, px * 0.7);
  float core = (w / we) * exp(-d * d / (we * we));
  float m = 1.0 - d / CW_M;
  float halo = exp(-d * 2.5) * m * m;
  vec3 base = mix(cwFil, cwCluster, 0.45 * exp(-toNode * 0.5));
  float energy = bright * (0.55 + 0.7 * cwGlow + 0.3 * cwSwell);
  vec3 col = base * (core * (neural ? 1.0 : 0.16 * (0.35 + 0.65 * glow)) + halo * 0.05 * glow * glow) * energy;
  // Galaxies strung along it, scattered through its width (in Neural, the dendrites' spines).
  float reach = neural ? 0.25 : w * 1.2;
  if (d < reach + 0.3 + px * 2.0) {
    float sp = neural ? 0.5 : 0.22;
    float kx = floor(x / sp);
    for (int q = -2; q <= 2; q++) {
      uint hb = cwMix(h + uint(int(kx) + q + 4096) * 0x27d4eb2fu);
      if (cwRand(hb) > (neural ? 0.4 : 0.75)) continue;
      float sk = clamp((kx + float(q) + cwRand(hb)) * sp / len, 0.0, 1.0);
      vec3 g = cwBezier(a, b, c, e, sk) + (vec3(cwRand(hb), cwRand(hb), cwRand(hb)) - 0.5) * (2.0 * reach);
      vec2 dt = cwToPoint(ro, rd, g);
      float r0 = (neural ? 0.03 : 0.022) + 0.035 * cwRand(hb);
      float rb = max(r0, cwPixel * max(dt.y, 0.0) * 0.8);
      float lum = 0.5 + 4.0 * pow(cwRand(hb), 3.0);
      // (Right by the lens they'd be great flat discs, wider than the gate above: they fade out there.)
      col += cwBead * lum * (r0 / rb) * (r0 / rb) * exp(-dt.x * dt.x / (rb * rb)) * energy * smoothstep(1.5, 4.0, dt.y);
    }
  }
  // Neural: signals running out along the dendrite from a cell that fired.
  if (neural) {
    float v = CW_SIGNAL_SPEED;
    float sig = 0.0;
    for (int end = 0; end < 2; end++) {
      float age = end == 0 ? infoA.z : infoB.z;
      if (age < 0.0) continue;
      float at = age * v;
      if (at > len + 1.0) continue;
      float dx = (end == 0 ? x : len - x) - at;
      float rs = max(0.08, px * 0.8);
      sig += exp(-(dx * dx + d * d) / (rs * rs)) * (0.08 / rs) * (0.08 / rs) * 2.5 + (dx < 0.0 ? exp(dx * 0.7) : 0.0) * core * 0.8;
    }
    col += cwSignal * sig;
  }
  // The pulses: a white front, the palette's colour in its wake.
  // The pulses: a white front running along its spine, the palette's colour in its wake.
  vec3 pulse = cwPulses(p);
  float ws = 0.06;
  float wse = max(ws, px * 0.7);
  float spine = (ws / wse) * exp(-d * d / (wse * wse));
  pulse *= smoothstep(1.5, 7.0, t);
  col += cwSignal * pulse.x * (spine * 4.0 + halo * 0.08) + base * pulse.y * (spine * 0.9 + core * 0.06);
  return col * fade;
}

// Neural: a cell's own dendrites, short trees round its body (each bent once, forking once, tapering), counted in
// the cell where the ray passes nearest. When the cell fires, a signal runs out along each.
vec3 cwDendrites(vec3 ro, vec3 rd, float t0, float t1, vec3 p, vec4 info, uint h) {
  vec3 col = vec3(0.0);
  float fired = info.z;
  for (int k = 0; k < 5; k++) {
    vec3 dir = normalize(vec3(cwRand(h), cwRand(h), cwRand(h)) - 0.5 + 1e-4);
    vec3 bend = vec3(cwRand(h), cwRand(h), cwRand(h)) - 0.5;
    float L = 1.4 + 1.6 * cwRand(h);
    vec3 root = p + dir * 0.2;
    vec3 mid = root + dir * L * 0.5;
    vec3 tip = mid + normalize(dir + bend) * L * 0.5;
    vec3 fork = mid + normalize(dir - bend * 1.2) * L * 0.35;
    for (int q = 0; q < 3; q++) {
      vec3 pa = q == 0 ? root : mid;
      vec3 pb = q == 0 ? mid : q == 1 ? tip : fork;
      vec3 r = cwRaySeg(ro, rd, pa, pb);
      if (r.y < t0 || r.y >= t1 || r.x > 0.8) continue;
      float px = cwPixel * r.y;
      float u = (q == 0 ? 0.0 : 0.5) + 0.5 * r.z;
      float w = 0.07 * (1.0 - 0.85 * u);
      float we = max(w, px * 0.7);
      float m = 1.0 - r.x / 0.8;
      float glow = (w / we) * exp(-r.x * r.x / (we * we)) + exp(-r.x * 5.0) * m * m * 0.05;
      float sig = 0.0;
      if (fired >= 0.0) {
        float dx = u * L - fired * CW_SIGNAL_SPEED;
        sig = exp(-dx * dx * 4.0) * 3.0 + (dx < 0.0 ? exp(dx * 1.5) * 0.6 : 0.0);
      }
      float fade = (1.0 - smoothstep(cwEnd * 0.3, cwEnd, r.y)) * exp(-r.y * 0.015) * smoothstep(1.0, 4.0, r.y);
      col += (mix(cwCluster, cwFil, smoothstep(0.0, 0.6, u)) * min(info.x, 1.5) * (0.5 + 0.6 * cwGlow) + cwSignal * sig) * glow * fade;
    }
  }
  return col;
}

// Neural: the branches off a dendrite (a few, each bent once and forking once, tapering to nothing), counted like the
// filaments in the cell where the ray passes nearest. A signal running past a branch's root lights it.
vec3 cwBranches(vec3 ro, vec3 rd, float t0, float t1, vec3 a, vec3 b, vec3 c, vec3 e, uint h, float len, float bright, float ageA, float ageB) {
  vec3 col = vec3(0.0);
  uint hb = h ^ 0x51ed270bu;
  // A branch's light reaches no further than this, so it's within CW_M of the cell (with CW_TWIG).
  float reach = CW_M - CW_TWIG;
  for (int k = 0; k < 4; k++) {
    float sk = 0.1 + 0.8 * cwRand(hb);
    vec3 root = cwBezier(a, b, c, e, sk);
    vec3 tng = normalize(cwBezier(a, b, c, e, sk + 0.02) - cwBezier(a, b, c, e, sk - 0.02));
    vec3 o = vec3(cwRand(hb), cwRand(hb), cwRand(hb)) - 0.5;
    vec3 side = normalize(o - tng * dot(o, tng) + 1e-4);
    vec3 dir = normalize(side + tng * (cwRand(hb) - 0.5) * 1.4);
    float L = CW_TWIG * (0.45 + 0.55 * cwRand(hb));
    vec3 o2 = vec3(cwRand(hb), cwRand(hb), cwRand(hb)) - 0.5;
    vec3 mid = root + dir * L * 0.5;
    vec3 tip = mid + normalize(dir + o2 * 0.9) * L * 0.5;
    vec3 fork = mid + normalize(dir - o2 * 0.9) * L * 0.4;
    // Signals passing its root: from either end of the dendrite.
    float x = sk * len;
    float lit = 0.0;
    if (ageA >= 0.0) lit += exp(-abs(x - ageA * CW_SIGNAL_SPEED) * 0.8);
    if (ageB >= 0.0) lit += exp(-abs(len - x - ageB * CW_SIGNAL_SPEED) * 0.8);
    for (int q = 0; q < 3; q++) {
      vec3 pa = q == 0 ? root : mid;
      vec3 pb = q == 0 ? mid : q == 1 ? tip : fork;
      vec3 r = cwRaySeg(ro, rd, pa, pb);
      if (r.y < t0 || r.y >= t1 || r.x > reach) continue;
      float px = cwPixel * r.y;
      float u = (q == 0 ? 0.0 : 0.5) + 0.5 * r.z;
      float w = 0.028 * (1.0 - 0.75 * u);
      float we = max(w, px * 0.7);
      float m = 1.0 - r.x / reach;
      float glow = (w / we) * exp(-r.x * r.x / (we * we)) + exp(-r.x * 6.0) * m * m * 0.04;
      float fade = (1.0 - smoothstep(cwEnd * 0.3, cwEnd, r.y)) * exp(-r.y * 0.015);
      col += (cwFil * bright * (0.55 + 0.7 * cwGlow) + cwSignal * lit * 2.5 * (1.0 - u)) * glow * fade;
    }
  }
  return col;
}

// Everything whose closest approach to the ray lies in this cell (between t0 and t1): its 3x3x3 nodes and the
// filaments between them (those that could come near it: no two on the same outer face).
vec3 cwCell(ivec3 cell, vec3 ro, vec3 rd, float t0, float t1) {
  vec4 nP[27];
  vec4 nI[27];
  uint nH[27];
  for (int i = 0; i < 27; i++) {
    ivec3 c = cell + ivec3(i % 3, (i / 3) % 3, i / 9) - 1;
    uvec3 u = cwWrap(c);
    uint h = cwCellHash(u);
    nH[i] = h;
    float macro = cwMacro(u);
    vec3 j = vec3(cwRand(h), cwRand(h), cwRand(h)) - 0.5;
    bool exists = cwRand(h) < 0.25 + 0.85 * macro;
    float bright = cwRand(h);
    float band = cwRand(h);
    float fireAge = -1.0;
    if (style == 1) {
      float period = 1.3 + 2.6 * cwRand(h);
      float tt = cwTime + cwRand(h) * period;
      float cycle = floor(tt / period);
      uint hc = cwMix(nH[i] ^ (uint(int(cycle) + 65536) * 0x2c1b3c6du));
      if (cwRand(hc) < cwFire) fireAge = tt - cycle * period;
    }
    nP[i] = vec4((vec3(c) + 0.5 + j * (2.0 * CW_J)) * CW_S, macro);
    nI[i] = vec4(exists ? 0.3 + bright * bright * 1.2 * (0.5 + macro) : 0.0, band, fireAge, 0.0);
  }
  vec3 col = vec3(0.0);
  for (int i = 0; i < 27; i++) {
    if (nI[i].x <= 0.0) continue;
    vec3 v = nP[i].xyz - ro;
    float t = max(dot(v, rd), 0.0);
    float d = length(v - rd * t);
    // (Its dendrites reach 3.4 from it, and light 0.8 past that: well inside CW_REACH.)
    if (style == 1 && d < 4.3) col += cwDendrites(ro, rd, t0, t1, nP[i].xyz, nI[i], nH[i] + 0x2545f491u);
    if (t < t0 || t >= t1) continue;
    if (d < CW_REACH) col += cwNodeLight(ro, rd, d, t, nI[i], nP[i].xyz, nH[i] + 0x5bd1e995u);
  }
  for (int k = 0; k < 13; k++) {
    ivec3 D = CW_DIRS[k];
    ivec3 lo = ivec3(D.x > 0 ? -1 : 0, D.y > 0 ? -1 : 0, D.z > 0 ? -1 : 0);
    ivec3 hi = ivec3(D.x < 0 ? 1 : 0, D.y < 0 ? 1 : 0, D.z < 0 ? 1 : 0);
    float keepK = density * (k < 3 ? 0.7 : k < 9 ? 0.42 : 0.4);
    // (How far past its chord a filament's light can reach: its bow, and in Neural its branches.)
    float pad = CW_BOW + (style == 1 ? CW_TWIG : 0.0);
    for (int z = lo.z; z <= hi.z; z++)
    for (int y = lo.y; y <= hi.y; y++)
    for (int x = lo.x; x <= hi.x; x++) {
      int ia = (x + 1) + 3 * (y + 1) + 9 * (z + 1);
      int ib = (x + D.x + 1) + 3 * (y + D.y + 1) + 9 * (z + D.z + 1);
      if (nI[ia].x <= 0.0 || nI[ib].x <= 0.0) continue;
      vec3 pa = nP[ia].xyz;
      vec3 pb = nP[ib].xyz;
      // Is it within reach of the ray in this cell at all? (The curve stays within CW_BOW of its chord.)
      float ta = dot(pa - ro, rd);
      float tb = dot(pb - ro, rd);
      if (max(max(ta, tb) + pad, 0.0) < t0 || max(min(ta, tb) - pad, 0.0) >= t1) continue;
      vec3 chord = pb - pa;
      float len = length(chord);
      uint h = cwMix(nH[ia] + uint(k) * 0x632be5abu + 0x1b873593u);
      float keep = keepK * (1.0 - smoothstep(1.05, 1.9, len / CW_S)) * (0.25 + 0.425 * (nP[ia].w + nP[ib].w));
      if (cwRand(h) >= keep) continue;
      if (cwRaySeg(ro, rd, pa, pb).x > CW_M + pad) continue;
      vec3 dn = chord / len;
      vec3 o1 = (vec3(cwRand(h), cwRand(h), cwRand(h)) - 0.5) * (2.0 * CW_BOW);
      o1 -= dn * dot(o1, dn);
      o1 *= min(1.0, CW_BOW / max(length(o1), 1e-6));
      vec3 o2 = (vec3(cwRand(h), cwRand(h), cwRand(h)) - 0.5) * (2.0 * CW_BOW);
      o2 -= dn * dot(o2, dn);
      o2 *= min(1.0, CW_BOW / max(length(o2), 1e-6));
      vec3 c1 = pa + chord / 3.0 + o1;
      vec3 c2 = pa + chord * (2.0 / 3.0) + o2;
      // The closest approach to the curve: from its four chords, the nearest weighted most, softly (where two parts
      // of a bent filament are about as near the ray, a hard choice would cut its light along a seam).
      vec3 r4[4];
      float bd = 1e9;
      vec3 prev = pa;
      for (int q = 0; q < 4; q++) {
        vec3 cur = cwBezier(pa, c1, c2, pb, float(q + 1) * 0.25);
        r4[q] = cwRaySeg(ro, rd, prev, cur);
        bd = min(bd, r4[q].x);
        prev = cur;
      }
      float soft = 0.12 + cwPixel * r4[0].y;
      float wsum = 0.0;
      float bs = 0.0;
      for (int q = 0; q < 4; q++) {
        float wq = exp(-(r4[q].x - bd) / soft);
        wsum += wq;
        bs += wq * (float(q) + r4[q].z) * 0.25;
      }
      bs /= wsum;
      float rb = cwRand(h);
      float bright = (0.12 + 1.5 * rb * rb * rb) * (0.6 + 0.4 * (nP[ia].w + nP[ib].w));
      if (style == 1) col += cwBranches(ro, rd, t0, t1, pa, c1, c2, pb, h, len, bright, nI[ia].z, nI[ib].z);
      vec3 p = cwBezier(pa, c1, c2, pb, bs);
      float t = max(dot(p - ro, rd), 0.0);
      if (t < t0 || t >= t1) continue;
      // (Its distance at t, so it's within CW_M of this cell: the margin says it's then among this cell's filaments.)
      float d = length(p - ro - rd * t);
      if (d >= CW_M) continue;
      col += cwFilamentLight(ro, rd, d, t, bs, len, pa, c1, c2, pb, h, bright, nI[ia], nI[ib]);
    }
  }
  return col;
}

vec3 scene(vec2 uv) {
  vec3 ro = camPos;
  vec3 rd = cameraRay(uv);
  cwPalette();
  cwEnd = mix(42.0, 78.0, quality);
  cwPixel = 2.0 * camLens / min(resolution.x, resolution.y);
  // Walk the lattice's cells along the ray (a DDA).
  ivec3 cell = ivec3(floor(ro / CW_S));
  vec3 r = vec3(abs(rd.x) < 1e-6 ? 1e-6 : rd.x, abs(rd.y) < 1e-6 ? 1e-6 : rd.y, abs(rd.z) < 1e-6 ? 1e-6 : rd.z);
  ivec3 stp = ivec3(r.x > 0.0 ? 1 : -1, r.y > 0.0 ? 1 : -1, r.z > 0.0 ? 1 : -1);
  vec3 tDelta = abs(CW_S / r);
  vec3 tMax = ((vec3(cell) + step(0.0, r)) * CW_S - ro) / r;
  float t0 = 0.0;
  vec3 col = vec3(0.0);
  for (int i = 0; i < 40; i++) {
    float t1 = min(tMax.x, min(tMax.y, tMax.z));
    col += cwCell(cell, ro, rd, t0, min(t1, cwEnd));
    if (t1 >= cwEnd) break;
    t0 = t1;
    if (tMax.x <= tMax.y && tMax.x <= tMax.z) { cell.x += stp.x; tMax.x += tDelta.x; }
    else if (tMax.y <= tMax.z) { cell.y += stp.y; tMax.y += tDelta.y; }
    else { cell.z += stp.z; tMax.z += tDelta.z; }
  }
  return col * (0.75 + 0.25 * glow) * (0.7 + 0.5 * cwGlow);
}
`,
  init: () => ({
    started: false,
    time: 0,
    from: [0, 0, 0],
    to: [1, 0, 0],
    next: [2, 0, 0],
    curve: [
      [0, 0, 0],
      [3, 0, 0],
      [7, 0, 0],
      [10, 0, 0],
    ],
    nextCurve: [
      [10, 0, 0],
      [13, 0, 0],
      [17, 0, 0],
      [20, 0, 0],
    ],
    s: 0,
    len: 10,
    side: [0, 1, 0],
    pos: [0, 0, 0],
    fwd: [0, 0, 1],
    up: [0, 1, 0],
    roll: 0,
    speed: 3,
    twist: 0,
    glow: 0.4,
    swell: 0,
    fire: 0.2,
    pulses: [],
    rng: { seed: 0x3c0577e6 },
  }),
  step(s, frame) {
    const dt = sceneDt(frame);
    const a = frame.follow;
    const dens = densityOf(frame.values);
    if (!s.started) start(s, dens);
    s.time += dt;
    s.glow = smoothTo(s.glow, a.level, frame.dt, 0.15);
    s.swell = smoothTo(s.swell, a.bass, frame.dt, 0.12);
    s.fire = smoothTo(s.fire, 0.15 + 0.55 * a.level + 0.25 * a.high, frame.dt, 0.4);
    s.twist = Math.max(0, s.twist - frame.dt * 0.6);
    s.speed = smoothTo(s.speed, 2.4 + 3.5 * a.bass + 2.5 * a.punch, frame.dt, 0.5);

    // Along the filament; at its end, on to the next, choosing the one after.
    s.s += (s.speed * dt) / s.len;
    while (s.s >= 1) {
      const over = (s.s - 1) * s.len;
      const inDir = chordDir(s.nextCurve);
      const chosen = chooseNext(s, s.to, s.next, inDir, dens);
      s.from = s.to;
      s.to = s.next;
      s.curve = s.nextCurve;
      s.len = curveLength(s.curve);
      s.next = chosen.to;
      s.nextCurve = chosen.curve;
      s.s = over / s.len;
    }
    // Round it to the side furthest from the other filaments, then beside it there, eased (so the corners round off).
    const t = tangentAt(s.curve, s.s);
    s.side = turnTowards(square(s.side, t), bestSide(s, dens), 2.4 * dt, t);
    const eased = add(s.pos, scale(sub(besideAt(s), s.pos), 1 - Math.exp(-frame.dt / 0.25)));
    s.pos = keepClear(eased, dens);
    // Looking ahead along the walk, the up kept square to the look (there's no up in space), banked into turns.
    const look = normalize(sub(ahead(s, s.s, 9), s.pos));
    const fwd = normalize(add(s.fwd, scale(sub(look, s.fwd), 1 - Math.exp(-frame.dt / 0.45))));
    const right = normalize(cross(s.fwd, s.up));
    const yaw = dot(sub(fwd, s.fwd), right) / Math.max(frame.dt, 1e-4);
    s.fwd = fwd;
    s.up = normalize(sub(s.up, scale(fwd, dot(s.up, fwd))));
    s.roll = smoothTo(s.roll, Math.max(-0.45, Math.min(0.45, -0.5 * yaw)) + 0.08 * Math.sin(s.time * 0.21), frame.dt, 0.7);

    // Each hit: a pulse from the cluster ahead, and a sharper turn at the next node.
    for (const p of s.pulses) p.age += dt;
    s.pulses = s.pulses.filter((p) => p.age < 4);
    if (a.onBeat) {
      const node = (1 - s.s) * s.len > 5 ? s.curve[3] : s.nextCurve[3];
      s.pulses.push({ x: node[0], y: node[1], z: node[2], age: 0, power: 0.45 + 0.75 * clamp01(frame.hit) });
      if (s.pulses.length > PULSES) s.pulses.shift();
      s.twist = 1;
    }
    wrapWorld(s);
  },
  uniforms(s, frame) {
    const powers = Array.from({ length: PULSES }, (_, i) => s.pulses[i]?.power ?? 0);
    return [
      ...cameraLooking(s.pos, s.fwd, s.roll, 72, s.up),
      ...soundUniforms(frame),
      float("cwTime", s.time),
      float("cwGlow", s.glow),
      float("cwSwell", s.swell),
      float("cwFire", s.fire),
      ...Array.from({ length: PULSES }, (_, i) => {
        const p = s.pulses[i];
        return vec4(`cwPulse${i}`, p ? [p.x, p.y, p.z, p.age] : [0, 0, 0, -1]);
      }),
      vec4("cwPower", powers),
    ];
  },
};
