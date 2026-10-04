/**
 * Content hashes the tab and the server both compute (so a snapshot's id is the same wherever it's made):
 * a pure SHA-256 and a canonical JSON to hash a document by. The audio-intelligence contracts
 * (`audio-intelligence.ts`) identify everything by these; files on disk are hashed with the same function.
 */

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

const INITIAL = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];

const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));

/** A running SHA-256, so a large file can be hashed a chunk at a time. */
export class Sha256 {
  private readonly state = new Uint32Array(INITIAL);
  private readonly block = new Uint8Array(64);
  private readonly words = new Uint32Array(64);
  private filled = 0;
  private length = 0;
  private done = false;

  update(data: Uint8Array | string): this {
    if (this.done) throw new Error("Sha256: update after digest");
    const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
    this.length += bytes.length;
    this.append(bytes);
    return this;
  }

  /** The hash as 64 lower-case hex digits. Ends the hash: a new one is a new `Sha256`. */
  digest(): string {
    if (!this.done) {
      const bits = this.length * 8;
      // 0x80, zeros up to 8 bytes short of a block's end, then the length in bits (big-endian).
      const padding = new Uint8Array(((this.filled < 56 ? 56 : 120) - this.filled) + 8);
      padding[0] = 0x80;
      const view = new DataView(padding.buffer);
      view.setUint32(padding.length - 8, Math.floor(bits / 0x100000000));
      view.setUint32(padding.length - 4, bits >>> 0);
      this.append(padding);
      this.done = true;
    }
    return Array.from(this.state, (word) => word.toString(16).padStart(8, "0")).join("");
  }

  /** Feeds bytes through the blocks, keeping what doesn't fill one. */
  private append(bytes: Uint8Array) {
    let at = 0;
    if (this.filled > 0) {
      const take = Math.min(64 - this.filled, bytes.length);
      this.block.set(bytes.subarray(0, take), this.filled);
      this.filled += take;
      at = take;
      if (this.filled < 64) return;
      this.compress(this.block, 0);
      this.filled = 0;
    }
    for (; at + 64 <= bytes.length; at += 64) this.compress(bytes, at);
    if (at < bytes.length) {
      this.block.set(bytes.subarray(at), 0);
      this.filled = bytes.length - at;
    }
  }

  private compress(bytes: Uint8Array, offset: number) {
    const w = this.words;
    for (let i = 0; i < 16; i++) {
      const j = offset + i * 4;
      w[i] = ((bytes[j] << 24) | (bytes[j + 1] << 16) | (bytes[j + 2] << 8) | bytes[j + 3]) >>> 0;
    }
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = this.state;
    for (let i = 0; i < 64; i++) {
      const s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const choice = (e & f) ^ (~e & g);
      const t1 = (h + s1 + choice + K[i] + w[i]) >>> 0;
      const s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (s0 + majority) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }
    const s = this.state;
    s[0] += a;
    s[1] += b;
    s[2] += c;
    s[3] += d;
    s[4] += e;
    s[5] += f;
    s[6] += g;
    s[7] += h;
  }
}

/** SHA-256 of some bytes (or a string's UTF-8), as 64 lower-case hex digits. */
export function sha256(data: Uint8Array | string): string {
  return new Sha256().update(data).digest();
}

/**
 * JSON with its keys sorted at every depth, so equal values give equal text whichever order they were
 * built in. Refuses what JSON would quietly change (NaN, Infinity, undefined values, functions, symbols,
 * cycles): a hash of "what was there" must never depend on what a serialiser dropped. `undefined` object
 * members are skipped, as `JSON.stringify` skips them; an `undefined` in an array is refused.
 */
export function canonicalJson(value: unknown): string {
  return write(value, new Set());
}

function write(value: unknown, path: Set<object>): string {
  if (value === null) return "null";
  switch (typeof value) {
    case "string":
    case "boolean":
      return JSON.stringify(value);
    case "number":
      if (!Number.isFinite(value)) throw new Error(`canonicalJson: ${value} has no JSON form`);
      // -0 and 0 are the same value, so they hash alike.
      return Object.is(value, -0) ? "0" : JSON.stringify(value);
    case "object": {
      if (path.has(value)) throw new Error("canonicalJson: a cycle");
      path.add(value);
      let text: string;
      if (Array.isArray(value)) {
        text = `[${value.map((item) => (item === undefined ? fail("an undefined array item") : write(item, path))).join(",")}]`;
      } else {
        const entries = Object.entries(value as Record<string, unknown>)
          .filter(([, member]) => member !== undefined)
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
        text = `{${entries.map(([key, member]) => `${JSON.stringify(key)}:${write(member, path)}`).join(",")}}`;
      }
      path.delete(value);
      return text;
    }
    default:
      return fail(`a ${typeof value}`);
  }
}

const fail = (what: string): never => {
  throw new Error(`canonicalJson: ${what} has no JSON form`);
};

/** SHA-256 of a value's canonical JSON: what documents and manifests are identified by. */
export const hashJson = (value: unknown): string => sha256(canonicalJson(value));
