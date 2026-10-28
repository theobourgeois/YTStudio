import { describe, expect, it } from "vitest";
import { isGlb, readGlb, sampleGlb } from "./model-file.ts";

describe("readGlb", () => {
  it("reads a model's animations and triangles", () => {
    const summary = readGlb(sampleGlb(["Idle", "Dance"]));
    expect(summary).toEqual({ animations: ["Idle", "Dance"], triangles: 12, skinned: false, extensions: [] });
  });

  it("knows a .glb by its first bytes", () => {
    expect(isGlb(sampleGlb())).toBe(true);
    expect(isGlb(new TextEncoder().encode("{\"asset\":{}}"))).toBe(false);
    expect(isGlb(new Uint8Array(2))).toBe(false);
  });

  it("says what's wrong with a file that isn't one", () => {
    expect(() => readGlb(new TextEncoder().encode("not a model at all, no"))).toThrow(/isn't a binary glTF/);
    const v1 = sampleGlb();
    new DataView(v1.buffer).setUint32(4, 1, true);
    expect(() => readGlb(v1)).toThrow(/glTF 1/);
    const cut = sampleGlb().slice(0, 40);
    expect(() => readGlb(cut)).toThrow(/damaged/);
  });

  it("counts a mesh as often as nodes use it", () => {
    const glb = sampleGlb();
    const view = new DataView(glb.buffer);
    const length = view.getUint32(12, true);
    const json = JSON.parse(new TextDecoder().decode(glb.subarray(20, 20 + length)));
    json.nodes = [{ mesh: 0 }, { mesh: 0 }, { mesh: 0 }];
    json.extensionsRequired = ["KHR_draco_mesh_compression"];
    json.skins = [{ joints: [0] }];
    const text = new TextEncoder().encode(JSON.stringify(json).padEnd(Math.ceil(JSON.stringify(json).length / 4) * 4));
    const out = new Uint8Array(20 + text.length);
    const outView = new DataView(out.buffer);
    out.set(glb.subarray(0, 20));
    outView.setUint32(8, out.length, true);
    outView.setUint32(12, text.length, true);
    out.set(text, 20);
    expect(readGlb(out)).toMatchObject({ triangles: 36, skinned: true, extensions: ["KHR_draco_mesh_compression"] });
  });
});
