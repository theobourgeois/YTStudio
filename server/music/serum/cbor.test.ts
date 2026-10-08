import { describe, expect, it } from "vitest";
import { type CborValue, decodeCbor, encodeCbor, isFloat32 } from "./cbor.ts";

const hex = (b: Uint8Array) => Buffer.from(b).toString("hex");

describe("Serum's CBOR", () => {
  it("writes a float as 32 bits when the double is exactly one, else 64", () => {
    expect(hex(encodeCbor({ a: 0.5 }))).toBe("a16161fa3f000000");
    expect(hex(encodeCbor({ a: 0.1 }))).toBe("a16161fb3fb999999999999a");
    expect(isFloat32(0.4999999701976776)).toBe(true);
    expect(isFloat32(66.60000000000001)).toBe(false);
  });

  it("writes whole numbers as floats except under Serum's integer keys", () => {
    expect(hex(encodeCbor({ kParamEnable: 1 }))).toBe(hex(encodeCbor({ kParamEnable: 1.0 })));
    expect(hex(encodeCbor({ kParamEnable: 1 })).endsWith("fa3f800000")).toBe(true);
    expect(hex(encodeCbor({ numFrames: 18432 }))).toBe("a1696e756d4672616d6573194800");
    expect(hex(encodeCbor({ source: [6, 25] }))).toBe("a166736f7572636582061819");
    expect(() => encodeCbor({ numPoints: 1.5 })).toThrow(/whole number/);
  });

  it("sorts map keys by their bytes, as Serum does", () => {
    const keys = Object.keys(decodeCbor(encodeCbor({ ModSlot2: 0, ModSlot10: 0, Arp0: 0, arp: 0 })) as object);
    expect(keys).toEqual(["Arp0", "ModSlot10", "ModSlot2", "arp"]);
  });

  it("reads back what it writes, integers past 2^53 and negative ones included", () => {
    const value: CborValue = {
      boundary64: 27_538_029_516_427_264n,
      noteNum: -12,
      channel: 0,
      text: "Factory/Vox/Eh Wet.flac",
      flags: [true, false, null],
      nested: { curveVals: [0.25, 0.1, 1e-13], bytes: new Uint8Array([1, 2, 3]) },
    };
    const again = decodeCbor(encodeCbor(value));
    expect(again).toEqual(value);
    expect(hex(encodeCbor(again))).toBe(hex(encodeCbor(value)));
  });

  it("reads half floats and refuses trailing bytes", () => {
    expect(decodeCbor(new Uint8Array([0xf9, 0x3c, 0x00]))).toBe(1);
    expect(decodeCbor(new Uint8Array([0xf9, 0xc0, 0x00]))).toBe(-2);
    expect(() => decodeCbor(new Uint8Array([0x01, 0x02]))).toThrow(/after the CBOR item/);
  });
});
