/** Colour maths for the colour picker: hex <-> RGB <-> HSV (hue 0..360, saturation and value 0..1). */

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export interface Hsv {
  h: number;
  s: number;
  v: number;
}

/** "#abc", "abc", "#aabbcc" -> "#aabbcc"; null when it isn't a colour. */
export function normalizeHex(text: string): string | null {
  const hex = text.trim().replace(/^#/, "").toLowerCase();
  if (/^[0-9a-f]{3}$/.test(hex)) return `#${[...hex].map((c) => c + c).join("")}`;
  return /^[0-9a-f]{6}$/.test(hex) ? `#${hex}` : null;
}

/** A hex colour's channels, 0..255 (black for anything that isn't one). */
export function hexToRgb(hex: string): Rgb {
  const n = normalizeHex(hex);
  if (!n) return { r: 0, g: 0, b: 0 };
  return { r: parseInt(n.slice(1, 3), 16), g: parseInt(n.slice(3, 5), 16), b: parseInt(n.slice(5, 7), 16) };
}

const byte = (x: number) => Math.round(Math.min(255, Math.max(0, x)));

export const rgbToHex = ({ r, g, b }: Rgb) => `#${[r, g, b].map((c) => byte(c).toString(16).padStart(2, "0")).join("")}`;

export function rgbToHsv({ r, g, b }: Rgb): Hsv {
  const [rr, gg, bb] = [r / 255, g / 255, b / 255];
  const max = Math.max(rr, gg, bb);
  const d = max - Math.min(rr, gg, bb);
  let h = 0;
  if (d > 0) {
    if (max === rr) h = ((gg - bb) / d) % 6;
    else if (max === gg) h = (bb - rr) / d + 2;
    else h = (rr - gg) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: max === 0 ? 0 : d / max, v: max };
}

export function hsvToRgb({ h, s, v }: Hsv): Rgb {
  const f = (n: number) => {
    const k = (n + h / 60) % 6;
    return (v - v * s * Math.max(0, Math.min(k, 4 - k, 1))) * 255;
  };
  return { r: byte(f(5)), g: byte(f(3)), b: byte(f(1)) };
}

export const hsvToHex = (hsv: Hsv) => rgbToHex(hsvToRgb(hsv));
export const hexToHsv = (hex: string) => rgbToHsv(hexToRgb(hex));
