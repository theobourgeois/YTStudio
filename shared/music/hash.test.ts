import { createHash, randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { Sha256, canonicalJson, hashJson, sha256 } from "./hash.ts";

describe("sha256", () => {
  it("matches the published test vectors", () => {
    expect(sha256("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(sha256("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(sha256("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq")).toBe(
      "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1",
    );
    expect(sha256("a".repeat(1_000_000))).toBe("cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0");
  });

  it("agrees with node's on every length around the block and padding boundaries", () => {
    for (let length = 0; length <= 200; length++) {
      const bytes = randomBytes(length);
      expect(sha256(bytes), `length ${length}`).toBe(createHash("sha256").update(bytes).digest("hex"));
    }
  });

  it("is the same however the bytes are fed in", () => {
    const bytes = randomBytes(5000);
    const whole = createHash("sha256").update(bytes).digest("hex");
    for (const chunk of [1, 7, 63, 64, 65, 1000]) {
      const hash = new Sha256();
      for (let at = 0; at < bytes.length; at += chunk) hash.update(bytes.subarray(at, at + chunk));
      expect(hash.digest(), `chunks of ${chunk}`).toBe(whole);
    }
  });

  it("hashes a string as its UTF-8", () => {
    expect(sha256("héllo ♪")).toBe(createHash("sha256").update("héllo ♪", "utf8").digest("hex"));
  });

  it("gives the same digest when asked twice, and refuses more bytes after it", () => {
    const hash = new Sha256().update("abc");
    const first = hash.digest();
    expect(hash.digest()).toBe(first);
    expect(() => hash.update("d")).toThrow();
  });
});

describe("canonicalJson", () => {
  it("sorts keys at every depth and keeps arrays in order", () => {
    expect(canonicalJson({ b: 1, a: { d: [3, 2, 1], c: null } })).toBe('{"a":{"c":null,"d":[3,2,1]},"b":1}');
  });

  it("gives equal text for equal values built in another order", () => {
    expect(canonicalJson({ x: 1, y: [{ q: 1, p: 2 }] })).toBe(canonicalJson({ y: [{ p: 2, q: 1 }], x: 1 }));
  });

  it("skips undefined members, as JSON does, so an absent field and an undefined one hash alike", () => {
    expect(canonicalJson({ a: 1, b: undefined })).toBe(canonicalJson({ a: 1 }));
  });

  it("treats -0 as 0", () => {
    expect(canonicalJson({ a: -0 })).toBe(canonicalJson({ a: 0 }));
  });

  it("refuses what JSON would quietly change", () => {
    expect(() => canonicalJson({ a: NaN })).toThrow();
    expect(() => canonicalJson({ a: Infinity })).toThrow();
    expect(() => canonicalJson([undefined])).toThrow();
    expect(() => canonicalJson({ a: () => 1 })).toThrow();
    expect(() => canonicalJson({ a: Symbol("x") })).toThrow();
    expect(() => canonicalJson({ a: 1n })).toThrow();
    const loop: Record<string, unknown> = {};
    loop.self = loop;
    expect(() => canonicalJson(loop)).toThrow();
  });

  it("allows the same object twice when it isn't a cycle", () => {
    const shared = { a: 1 };
    expect(canonicalJson({ x: shared, y: shared })).toBe('{"x":{"a":1},"y":{"a":1}}');
  });

  it("hashes through hashJson", () => {
    expect(hashJson({ b: 1, a: 2 })).toBe(sha256('{"a":2,"b":1}'));
  });
});
