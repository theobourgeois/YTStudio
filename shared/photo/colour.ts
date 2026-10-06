/**
 * Sources into the working space (docs/photo/rendering.md, "Getting sources in"): an image's ICC profile read
 * from untrusted bytes, turned into what the GPU needs to bring its samples into extended linear sRGB
 * (a transfer curve per channel, then a matrix, never clipped), and the reference maths the GPU is tested
 * against. Matrix/TRC profiles only: anything needing a LUT is `unsupported` here and goes through the helper.
 */

/** A 3×3 matrix, row-major. */
export type Mat3 = [number, number, number, number, number, number, number, number, number];
type Vec3 = [number, number, number];

export const IDENTITY3: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];

export function mat3Multiply(a: Mat3, b: Mat3): Mat3 {
  const out = new Array<number>(9) as Mat3;
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      out[r * 3 + c] = a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c];
    }
  }
  return out;
}

/** The inverse, by cofactors. Throws on a singular (or non-finite) matrix, judged relative to its scale. */
export function mat3Invert(m: Mat3): Mat3 {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h;
  const B = f * g - d * i;
  const C = d * h - e * g;
  const det = a * A + b * B + c * C;
  const scale = Math.max(...m.map(Math.abs));
  if (!Number.isFinite(det) || scale === 0 || Math.abs(det) <= 1e-12 * scale ** 3) {
    throw new Error("mat3Invert: the matrix is singular");
  }
  const k = 1 / det;
  return [
    A * k, (c * h - b * i) * k, (b * f - c * e) * k,
    B * k, (a * i - c * g) * k, (c * d - a * f) * k,
    C * k, (b * g - a * h) * k, (a * e - b * d) * k,
  ];
}

export function mat3Apply(m: Mat3, v: readonly [number, number, number]): [number, number, number] {
  return [
    m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
    m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
    m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
  ];
}

const diagonal = (v: readonly [number, number, number]): Mat3 => [v[0], 0, 0, 0, v[1], 0, 0, 0, v[2]];

// ---------------------------------------------------------------------------------------------------------
// sRGB's curve

/**
 * Where the inverse curve changes piece. IEC 61966-2-1 rounds it to 0.0031308, which leaves a sliver
 * (linear values between 0.0031308 and 0.04045 / 12.92) where the two directions use different pieces and
 * don't round-trip; the exact image of the forward threshold makes them true inverses.
 */
const SRGB_LINEAR_KNEE = 0.04045 / 12.92;

/** sRGB's transfer curve (IEC 61966-2-1), exact, sign-mirrored so extended values work: f(-x) = -f(x). */
export function srgbToLinear(v: number): number {
  const a = Math.abs(v);
  const l = a <= 0.04045 ? a / 12.92 : ((a + 0.055) / 1.055) ** 2.4;
  return v < 0 ? -l : l;
}

/** The inverse of `srgbToLinear`, sign-mirrored too. */
export function linearToSrgb(l: number): number {
  const a = Math.abs(l);
  const v = a <= SRGB_LINEAR_KNEE ? a * 12.92 : 1.055 * a ** (1 / 2.4) - 0.055;
  return l < 0 ? -v : v;
}

/** An sRGB "#rrggbb" as linear light. */
export function hexToLinear(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16);
  return [srgbToLinear(((n >> 16) & 255) / 255), srgbToLinear(((n >> 8) & 255) / 255), srgbToLinear((n & 255) / 255)];
}

// ---------------------------------------------------------------------------------------------------------
// Primaries and the PCS

/** The ICC PCS illuminant, D50, exactly as s15Fixed16 stores it (0x0000F6D6, 0x00010000, 0x0000D32D). */
export const D50: readonly [number, number, number] = [0xf6d6 / 65536, 1, 0xd32d / 65536];

/** Chromaticities (x, y) of a space's red, green and blue primaries. */
export type Primaries = readonly [readonly [number, number], readonly [number, number], readonly [number, number]];

export const SRGB_PRIMARIES: Primaries = [[0.64, 0.33], [0.3, 0.6], [0.15, 0.06]];
export const D65_XY: readonly [number, number] = [0.3127, 0.329];

const BRADFORD: Mat3 = [0.8951, 0.2664, -0.1614, -0.7502, 1.7135, 0.0367, 0.0389, -0.0685, 1.0296];

const xyToXyz = ([x, y]: readonly [number, number]): Vec3 => [x / y, 1, (1 - x - y) / y];

/**
 * Linear RGB to XYZ D50 for a space given by its primaries and white, adapted to D50 by Bradford: what a
 * matrix/TRC profile's colorants are. The tests build profiles with it, and sRGB's own is the PCS's way out.
 */
export function primariesToXyzD50(primaries: Primaries, white: readonly [number, number]): Mat3 {
  const [r, g, b] = primaries.map(xyToXyz);
  const columns: Mat3 = [r[0], g[0], b[0], r[1], g[1], b[1], r[2], g[2], b[2]];
  const w = xyToXyz(white);
  const s = mat3Apply(mat3Invert(columns), w);
  const toXyz = mat3Multiply(columns, diagonal(s));
  const from = mat3Apply(BRADFORD, w);
  const to = mat3Apply(BRADFORD, D50);
  const adapt = mat3Multiply(mat3Invert(BRADFORD), mat3Multiply(diagonal([to[0] / from[0], to[1] / from[1], to[2] / from[2]]), BRADFORD));
  return mat3Multiply(adapt, toXyz);
}

/** Linear sRGB to XYZ D50, computed from sRGB's definition rather than copied. */
export const SRGB_TO_XYZ_D50: Mat3 = primariesToXyzD50(SRGB_PRIMARIES, D65_XY);
const XYZ_D50_TO_SRGB: Mat3 = mat3Invert(SRGB_TO_XYZ_D50);

// ---------------------------------------------------------------------------------------------------------
// Curves

export type Curve =
  | { type: "identity" }
  | { type: "gamma"; gamma: number }
  /** A `curv` with n >= 2 entries, each /65535, linearly interpolated. */
  | { type: "table"; values: Float64Array }
  /** ICC `para`: g; g,a,b; g,a,b,c; g,a,b,c,d; g,a,b,c,d,e,f. */
  | { type: "parametric"; fn: 0 | 1 | 2 | 3 | 4; params: number[] };

const PARAMETRIC_COUNTS = [1, 3, 4, 5, 7] as const;

/** A power with negative bases taken as 0, so a malformed curve gives numbers rather than NaN where it can. */
const power = (base: number, g: number) => (base <= 0 ? 0 : base ** g);

/** A curve at x in [0, 1] (clamped into it), as ICC.1:2022 10.6 / 10.18 define. */
export function evalCurve(curve: Curve, x: number): number {
  const t = Math.min(1, Math.max(0, Number.isNaN(x) ? 0 : x));
  switch (curve.type) {
    case "identity":
      return t;
    case "gamma":
      return power(t, curve.gamma);
    case "table": {
      const values = curve.values;
      const at = t * (values.length - 1);
      const i = Math.min(values.length - 2, Math.floor(at));
      const f = at - i;
      return values[i] + (values[i + 1] - values[i]) * f;
    }
    case "parametric": {
      const [g, a = 0, b = 0, c = 0, d = 0, e = 0, f = 0] = curve.params;
      switch (curve.fn) {
        case 0:
          return power(t, g);
        case 1:
          return t >= -b / a ? power(a * t + b, g) : 0;
        case 2:
          return t >= -b / a ? power(a * t + b, g) + c : c;
        case 3:
          return t >= d ? power(a * t + b, g) : c * t;
        case 4:
          return t >= d ? power(a * t + b, g) + e : c * t + f;
      }
    }
  }
}

// ---------------------------------------------------------------------------------------------------------
// Parsing

export interface IccProfile {
  /** "4.0", "2.1"... */
  version: string;
  /** 'mntr', 'scnr'... (trimmed). */
  deviceClass: string;
  /** 'RGB', 'GRAY'... (trimmed). */
  colourSpace: string;
  /** 'XYZ' or 'Lab'. */
  pcs: string;
  /** From 'desc' (v2 ASCII, or v4's first localised record); null if absent or unreadable. */
  description: string | null;
  whitePoint: [number, number, number] | null;
  /** Columns rXYZ, gXYZ, bXYZ: device linear RGB to PCS XYZ D50. Null unless all three are present. */
  colorants: Mat3 | null;
  /** rTRC, gTRC, bTRC; null unless all three are present. */
  curves: [Curve, Curve, Curve] | null;
  grayCurve: Curve | null;
  chad: Mat3 | null;
  /** A2B0/A2B1/A2B2 or B2A0 present. */
  hasLut: boolean;
}

interface TagEntry {
  offset: number;
  size: number;
}

/** Bounds-checked big-endian reads over a profile's first `size` bytes. */
class Reader {
  constructor(
    private readonly bytes: Uint8Array,
    readonly size: number,
  ) {}

  need(offset: number, length: number, what: string) {
    if (offset < 0 || length < 0 || offset + length > this.size) {
      throw new Error(`ICC profile: ${what} runs past the end of the profile`);
    }
  }

  u8(o: number) {
    this.need(o, 1, "a byte");
    return this.bytes[o];
  }

  u16(o: number) {
    this.need(o, 2, "a 16-bit number");
    return (this.bytes[o] << 8) | this.bytes[o + 1];
  }

  u32(o: number) {
    this.need(o, 4, "a 32-bit number");
    return ((this.bytes[o] << 24) | (this.bytes[o + 1] << 16) | (this.bytes[o + 2] << 8) | this.bytes[o + 3]) >>> 0;
  }

  s15Fixed16(o: number) {
    return (this.u32(o) | 0) / 65536;
  }

  sig(o: number) {
    this.need(o, 4, "a signature");
    return String.fromCharCode(this.bytes[o], this.bytes[o + 1], this.bytes[o + 2], this.bytes[o + 3]);
  }
}

const LUT_TAGS = ["A2B0", "A2B1", "A2B2", "B2A0"];

/** Parses untrusted bytes; throws an Error with a clear message on anything malformed (every read is bounds-checked). */
export function parseIcc(bytes: Uint8Array): IccProfile {
  if (bytes.length < 132) throw new Error(`ICC profile: ${bytes.length} bytes is too short for a header and tag count`);
  const declared = new Reader(bytes, bytes.length).u32(0);
  if (declared > bytes.length) throw new Error(`ICC profile: truncated (says ${declared} bytes, has ${bytes.length})`);
  if (declared < 132) throw new Error(`ICC profile: its declared size (${declared} bytes) is too small`);
  const r = new Reader(bytes, declared);
  if (r.sig(36) !== "acsp") throw new Error("ICC profile: missing the 'acsp' signature");

  const count = r.u32(128);
  r.need(132, count * 12, `the tag table (${count} tags)`);
  const tags = new Map<string, TagEntry>();
  for (let i = 0; i < count; i++) {
    const at = 132 + i * 12;
    const signature = r.sig(at);
    const offset = r.u32(at + 4);
    const size = r.u32(at + 8);
    r.need(offset, size, `tag '${signature}'`);
    if (!tags.has(signature)) tags.set(signature, { offset, size });
  }

  const xyz = (signature: string): Vec3 | null => {
    const tag = tags.get(signature);
    if (!tag) return null;
    if (tag.size < 20 || r.sig(tag.offset) !== "XYZ ") throw new Error(`ICC profile: tag '${signature}' isn't an XYZ`);
    return [r.s15Fixed16(tag.offset + 8), r.s15Fixed16(tag.offset + 12), r.s15Fixed16(tag.offset + 16)];
  };
  const curve = (signature: string): Curve | null => {
    const tag = tags.get(signature);
    return tag ? readCurve(r, tag, signature) : null;
  };

  const red = xyz("rXYZ");
  const green = xyz("gXYZ");
  const blue = xyz("bXYZ");
  const rTrc = curve("rTRC");
  const gTrc = curve("gTRC");
  const bTrc = curve("bTRC");
  const chadTag = tags.get("chad");
  let chad: Mat3 | null = null;
  if (chadTag) {
    if (chadTag.size < 44 || r.sig(chadTag.offset) !== "sf32") throw new Error("ICC profile: tag 'chad' isn't an sf32 matrix");
    chad = Array.from({ length: 9 }, (_, i) => r.s15Fixed16(chadTag.offset + 8 + i * 4)) as Mat3;
  }

  let description: string | null = null;
  const descTag = tags.get("desc");
  if (descTag) {
    try {
      description = readDescription(r, descTag);
    } catch {
      description = null;
    }
  }

  return {
    version: `${r.u8(8)}.${r.u8(9) >> 4}`,
    deviceClass: r.sig(12).trim(),
    colourSpace: r.sig(16).trim(),
    pcs: r.sig(20).trim(),
    description,
    whitePoint: xyz("wtpt"),
    colorants: red && green && blue ? [red[0], green[0], blue[0], red[1], green[1], blue[1], red[2], green[2], blue[2]] : null,
    curves: rTrc && gTrc && bTrc ? [rTrc, gTrc, bTrc] : null,
    grayCurve: curve("kTRC"),
    chad,
    hasLut: LUT_TAGS.some((t) => tags.has(t)),
  };
}

function readCurve(r: Reader, { offset, size }: TagEntry, signature: string): Curve {
  const type = size >= 12 ? r.sig(offset) : "";
  if (type === "curv") {
    const n = r.u32(offset + 8);
    if (size < 12 + 2 * n) throw new Error(`ICC profile: curve '${signature}' says ${n} entries but is ${size} bytes`);
    if (n === 0) return { type: "identity" };
    if (n === 1) return { type: "gamma", gamma: r.u16(offset + 12) / 256 };
    const values = new Float64Array(n);
    for (let i = 0; i < n; i++) values[i] = r.u16(offset + 12 + i * 2) / 65535;
    return { type: "table", values };
  }
  if (type === "para") {
    const fn = r.u16(offset + 8);
    if (fn > 4) throw new Error(`ICC profile: curve '${signature}' has an unknown parametric function (${fn})`);
    const n = PARAMETRIC_COUNTS[fn];
    if (size < 12 + 4 * n) throw new Error(`ICC profile: curve '${signature}' is too short for its ${n} parameters`);
    const params = Array.from({ length: n }, (_, i) => r.s15Fixed16(offset + 12 + i * 4));
    return { type: "parametric", fn: fn as 0 | 1 | 2 | 3 | 4, params };
  }
  throw new Error(`ICC profile: curve '${signature}' is neither 'curv' nor 'para'`);
}

function readDescription(r: Reader, { offset, size }: TagEntry): string | null {
  if (size < 12) return null;
  const type = r.sig(offset);
  if (type === "desc") {
    const n = r.u32(offset + 8);
    if (n === 0 || size < 12 + n) return null;
    let text = "";
    for (let i = 0; i < n; i++) {
      const c = r.u8(offset + 12 + i);
      if (c === 0) break;
      text += String.fromCharCode(c);
    }
    return text.trim() || null;
  }
  if (type === "mluc") {
    const records = r.u32(offset + 8);
    const recordSize = r.u32(offset + 12);
    if (records === 0 || recordSize < 12 || size < 16 + recordSize) return null;
    const length = r.u32(offset + 16 + 4);
    const start = r.u32(offset + 16 + 8);
    if (start + length > size) return null;
    let text = "";
    for (let i = 0; i + 1 < length; i += 2) text += String.fromCharCode(r.u16(offset + start + i));
    return text.replace(/\0+$/, "").trim() || null;
  }
  return null;
}

// ---------------------------------------------------------------------------------------------------------
// Transforms

export type SourceTransform =
  /** Exactly sRGB: the GPU uses the exact sRGB curve and no matrix. */
  | { kind: "srgb"; reason: "untagged" | "srgb-profile" }
  /** Device linear RGB to linear sRGB, after each channel's curve. */
  | { kind: "matrix"; curves: [Curve, Curve, Curve]; matrix: Mat3; description: string | null }
  | { kind: "unsupported"; reason: string; description: string | null };

/** How close a profile must be to sRGB to be treated as sRGB (matrix elementwise, curves in linear light). */
const SNAP_MATRIX = 2e-3;
const SNAP_CURVE = 2e-4;
const CURVE_SAMPLES = 1024;

/** Device classes whose profiles don't describe a source's colours. */
const NOT_SOURCES: Record<string, string> = { link: "a device link", abst: "an abstract profile", nmcl: "a named colour profile" };

/**
 * What converting a source with this profile into linear sRGB takes. Matrix/TRC RGB profiles with an XYZ
 * PCS become `matrix` (even with LUTs beside them: the matrix is the colorimetric description); one
 * equivalent to sRGB (curves within tolerance of sRGB's, matrix within tolerance of identity) snaps to `srgb`
 * so 8-bit sRGB round trips are bit-exact; anything else (LUT-only, Lab PCS, GRAY, CMYK, malformed) is
 * `unsupported` with a reason a user can read. Never throws.
 */
export function sourceTransform(icc: Uint8Array | null): SourceTransform {
  if (icc === null) return { kind: "srgb", reason: "untagged" };
  let profile: IccProfile;
  try {
    profile = parseIcc(icc);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { kind: "unsupported", reason: `The colour profile can't be read (${message}).`, description: null };
  }
  const { description } = profile;
  const unsupported = (reason: string): SourceTransform => ({ kind: "unsupported", reason, description });

  if (NOT_SOURCES[profile.deviceClass]) return unsupported(`The colour profile is ${NOT_SOURCES[profile.deviceClass]}, not an image's.`);
  if (profile.colourSpace !== "RGB") return unsupported(`The colour profile is for ${profile.colourSpace} images, not RGB.`);
  if (profile.pcs !== "XYZ") return unsupported(`The colour profile connects through ${profile.pcs}, not XYZ.`);
  if (!profile.colorants || !profile.curves) {
    return unsupported(
      profile.hasLut
        ? "The colour profile is LUT-based (it has no matrix and curves)."
        : "The colour profile has no colorants or transfer curves.",
    );
  }

  let matrix: Mat3;
  try {
    matrix = mat3Multiply(XYZ_D50_TO_SRGB, profile.colorants);
    mat3Invert(profile.colorants);
  } catch {
    return unsupported("The colour profile's colorants don't make a usable matrix.");
  }
  if (!matrix.every(Number.isFinite)) return unsupported("The colour profile's colorants don't make a usable matrix.");

  const curves = profile.curves;
  let curvesAreSrgb = true;
  for (let i = 0; i < CURVE_SAMPLES; i++) {
    const x = i / (CURVE_SAMPLES - 1);
    const target = srgbToLinear(x);
    for (const curve of curves) {
      const y = evalCurve(curve, x);
      if (!Number.isFinite(y)) return unsupported("The colour profile's transfer curves give invalid values.");
      if (Math.abs(y - target) > SNAP_CURVE) curvesAreSrgb = false;
    }
  }
  if (curvesAreSrgb && matrix.every((v, i) => Math.abs(v - IDENTITY3[i]) <= SNAP_MATRIX)) {
    return { kind: "srgb", reason: "srgb-profile" };
  }
  return { kind: "matrix", curves, matrix, description };
}

/**
 * The transfer curve as a lookup table for every code of a `bits`-bit sample (2^bits entries, entry i is the
 * curve at i / (2^bits - 1)), computed in double precision and stored as f32: what the GPU indexes. For
 * `srgb` transforms use the exact sRGB curve.
 */
export function transferLut(curve: Curve | "srgb", bits: 8 | 16): Float32Array {
  const size = 2 ** bits;
  const lut = new Float32Array(size);
  for (let i = 0; i < size; i++) {
    const x = i / (size - 1);
    lut[i] = curve === "srgb" ? srgbToLinear(x) : evalCurve(curve, x);
  }
  return lut;
}

/**
 * Reference conversion of one pixel's samples (each in [0, 1]) to linear sRGB, as the GPU must do it.
 * Nothing is clipped. An unsupported profile is read as sRGB, which is what the app falls back to.
 */
export function toLinearSrgb(t: SourceTransform, rgb: readonly [number, number, number]): [number, number, number] {
  if (t.kind !== "matrix") return [srgbToLinear(rgb[0]), srgbToLinear(rgb[1]), srgbToLinear(rgb[2])];
  const [r, g, b] = t.curves;
  return mat3Apply(t.matrix, [evalCurve(r, rgb[0]), evalCurve(g, rgb[1]), evalCurve(b, rgb[2])]);
}
