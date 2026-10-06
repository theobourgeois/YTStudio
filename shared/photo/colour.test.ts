import { describe, expect, it } from "vitest";
import {
  type Curve,
  type Mat3,
  type Primaries,
  D65_XY,
  IDENTITY3,
  SRGB_PRIMARIES,
  SRGB_TO_XYZ_D50,
  evalCurve,
  linearToSrgb,
  mat3Apply,
  mat3Invert,
  mat3Multiply,
  parseIcc,
  primariesToXyzD50,
  sourceTransform,
  srgbToLinear,
  toLinearSrgb,
  transferLut,
} from "./colour.ts";

// ---------------------------------------------------------------------------------------------------------
// A small ICC writer, so every profile here is made in the test.

const ascii = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0));

class Bytes {
  private readonly parts: number[] = [];
  sig(s: string) {
    this.parts.push(...ascii(s.padEnd(4, " ").slice(0, 4)));
    return this;
  }
  u16(v: number) {
    this.parts.push((v >> 8) & 0xff, v & 0xff);
    return this;
  }
  u32(v: number) {
    this.parts.push((v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff);
    return this;
  }
  s15(v: number) {
    return this.u32(Math.round(v * 65536) >>> 0);
  }
  raw(bytes: ArrayLike<number>) {
    this.parts.push(...Array.from(bytes));
    return this;
  }
  done() {
    return Uint8Array.from(this.parts);
  }
}

const xyzTag = (v: readonly number[]) => new Bytes().sig("XYZ ").u32(0).s15(v[0]).s15(v[1]).s15(v[2]).done();
const curvGamma = (g: number) => new Bytes().sig("curv").u32(0).u32(1).u16(Math.round(g * 256)).done();
const curvTable = (values: readonly number[]) => {
  const b = new Bytes().sig("curv").u32(0).u32(values.length);
  for (const v of values) b.u16(Math.round(v * 65535));
  return b.done();
};
const paraTag = (fn: number, params: readonly number[]) => {
  const b = new Bytes().sig("para").u32(0).u16(fn).u16(0);
  for (const p of params) b.s15(p);
  return b.done();
};
const sf32Tag = (m: Mat3) => {
  const b = new Bytes().sig("sf32").u32(0);
  for (const v of m) b.s15(v);
  return b.done();
};
const descTag = (text: string) => {
  // v2 textDescriptionType: ASCII, then empty Unicode and ScriptCode parts.
  return new Bytes().sig("desc").u32(0).u32(text.length + 1).raw(ascii(text)).raw([0]).u32(0).u32(0).u16(0).raw(new Array(67).fill(0)).done();
};
const mlucTag = (text: string) => {
  const b = new Bytes().sig("mluc").u32(0).u32(1).u32(12).sig("enUS").u32(text.length * 2).u32(28);
  for (const c of text) b.u16(c.charCodeAt(0));
  return b.done();
};
const lutStub = () => new Bytes().sig("mAB ").u32(0).raw([3, 3, 0, 0]).raw(new Array(20).fill(0)).done();

interface ProfileOptions {
  version?: [number, number];
  deviceClass?: string;
  colourSpace?: string;
  pcs?: string;
  tags: [string, Uint8Array][];
}

function buildIcc({ version = [4, 0], deviceClass = "mntr", colourSpace = "RGB ", pcs = "XYZ ", tags }: ProfileOptions): Uint8Array {
  const tableEnd = 132 + tags.length * 12;
  const offsets: number[] = [];
  let at = tableEnd;
  for (const [, data] of tags) {
    offsets.push(at);
    at += Math.ceil(data.length / 4) * 4;
  }
  const out = new Bytes()
    .u32(at)
    .sig("test")
    .raw([version[0], version[1] << 4, 0, 0])
    .sig(deviceClass)
    .sig(colourSpace)
    .sig(pcs)
    .raw(new Array(12).fill(0))
    .sig("acsp")
    .raw(new Array(128 - 40).fill(0))
    .u32(tags.length);
  tags.forEach(([signature, data], i) => out.sig(signature).u32(offsets[i]).u32(data.length));
  for (const [, data] of tags) out.raw(data).raw(new Array(Math.ceil(data.length / 4) * 4 - data.length).fill(0));
  return out.done();
}

const colorantTags = (m: Mat3): [string, Uint8Array][] => [
  ["rXYZ", xyzTag([m[0], m[3], m[6]])],
  ["gXYZ", xyzTag([m[1], m[4], m[7]])],
  ["bXYZ", xyzTag([m[2], m[5], m[8]])],
];
const trcTags = (tag: Uint8Array): [string, Uint8Array][] => [
  ["rTRC", tag],
  ["gTRC", tag],
  ["bTRC", tag],
];
const D50_WTPT = xyzTag([0.9642, 1, 0.8249]);
const BRADFORD_D65_TO_D50: Mat3 = [1.0478, 0.0229, -0.0502, 0.0295, 0.9905, -0.0171, -0.0092, 0.0151, 0.7519];

const SRGB_PARAMS = [2.4, 1 / 1.055, 0.055 / 1.055, 1 / 12.92, 0.04045];
const P3_PRIMARIES: Primaries = [[0.68, 0.32], [0.265, 0.69], [0.15, 0.06]];
const ADOBE_PRIMARIES: Primaries = [[0.64, 0.33], [0.21, 0.71], [0.15, 0.06]];

/** sRGB v2-style, as HP's: a 1024-entry table. */
const srgbV2 = (colorants: Mat3 = SRGB_TO_XYZ_D50) =>
  buildIcc({
    version: [2, 1],
    tags: [
      ["desc", descTag("sRGB IEC61966-2.1")],
      ["wtpt", xyzTag([0.95045, 1, 1.08905])],
      ...colorantTags(colorants),
      ...trcTags(curvTable(Array.from({ length: 1024 }, (_, i) => srgbToLinear(i / 1023)))),
    ],
  });

const displayP3 = () =>
  buildIcc({
    tags: [
      ["desc", mlucTag("Display P3")],
      ["wtpt", D50_WTPT],
      ...colorantTags(primariesToXyzD50(P3_PRIMARIES, D65_XY)),
      ...trcTags(paraTag(3, SRGB_PARAMS)),
      ["chad", sf32Tag(BRADFORD_D65_TO_D50)],
    ],
  });

const adobeRgb = () =>
  buildIcc({
    version: [2, 1],
    tags: [
      ["desc", descTag("Adobe RGB (1998)")],
      ["wtpt", xyzTag([0.95045, 1, 1.08905])],
      ...colorantTags(primariesToXyzD50(ADOBE_PRIMARIES, D65_XY)),
      ...trcTags(curvGamma(563 / 256)),
    ],
  });

const expectClose = (actual: readonly number[], expected: readonly number[], tolerance: number) => {
  expect(actual.length).toBe(expected.length);
  actual.forEach((v, i) => expect(Math.abs(v - expected[i]), `element ${i}: ${v} vs ${expected[i]}`).toBeLessThanOrEqual(tolerance));
};

/** A repeatable PRNG (mulberry32). */
const random = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

// ---------------------------------------------------------------------------------------------------------

describe("matrices", () => {
  it("inverts", () => {
    const m: Mat3 = [0.4, 0.3, 0.2, 0.1, 0.9, -0.05, 0.02, 0.1, 0.7];
    expectClose(mat3Multiply(mat3Invert(m), m), IDENTITY3, 1e-12);
    expectClose(mat3Multiply(m, mat3Invert(m)), IDENTITY3, 1e-12);
    expectClose(mat3Multiply(mat3Invert(SRGB_TO_XYZ_D50), SRGB_TO_XYZ_D50), IDENTITY3, 1e-12);
  });

  it("refuses a singular matrix", () => {
    expect(() => mat3Invert([1, 2, 3, 2, 4, 6, 0, 1, 1])).toThrow(/singular/);
    expect(() => mat3Invert([0, 0, 0, 0, 0, 0, 0, 0, 0])).toThrow(/singular/);
  });

  it("applies row-major", () => {
    expect(mat3Apply([1, 2, 3, 4, 5, 6, 7, 8, 9], [1, 0, -1])).toEqual([-2, -2, -2]);
  });

  it("computes sRGB's D50 matrix, white to D50", () => {
    // Lindbloom's values, made with D50's Z at 0.82521 rather than the PCS's 0.8249: the bottom row is off by that.
    expectClose(SRGB_TO_XYZ_D50, [0.4360747, 0.3850649, 0.1430804, 0.2225045, 0.7168786, 0.0606169, 0.0139322, 0.0971045, 0.7141733], 3e-4);
    expectClose(mat3Apply(SRGB_TO_XYZ_D50, [1, 1, 1]), [0xf6d6 / 65536, 1, 0xd32d / 65536], 1e-12);
    expect(primariesToXyzD50(SRGB_PRIMARIES, D65_XY)).toEqual(SRGB_TO_XYZ_D50);
  });
});

describe("sRGB's curve", () => {
  it("round-trips on [-2, 2]", () => {
    for (let i = 0; i <= 40000; i++) {
      const v = -2 + i / 10000;
      expect(Math.abs(linearToSrgb(srgbToLinear(v)) - v)).toBeLessThanOrEqual(1e-12);
      expect(Math.abs(srgbToLinear(linearToSrgb(v)) - v)).toBeLessThanOrEqual(1e-12);
    }
    // Either side of the knee, where IEC's rounded inverse threshold wouldn't round-trip.
    for (const v of [0.04045, 0.0404500001, 0.04044999, 0.040449936]) {
      expect(Math.abs(linearToSrgb(srgbToLinear(v)) - v)).toBeLessThanOrEqual(1e-12);
    }
  });

  it("is mirrored and exact", () => {
    expect(srgbToLinear(-0.5)).toBe(-srgbToLinear(0.5));
    expect(linearToSrgb(-0.2)).toBe(-linearToSrgb(0.2));
    expect(srgbToLinear(0)).toBe(0);
    expect(srgbToLinear(1)).toBe(1);
    expect(srgbToLinear(0.04)).toBe(0.04 / 12.92);
    expect(srgbToLinear(0.5)).toBeCloseTo(0.2140411, 7);
    expect(srgbToLinear(2)).toBeGreaterThan(1);
  });

  it("brings every 8-bit code back", () => {
    for (let i = 0; i < 256; i++) expect(Math.round(linearToSrgb(srgbToLinear(i / 255)) * 255)).toBe(i);
  });
});

describe("evalCurve", () => {
  const para = (fn: 0 | 1 | 2 | 3 | 4, params: number[]): Curve => ({ type: "parametric", fn, params });

  it("evaluates each parametric function", () => {
    expect(evalCurve(para(0, [2]), 0.5)).toBeCloseTo(0.25, 12);
    // 1: (2x - 0.5)^2 from x = 0.25, else 0.
    expect(evalCurve(para(1, [2, 2, -0.5]), 0.5)).toBeCloseTo(0.25, 12);
    expect(evalCurve(para(1, [2, 2, -0.5]), 0.2)).toBe(0);
    expect(evalCurve(para(1, [2, 2, -0.5]), 1)).toBeCloseTo(2.25, 12);
    // 2: the same plus c = 0.1 (c below the threshold).
    expect(evalCurve(para(2, [2, 2, -0.5, 0.1]), 0.5)).toBeCloseTo(0.35, 12);
    expect(evalCurve(para(2, [2, 2, -0.5, 0.1]), 0.2)).toBeCloseTo(0.1, 12);
    // 3: x^2 from d = 0.3, else 0.5x.
    expect(evalCurve(para(3, [2, 1, 0, 0.5, 0.3]), 0.5)).toBeCloseTo(0.25, 12);
    expect(evalCurve(para(3, [2, 1, 0, 0.5, 0.3]), 0.2)).toBeCloseTo(0.1, 12);
    // 4: x^2 + 0.05 from d = 0.3, else 0.5x + 0.01.
    expect(evalCurve(para(4, [2, 1, 0, 0.5, 0.3, 0.05, 0.01]), 0.5)).toBeCloseTo(0.3, 12);
    expect(evalCurve(para(4, [2, 1, 0, 0.5, 0.3, 0.05, 0.01]), 0.2)).toBeCloseTo(0.11, 12);
  });

  it("is sRGB's curve with sRGB's parameters", () => {
    for (let i = 0; i <= 100; i++) expect(evalCurve(para(3, SRGB_PARAMS), i / 100)).toBeCloseTo(srgbToLinear(i / 100), 12);
  });

  it("guards negative bases", () => {
    // Below -b/a the base is negative; function 3 still takes the power piece past d = 0.
    expect(evalCurve(para(3, [2.2, 1, -0.5, 0, 0]), 0.2)).toBe(0);
    expect(Number.isNaN(evalCurve(para(0, [0.5]), 0))).toBe(false);
  });

  it("interpolates tables, and clamps x", () => {
    const table: Curve = { type: "table", values: Float64Array.from([0, 0.25, 1]) };
    expect(evalCurve(table, 0.25)).toBeCloseTo(0.125, 12);
    expect(evalCurve(table, 0.75)).toBeCloseTo(0.625, 12);
    expect(evalCurve(table, 1)).toBe(1);
    expect(evalCurve(table, 2)).toBe(1);
    expect(evalCurve(table, -1)).toBe(0);
  });

  it("does identity and gamma", () => {
    expect(evalCurve({ type: "identity" }, 0.3)).toBe(0.3);
    expect(evalCurve({ type: "identity" }, 1.3)).toBe(1);
    expect(evalCurve({ type: "gamma", gamma: 2.2 }, 0.5)).toBeCloseTo(0.5 ** 2.2, 12);
    expect(evalCurve({ type: "gamma", gamma: 2.2 }, -0.5)).toBe(0);
  });
});

describe("parseIcc", () => {
  it("reads a v4 matrix profile", () => {
    const profile = parseIcc(displayP3());
    expect(profile).toMatchObject({ version: "4.0", deviceClass: "mntr", colourSpace: "RGB", pcs: "XYZ", description: "Display P3", hasLut: false });
    expectClose(profile.whitePoint!, [0.9642, 1, 0.8249], 1e-4);
    expectClose(profile.chad!, BRADFORD_D65_TO_D50, 1e-4);
    expectClose(profile.colorants!, primariesToXyzD50(P3_PRIMARIES, D65_XY), 1e-5);
    expect(profile.curves![0]).toMatchObject({ type: "parametric", fn: 3 });
    expect(profile.grayCurve).toBeNull();
  });

  it("reads a v2 profile's description and curves", () => {
    const profile = parseIcc(srgbV2());
    expect(profile.version).toBe("2.1");
    expect(profile.description).toBe("sRGB IEC61966-2.1");
    expect(profile.chad).toBeNull();
    const curve = profile.curves![1];
    expect(curve.type).toBe("table");
    if (curve.type === "table") expect(curve.values.length).toBe(1024);
    expect(parseIcc(adobeRgb()).curves![2]).toEqual({ type: "gamma", gamma: 563 / 256 });
  });

  it("reads GRAY, LUTs and missing tags", () => {
    const gray = parseIcc(buildIcc({ colourSpace: "GRAY", tags: [["kTRC", curvGamma(2.2)]] }));
    expect(gray.colourSpace).toBe("GRAY");
    expect(gray.grayCurve).toEqual({ type: "gamma", gamma: 563 / 256 });
    expect(gray.colorants).toBeNull();
    expect(gray.curves).toBeNull();
    expect(gray.description).toBeNull();
    expect(parseIcc(buildIcc({ tags: [["A2B0", lutStub()]] })).hasLut).toBe(true);
    expect(parseIcc(buildIcc({ tags: [["kTRC", new Bytes().sig("curv").u32(0).u32(0).done()]] })).grayCurve).toEqual({ type: "identity" });
  });

  it("keeps an unreadable description as null", () => {
    const bad = new Bytes().sig("desc").u32(0).u32(5000).done();
    expect(parseIcc(buildIcc({ tags: [["desc", bad]] })).description).toBeNull();
  });

  it("refuses malformed bytes", () => {
    const good = displayP3();
    expect(() => parseIcc(good.slice(0, 100))).toThrow(/too short/);
    expect(() => parseIcc(good.slice(0, good.length - 8))).toThrow(/truncated/);
    const noAcsp = good.slice();
    noAcsp[36] = "x".charCodeAt(0);
    expect(() => parseIcc(noAcsp)).toThrow(/acsp/);
    const pastEnd = good.slice();
    new DataView(pastEnd.buffer).setUint32(132 + 4, good.length - 4); // the first tag's offset
    expect(() => parseIcc(pastEnd)).toThrow(/past the end/);
    const manyTags = good.slice();
    new DataView(manyTags.buffer).setUint32(128, 0xffffffff);
    expect(() => parseIcc(manyTags)).toThrow(/tag table/);
    const wrongType = buildIcc({ tags: [["rXYZ", curvGamma(2)]] });
    expect(() => parseIcc(wrongType)).toThrow(/isn't an XYZ/);
    const badPara = buildIcc({ tags: [["rTRC", paraTag(7, [1])]] });
    expect(() => parseIcc(badPara)).toThrow(/parametric function/);
    const shortCurv = buildIcc({ tags: [["rTRC", new Bytes().sig("curv").u32(0).u32(400).done()]] });
    expect(() => parseIcc(shortCurv)).toThrow(/400 entries/);
  });
});

describe("sourceTransform", () => {
  it("takes untagged sources as sRGB", () => {
    expect(sourceTransform(null)).toEqual({ kind: "srgb", reason: "untagged" });
  });

  it("snaps sRGB profiles to sRGB", () => {
    expect(sourceTransform(srgbV2())).toEqual({ kind: "srgb", reason: "srgb-profile" });
    // HP's colorants, as its sRGB profile rounds them.
    const hp: Mat3 = [0.4361, 0.3851, 0.1431, 0.2225, 0.7169, 0.0606, 0.0139, 0.0971, 0.7141];
    expect(sourceTransform(srgbV2(hp))).toEqual({ kind: "srgb", reason: "srgb-profile" });
    // A v4 one with sRGB's para curve.
    const v4 = buildIcc({ tags: [...colorantTags(SRGB_TO_XYZ_D50), ...trcTags(paraTag(3, SRGB_PARAMS))] });
    expect(sourceTransform(v4)).toEqual({ kind: "srgb", reason: "srgb-profile" });
    // sRGB's primaries with a 2.2 gamma isn't sRGB.
    const gamma = buildIcc({ tags: [...colorantTags(SRGB_TO_XYZ_D50), ...trcTags(curvGamma(2.2))] });
    expect(sourceTransform(gamma).kind).toBe("matrix");
  });

  it("converts Display P3", () => {
    const t = sourceTransform(displayP3());
    expect(t.kind).toBe("matrix");
    if (t.kind !== "matrix") return;
    expect(t.description).toBe("Display P3");
    expectClose(t.matrix, [1.2249, -0.2247, 0, -0.042, 1.0419, 0, -0.0197, -0.0786, 1.0979], 2e-3);
    expectClose(toLinearSrgb(t, [0, 1, 0]), [-0.2249, 1.0421, -0.0786], 1e-3);
    expectClose(toLinearSrgb(t, [1, 0, 0]), [1.2249, -0.0421, -0.0196], 1e-3);
    expectClose(toLinearSrgb(t, [1, 1, 1]), [1, 1, 1], 1e-3);
    expectClose(toLinearSrgb(t, [0, 0, 0]), [0, 0, 0], 0);
    // Mid grey stays grey: the curve is sRGB's.
    expectClose(toLinearSrgb(t, [0.5, 0.5, 0.5]), [srgbToLinear(0.5), srgbToLinear(0.5), srgbToLinear(0.5)], 1e-4);
  });

  it("converts Adobe RGB", () => {
    const t = sourceTransform(adobeRgb());
    expect(t.kind).toBe("matrix");
    expectClose(toLinearSrgb(t, [1, 1, 1]), [1, 1, 1], 1e-3);
    const green = toLinearSrgb(t, [0, 1, 0]);
    expect(green[0]).toBeLessThan(-0.3);
    expect(green[1]).toBeCloseTo(1, 3);
    expect(green[2]).toBeLessThan(-0.03);
    expectClose(toLinearSrgb(t, [0.5, 0.5, 0.5]), [0.5 ** (563 / 256), 0.5 ** (563 / 256), 0.5 ** (563 / 256)], 1e-4);
  });

  it("says what it can't convert", () => {
    const lutOnly = sourceTransform(buildIcc({ tags: [["desc", descTag("Camera LUT")], ["A2B0", lutStub()]] }));
    expect(lutOnly).toMatchObject({ kind: "unsupported", description: "Camera LUT" });
    if (lutOnly.kind === "unsupported") expect(lutOnly.reason).toMatch(/LUT/);
    const gray = sourceTransform(buildIcc({ colourSpace: "GRAY", tags: [["kTRC", curvGamma(2.2)]] }));
    expect(gray.kind).toBe("unsupported");
    if (gray.kind === "unsupported") expect(gray.reason).toMatch(/GRAY/);
    const lab = sourceTransform(buildIcc({ pcs: "Lab ", tags: [...colorantTags(SRGB_TO_XYZ_D50), ...trcTags(curvGamma(2.2))] }));
    expect(lab.kind).toBe("unsupported");
    if (lab.kind === "unsupported") expect(lab.reason).toMatch(/Lab/);
    const cmyk = sourceTransform(buildIcc({ deviceClass: "prtr", colourSpace: "CMYK", tags: [["A2B0", lutStub()]] }));
    expect(cmyk.kind).toBe("unsupported");
    const link = sourceTransform(buildIcc({ deviceClass: "link", tags: [...colorantTags(SRGB_TO_XYZ_D50), ...trcTags(curvGamma(2.2))] }));
    expect(link.kind).toBe("unsupported");
    const singular = sourceTransform(buildIcc({ tags: [...colorantTags([1, 1, 0, 1, 1, 0, 0, 0, 1]), ...trcTags(curvGamma(2.2))] }));
    expect(singular.kind).toBe("unsupported");
  });

  it("never throws on malformed bytes", () => {
    const good = displayP3();
    const noAcsp = good.slice();
    noAcsp[37] = 0;
    const pastEnd = good.slice();
    new DataView(pastEnd.buffer).setUint32(132 + 4, 1 << 30);
    for (const bytes of [good.slice(0, 100), good.slice(0, good.length - 1), noAcsp, pastEnd, new Uint8Array(0)]) {
      const t = sourceTransform(bytes);
      expect(t.kind).toBe("unsupported");
      if (t.kind === "unsupported") expect(t.reason).toMatch(/can't be read/);
    }
  });

  it("survives random byte flips", () => {
    const good = displayP3();
    const next = random(1234);
    const kinds = new Set<string>();
    for (let trial = 0; trial < 2000; trial++) {
      const bytes = good.slice();
      const flips = 1 + Math.floor(next() * 8);
      for (let i = 0; i < flips; i++) bytes[Math.floor(next() * bytes.length)] = Math.floor(next() * 256);
      // Flipping the header's and tag table's bytes more often, where they do most harm.
      if (trial % 2) bytes[128 + Math.floor(next() * 120)] = Math.floor(next() * 256);
      const t = sourceTransform(bytes);
      kinds.add(t.kind);
      if (t.kind === "matrix") expect(t.matrix.every(Number.isFinite)).toBe(true);
    }
    expect(kinds.has("unsupported")).toBe(true);
  });
});

describe("transferLut", () => {
  it("is sRGB's curve at every 8-bit code", () => {
    const lut = transferLut("srgb", 8);
    expect(lut.length).toBe(256);
    for (let i = 0; i < 256; i++) expect(lut[i]).toBe(Math.fround(srgbToLinear(i / 255)));
  });

  it("has a 16-bit size", () => {
    const lut = transferLut("srgb", 16);
    expect(lut.length).toBe(65536);
    expect(lut[0]).toBe(0);
    expect(lut[65535]).toBe(1);
  });

  it("follows a profile's curve", () => {
    const t = sourceTransform(displayP3());
    if (t.kind !== "matrix") throw new Error("Display P3 should be a matrix transform");
    const curve = t.curves[0];
    for (const bits of [8, 16] as const) {
      const lut = transferLut(curve, bits);
      const top = 2 ** bits - 1;
      for (let i = 0; i <= top; i++) {
        if (lut[i] !== Math.fround(evalCurve(curve, i / top))) throw new Error(`entry ${i} of the ${bits}-bit table is off`);
      }
    }
  });
});

describe("toLinearSrgb", () => {
  it("reads sRGB and unsupported sources with sRGB's curve", () => {
    expect(toLinearSrgb({ kind: "srgb", reason: "untagged" }, [0.5, 0, 1])).toEqual([srgbToLinear(0.5), 0, 1]);
    expect(toLinearSrgb({ kind: "unsupported", reason: "", description: null }, [0.2, 0.4, 0.6])).toEqual([
      srgbToLinear(0.2),
      srgbToLinear(0.4),
      srgbToLinear(0.6),
    ]);
  });

  it("matches the matrix it was given", () => {
    const t = sourceTransform(adobeRgb());
    if (t.kind !== "matrix") throw new Error("Adobe RGB should be a matrix transform");
    const g = 563 / 256;
    expectClose(toLinearSrgb(t, [0.3, 0.6, 0.9]), mat3Apply(t.matrix, [0.3 ** g, 0.6 ** g, 0.9 ** g]), 1e-12);
  });
});
