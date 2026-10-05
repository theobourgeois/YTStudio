/**
 * IEEE 754 half-precision floats as their 16-bit patterns: what `rgba16float` textures and stored tiles hold.
 * The tab reads tiles back as these bits, and constant tiles and CPU references convert through here.
 */

const f32 = new Float32Array(1);
const u32 = new Uint32Array(f32.buffer);

/** The half whose value is nearest `value` (ties to even), as GPUs round when they store one. */
export function toHalf(value: number): number {
  f32[0] = value;
  const x = u32[0];
  const sign = (x >>> 16) & 0x8000;
  const exponent = (x >>> 23) & 0xff;
  let mantissa = x & 0x7fffff;
  if (exponent === 0xff) return sign | 0x7c00 | (mantissa ? 0x200 : 0); // infinity, NaN
  let e = exponent - 127 + 15;
  if (e >= 0x1f) return sign | 0x7c00; // overflow: infinity
  if (e <= 0) {
    if (e < -10) return sign; // underflow: zero
    mantissa |= 0x800000;
    const shift = 14 - e;
    const half = 1 << (shift - 1);
    const rest = mantissa & ((1 << shift) - 1);
    let m = mantissa >>> shift;
    if (rest > half || (rest === half && m & 1)) m++;
    return sign | m;
  }
  const rest = mantissa & 0x1fff;
  let m = mantissa >>> 13;
  if (rest > 0x1000 || (rest === 0x1000 && m & 1)) {
    m++;
    if (m === 0x400) {
      m = 0;
      e++;
      if (e >= 0x1f) return sign | 0x7c00;
    }
  }
  return sign | (e << 10) | m;
}

/** The value of a half's bit pattern, exactly. */
export function fromHalf(bits: number): number {
  const sign = bits & 0x8000 ? -1 : 1;
  const e = (bits >>> 10) & 0x1f;
  const m = bits & 0x3ff;
  if (e === 0) return sign * m * 2 ** -24;
  if (e === 0x1f) return m ? NaN : sign * Infinity;
  return sign * (1 + m / 1024) * 2 ** (e - 15);
}
