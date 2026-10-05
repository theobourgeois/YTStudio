import { describe, expect, it } from "vitest";
import { canonicalJson, constantRef, constantValues, emptySurface, tileHashes, validateManifest, withTiles } from "./surfaces.ts";

const A = "a".repeat(64);
const B = "b".repeat(64);

describe("manifests", () => {
  const empty = emptySurface("rgba16f", 256, [0, 0, 0, 0]);

  it("adds and replaces tiles, sorted by row then column", () => {
    const one = withTiles(empty, [[3, 1, A], [0, 0, B], [1, 1, A]]);
    expect(one.tiles).toEqual([[0, 0, B], [1, 1, A], [3, 1, A]]);
    const two = withTiles(one, [[1, 1, B]]);
    expect(two.tiles[1]).toEqual([1, 1, B]);
    expect(one.tiles[1]).toEqual([1, 1, A]); // never changed in place
  });

  it("drops a tile set back to the fill, and returns the same manifest when nothing changes", () => {
    const one = withTiles(empty, [[0, 0, A]]);
    expect(withTiles(one, [[0, 0, A]])).toBe(one);
    expect(withTiles(one, [[0, 0, constantRef([0, 0, 0, 0])]]).tiles).toEqual([]);
    expect(withTiles(empty, [])).toBe(empty);
  });

  it("validates untrusted manifests", () => {
    expect(validateManifest(withTiles(empty, [[0, 0, A], [1, 0, constantRef([1, 0.5, 0, 1])]]))).toMatchObject({ v: 1 });
    expect(validateManifest(null)).toMatch(/object/);
    expect(validateManifest({ ...empty, format: "rgb8" })).toMatch(/format/);
    expect(validateManifest({ ...empty, fill: [0] })).toMatch(/fill/);
    expect(validateManifest({ ...empty, tiles: [[0, 0, "nope"]] })).toMatch(/ref/);
    expect(validateManifest({ ...empty, tiles: [[0, 0, "c:1,2"]] })).toMatch(/ref/);
    expect(validateManifest({ ...empty, tiles: [[1, 0, A], [0, 0, B]] })).toMatch(/sorted/);
    expect(validateManifest({ ...empty, tiles: [[0, 0, A], [0, 0, B]] })).toMatch(/twice/);
    expect(validateManifest({ ...empty, tiles: [[0.5, 0, A]] })).toMatch(/integers/);
  });

  it("knows constant tiles from stored ones", () => {
    expect(constantValues(constantRef([1, 0.25]))).toEqual([1, 0.25]);
    expect(constantValues(A)).toBeNull();
    expect(tileHashes(withTiles(empty, [[0, 0, A], [1, 0, constantRef([1, 1, 1, 1])]]))).toEqual([A]);
  });
});

describe("canonical JSON", () => {
  it("sorts keys and drops whitespace, so equal values have equal bytes", () => {
    expect(canonicalJson({ b: 1, a: [1, { d: 2, c: "x" }] })).toBe('{"a":[1,{"c":"x","d":2}],"b":1}');
    expect(canonicalJson({ a: 1, b: undefined })).toBe('{"a":1}');
    expect(() => canonicalJson({ a: Number.NaN })).toThrow();
  });
});
