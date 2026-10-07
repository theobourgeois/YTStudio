/** The warp filters' CPU references (`../../effects/filters/warp.ts`), mirrored by `render/filters/warp.ts`. */
import { PINCH_POWER, pinchScale } from "../../effects/filters/warp.ts";
import type { DocPoint } from "../../types.ts";
import { type KernelEnv, type KernelReference, type Pixel, clamp, rotate, smoothstep } from "../kernel.ts";

const RAD = Math.PI / 180;

/** Where a warp is centred: its Centre, or the canvas's centre when it has none. */
export const warpCentre = (centre: unknown, canvas: { width: number; height: number }): DocPoint => (Array.isArray(centre) ? [centre[0] as number, centre[1] as number] : [canvas.width / 2, canvas.height / 2]);

/** ZigZag's styles. */
export const ZIGZAG_STYLES: Record<string, number> = { pond: 0, out: 1, around: 2 };

/**
 * A displaced read at (qx, qy) for the point (x, y), held inside the canvas's edge pixels (as evaluated) unless the
 * point is off it, so the edges stretch rather than pull transparency in: never farther from the point than asked.
 */
function heldRead(qx: number, qy: number, x: number, y: number, canvas: { width: number; height: number }, env: KernelEnv): Pixel {
  const h = 0.5 * env.px;
  return env.src(clamp(qx, Math.min(x, h), Math.max(x, canvas.width - h)), clamp(qy, Math.min(y, h), Math.max(y, canvas.height - h)));
}

/** Twirl: inside the radius, the point reads the picture turned back by Angle·(1 − r/R)² about the centre. */
const twirl: KernelReference = (p, canvas) => {
  const [cx, cy] = warpCentre(p.centre, canvas);
  const angle = (p.angle as number) * RAD;
  const R = p.radius as number;
  return ([x, y], c, env) => {
    const dx = x - cx;
    const dy = y - cy;
    const r = Math.hypot(dx, dy);
    if (!(r < R)) return c;
    const t = 1 - r / R;
    const [sx, sy] = rotate(dx, dy, -angle * t * t);
    return heldRead(cx + sx, cy + sy, x, y, canvas, env);
  };
};

/**
 * Pinch: inside the radius, the point at t·R from the centre reads the one at t·R·sin(πt/2)^−k on the same line (k
 * Amount's share of `PINCH_POWER`): farther out when pinching, nearer when bulging, the same at the rim.
 */
const pinch: KernelReference = (p, canvas) => {
  const [cx, cy] = warpCentre(p.centre, canvas);
  const k = ((p.amount as number) / 100) * PINCH_POWER;
  const R = p.radius as number;
  return ([x, y], c, env) => {
    const dx = x - cx;
    const dy = y - cy;
    const r = Math.hypot(dx, dy);
    if (!(r < R)) return c;
    const scale = pinchScale(k, r / R);
    return heldRead(cx + dx * scale, cy + dy * scale, x, y, canvas, env);
  };
};

/**
 * ZigZag: inside the radius, a ripple of Ridges waves from the centre to the radius, Amount at most and fading out to
 * it (1 − smoothstep). Out moves the read along the line from the centre by the ripple; Around moves it across that
 * line (eased in near the centre, where across has no direction); Pond does both, a quarter-wave apart, the moving
 * part at most Amount.
 */
const zigzag: KernelReference = (p, canvas) => {
  const [cx, cy] = warpCentre(p.centre, canvas);
  const amount = p.amount as number;
  const R = p.radius as number;
  const wavelength = R / (p.ridges as number);
  const k = (2 * Math.PI) / wavelength;
  const ease = (wavelength / 4) ** 2;
  const style = ZIGZAG_STYLES[p.style as string] ?? 0;
  return ([x, y], c, env) => {
    const dx = x - cx;
    const dy = y - cy;
    const r = Math.hypot(dx, dy);
    if (!(r < R) || !(r > 0)) return c;
    const wave = amount * (1 - smoothstep(0, 1, r / R));
    const ripple = wave * Math.sin(k * r);
    const across = 1 / Math.sqrt(r * r + ease);
    const out = style === 2 ? 0 : ripple / r;
    const around = style === 0 ? 0.5 * wave * Math.cos(k * r) * across : style === 2 ? ripple * across : 0;
    // `out` and `around` per unit of (dx, dy): along it, and across it (turned a quarter clockwise).
    return heldRead(x + dx * out - dy * around, y + dy * out + dx * around, x, y, canvas, env);
  };
};

export const WARP_REFERENCES: Record<string, KernelReference> = { twirl, pinch, zigzag };
