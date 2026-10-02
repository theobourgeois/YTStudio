/**
 * Drawing a Pitch Wheel's dial (`dial.tsx` calls it every frame something moves), QuikQuak's in our look:
 * a metal bezel; the band with the range's marks and the value's arc; the pointer's handle (white, an
 * orange line); inside it the glowing ring whose bright point is the pitch actually heard, with a trail
 * behind it as it moves, and Multi's voices; and the screen, the actual value on it, glowing with what
 * comes in. Its colours are the theme's (`--wheel-*`, the LCD's).
 */
import { readout, angleOf, polar, ticks } from "./geometry";
import type { WheelRange } from "@shared/music/types";

export interface WheelColours {
  glow: string;
  bezelTop: string;
  bezelBottom: string;
  band: string;
  tick: string;
  label: string;
  handle: string;
  handleMark: string;
  screenTop: string;
  screenBottom: string;
  screenEdge: string;
  screenText: string;
  screenDim: string;
  sans: string;
  mono: string;
}

const cache = new Map<string, WheelColours>();

/** The theme's colours for a wheel (`pitch` or `timbre`), read from the element's CSS. */
export function wheelColours(element: Element, wheel: "pitch" | "timbre"): WheelColours {
  const key = `${document.documentElement.className}|${element.closest(".dark") !== null}|${wheel}`;
  const known = cache.get(key);
  if (known) return known;
  const style = getComputedStyle(element);
  const read = (name: string) => style.getPropertyValue(name).trim();
  const colours: WheelColours = {
    glow: read(`--wheel-${wheel}`),
    bezelTop: read("--wheel-bezel-top"),
    bezelBottom: read("--wheel-bezel-bottom"),
    band: read("--wheel-band"),
    tick: read("--wheel-tick"),
    label: read("--foreground"),
    handle: read("--wheel-handle"),
    handleMark: read("--wheel-handle-mark"),
    screenTop: read("--lcd-top"),
    screenBottom: read("--lcd-bottom"),
    screenEdge: read("--lcd-edge"),
    screenText: read("--lcd-text"),
    screenDim: read("--lcd-dim"),
    sans: read("--font-sans") || "sans-serif",
    mono: read("--font-mono") || "monospace",
  };
  cache.set(key, colours);
  return colours;
}

/** A colour (#rgb, #rrggbb or rgb()) at `alpha`. */
export function alpha(colour: string, a: number): string {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(colour);
  if (hex) {
    const h = hex[1].length === 3 ? [...hex[1]].map((c) => c + c).join("") : hex[1];
    const n = parseInt(h, 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
  }
  const rgb = /^rgba?\(([^)]+)\)$/.exec(colour);
  if (rgb) {
    const [r, g, b] = rgb[1].split(/[\s,/]+/).filter(Boolean);
    return `rgba(${r}, ${g}, ${b}, ${a})`;
  }
  return colour;
}

/** Where the actual pitch was lately: values with when they were (ms), newest last. */
export interface TrailPoint {
  value: number;
  at: number;
}

export interface DialScene {
  size: number;
  range: WheelRange;
  /** The wheel's name, along the bottom ("PITCH", "TIMBRE"). */
  name: string;
  /** Where the hand has the pointer, and where it lands (snapped). */
  pointer: number;
  target: number;
  /** What's heard: the actual pitch (the ring's bright point and the screen), its trail, Multi's voices. */
  actual: number;
  trail: readonly TrailPoint[];
  voices: readonly number[];
  /** How loud what comes in is (0..1): the screen glows with it. */
  input: number;
  now: number;
  /** Closed (the Timbre tab): drawn faded, the screen saying so. */
  closed: boolean;
  /** The pointer being dragged: its handle lit. */
  dragging: boolean;
  colours: WheelColours;
}

/** How long the trail behind the actual pitch lasts (ms). */
export const TRAIL_MS = 320;

export function drawDial(ctx: CanvasRenderingContext2D, scene: DialScene) {
  const { size, range, colours: c } = scene;
  const cx = size / 2;
  const cy = size / 2;
  const R = size / 2 - 3;
  const bandOuter = R - 4;
  const bandInner = R * 0.74;
  const groove = R * 0.655;
  const screen = R * 0.53;
  const rad = (deg: number) => ((deg - 90) * Math.PI) / 180;
  ctx.clearRect(0, 0, size, size);
  ctx.save();
  if (scene.closed) ctx.globalAlpha = 0.42;

  // The bezel: lit from above, a dark edge, a soft drop shadow.
  ctx.save();
  ctx.shadowColor = "rgba(0, 0, 0, 0.35)";
  ctx.shadowBlur = 8;
  ctx.shadowOffsetY = 2;
  const bezel = ctx.createLinearGradient(0, cy - R, 0, cy + R);
  bezel.addColorStop(0, c.bezelTop);
  bezel.addColorStop(1, c.bezelBottom);
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.fillStyle = bezel;
  ctx.fill();
  ctx.restore();
  ctx.beginPath();
  ctx.arc(cx, cy, R - 0.5, 0, Math.PI * 2);
  ctx.strokeStyle = "rgba(0, 0, 0, 0.35)";
  ctx.lineWidth = 1;
  ctx.stroke();

  // The band the marks are on: a shallow trough.
  const band = ctx.createRadialGradient(cx, cy, bandInner, cx, cy, bandOuter);
  band.addColorStop(0, alpha(c.band, 1));
  band.addColorStop(0.85, alpha(c.band, 1));
  band.addColorStop(1, alpha(c.bezelBottom, 1));
  ctx.beginPath();
  ctx.arc(cx, cy, bandOuter, 0, Math.PI * 2);
  ctx.arc(cx, cy, bandInner, 0, Math.PI * 2, true);
  ctx.fillStyle = band;
  ctx.fill();

  // The sweep's track and the value's arc along the band's inner edge, from 0 to the pointer.
  const arcRadius = bandInner + 2;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.arc(cx, cy, arcRadius, rad(-135), rad(135));
  ctx.strokeStyle = alpha(c.tick, 0.18);
  ctx.lineWidth = 2.5;
  ctx.stroke();
  const pointerAngle = angleOf(scene.pointer, range);
  if (Math.abs(pointerAngle) > 0.5) {
    ctx.save();
    ctx.shadowColor = c.glow;
    ctx.shadowBlur = 6;
    ctx.beginPath();
    ctx.arc(cx, cy, arcRadius, rad(Math.min(0, pointerAngle)), rad(Math.max(0, pointerAngle)));
    ctx.strokeStyle = c.glow;
    ctx.lineWidth = 2.5;
    ctx.stroke();
    ctx.restore();
  }

  // The marks: long ones labelled, short ones between; none across the bottom, where its name is.
  const fontSize = Math.max(8, Math.round(size * 0.04));
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `600 ${fontSize}px ${c.sans}`;
  for (const tick of ticks(range)) {
    const angle = angleOf(tick.value, range);
    const [x1, y1] = polar(cx, cy, bandOuter - 1.5, angle);
    const [x2, y2] = polar(cx, cy, bandOuter - (tick.major ? 5 : 3), angle);
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.strokeStyle = alpha(c.tick, tick.major ? 0.9 : 0.55);
    ctx.lineWidth = tick.major ? 1.3 : 1;
    ctx.stroke();
    if (tick.label) {
      const lit = Math.abs(tick.value - scene.target) < 1e-6;
      const [lx, ly] = polar(cx, cy, bandInner + (bandOuter - bandInner) * 0.44, angle);
      ctx.fillStyle = lit ? c.glow : alpha(c.label, 0.72);
      ctx.fillText(tick.label, lx, ly);
    }
  }
  ctx.font = `700 ${Math.max(8, Math.round(size * 0.042))}px ${c.sans}`;
  ctx.fillStyle = alpha(c.label, 0.5);
  ctx.save();
  ctx.translate(cx, cy + (bandOuter + bandInner) / 2 - 1);
  ctx.fillText(scene.name.split("").join(String.fromCharCode(8202)), 0, 0);
  ctx.restore();

  // The groove the actual pitch glows in: dim all round, the trail brighter, its head brightest.
  ctx.beginPath();
  ctx.arc(cx, cy, bandInner - 0.5, 0, Math.PI * 2);
  ctx.arc(cx, cy, screen + 1, 0, Math.PI * 2, true);
  const well = ctx.createRadialGradient(cx, cy, screen, cx, cy, bandInner);
  well.addColorStop(0, c.bezelBottom);
  well.addColorStop(0.5, c.bezelTop);
  well.addColorStop(1, c.bezelBottom);
  ctx.fillStyle = well;
  ctx.fill();
  ctx.beginPath();
  ctx.arc(cx, cy, groove, 0, Math.PI * 2);
  ctx.strokeStyle = c.screenEdge;
  ctx.lineWidth = 7;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx, cy, groove, 0, Math.PI * 2);
  ctx.strokeStyle = alpha(c.glow, 0.16);
  ctx.lineWidth = 4;
  ctx.stroke();

  // The trail: a stroke from each point to the next, brighter as it's newer.
  const trail = scene.trail;
  ctx.lineCap = "round";
  for (let i = 1; i < trail.length; i++) {
    const age = scene.now - trail[i].at;
    if (age > TRAIL_MS) continue;
    const a1 = angleOf(trail[i - 1].value, range);
    const a2 = angleOf(trail[i].value, range);
    if (Math.abs(a2 - a1) < 0.05) continue;
    const fade = 1 - age / TRAIL_MS;
    ctx.beginPath();
    ctx.arc(cx, cy, groove, rad(a1), rad(a2), a2 < a1);
    ctx.strokeStyle = alpha(c.glow, 0.75 * fade * fade);
    ctx.lineWidth = 4;
    ctx.stroke();
  }

  // Multi's voices: a dot each.
  for (const voice of scene.voices) {
    const [vx, vy] = polar(cx, cy, groove, angleOf(voice, range));
    ctx.beginPath();
    ctx.arc(vx, vy, 3, 0, Math.PI * 2);
    ctx.fillStyle = alpha(c.glow, 0.85);
    ctx.fill();
  }

  // The head: the pitch heard.
  const [hx, hy] = polar(cx, cy, groove, angleOf(scene.actual, range));
  const head = ctx.createRadialGradient(hx, hy, 0, hx, hy, 11);
  head.addColorStop(0, "rgba(255, 255, 255, 0.95)");
  head.addColorStop(0.25, alpha(c.glow, 0.95));
  head.addColorStop(1, alpha(c.glow, 0));
  ctx.beginPath();
  ctx.arc(hx, hy, 11, 0, Math.PI * 2);
  ctx.fillStyle = head;
  ctx.fill();

  // The snap light: where the pointer lands, on the groove's outer edge.
  if (Math.abs(scene.target - scene.pointer) > 1e-3) {
    const [sx, sy] = polar(cx, cy, bandInner - 2.5, angleOf(scene.target, range));
    ctx.beginPath();
    ctx.arc(sx, sy, 2.2, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255, 255, 255, 0.95)";
    ctx.shadowColor = c.glow;
    ctx.shadowBlur = 6;
    ctx.fill();
    ctx.shadowBlur = 0;
  }

  // The handle: QuikQuak's white capsule across the band's inner edge, an orange line down it.
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate((pointerAngle * Math.PI) / 180);
  const hw = Math.max(6, size * 0.03);
  const from = -(bandInner + size * 0.08);
  const to = -(bandInner - size * 0.035);
  ctx.shadowColor = scene.dragging ? alpha(c.glow, 0.8) : "rgba(0, 0, 0, 0.45)";
  ctx.shadowBlur = scene.dragging ? 10 : 4;
  ctx.shadowOffsetY = scene.dragging ? 0 : 1;
  const capsule = ctx.createLinearGradient(-hw, 0, hw, 0);
  capsule.addColorStop(0, alpha(c.handle, 0.82));
  capsule.addColorStop(0.45, c.handle);
  capsule.addColorStop(1, alpha(c.bezelBottom, 1));
  ctx.beginPath();
  ctx.roundRect(-hw, from, hw * 2, to - from, hw);
  ctx.fillStyle = capsule;
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;
  ctx.strokeStyle = "rgba(0, 0, 0, 0.3)";
  ctx.lineWidth = 0.75;
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(0, from + hw * 0.7);
  ctx.lineTo(0, to - hw * 0.7);
  ctx.strokeStyle = c.handleMark;
  ctx.lineWidth = Math.max(2, hw * 0.45);
  ctx.lineCap = "round";
  ctx.stroke();
  ctx.restore();

  // The screen: an LCD, glowing from within with what comes in.
  ctx.save();
  const face = ctx.createLinearGradient(0, cy - screen, 0, cy + screen);
  face.addColorStop(0, c.screenTop);
  face.addColorStop(1, c.screenBottom);
  ctx.beginPath();
  ctx.arc(cx, cy, screen, 0, Math.PI * 2);
  ctx.fillStyle = face;
  ctx.fill();
  const lit = Math.min(1, Math.sqrt(scene.input) * 1.4);
  const inner = ctx.createRadialGradient(cx, cy, 0, cx, cy, screen);
  inner.addColorStop(0, alpha(c.glow, 0.1 + 0.32 * lit));
  inner.addColorStop(0.7, alpha(c.glow, 0.04 + 0.1 * lit));
  inner.addColorStop(1, "rgba(0, 0, 0, 0.35)");
  ctx.fillStyle = inner;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = c.screenEdge;
  ctx.stroke();
  ctx.restore();

  // What's on it: the wheel's actual value, glowing; the target under it while they differ.
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  if (scene.closed) {
    ctx.font = `700 ${Math.round(size * 0.055)}px ${c.sans}`;
    ctx.fillStyle = c.screenDim;
    ctx.fillText("CLOSED", cx, cy);
  } else {
    ctx.save();
    ctx.font = `600 ${Math.round(size * 0.115)}px ${c.mono}`;
    ctx.shadowColor = c.glow;
    ctx.shadowBlur = 12;
    ctx.fillStyle = c.screenText;
    ctx.fillText(readout(scene.actual), cx, cy - size * 0.01);
    ctx.restore();
    ctx.font = `600 ${Math.round(size * 0.038)}px ${c.sans}`;
    ctx.fillStyle = c.screenDim;
    const away = Math.abs(scene.actual - scene.target) > 0.02;
    ctx.fillText(away ? `→ ${readout(scene.target)}` : "SEMITONES", cx, cy + size * 0.085);
  }
  ctx.restore();
}
