/**
 * Stored parameter values <-> what the properties panel shows. Numbers are
 * scaled into display units (e.g. 0.5 -> 50 %); points are shown in pixels of
 * the frame they're fractions of: the project's canvas at 1080p (like a
 * Premiere sequence's frame size) or the clip's own media.
 */
import type { NumberSpec, Vec2Spec } from "@shared/params";
import type { Size } from "@shared/transform";
import type { Vec2 } from "@shared/types";

export interface DisplayContext {
  /** Reference canvas size for points on the canvas. */
  canvas: Size;
  /** The clip's media size for points on the clip's frame. */
  media: Size;
}

export interface NumberDisplay {
  min: number;
  max: number;
  step: number;
  decimals: number;
  unit?: string;
}

/** Display range, step and unit of a number, or of one component of a point. */
export function numberDisplay(spec: NumberSpec | Vec2Spec, ctx: DisplayContext, axis: 0 | 1 = 0): NumberDisplay {
  const factor = displayFactor(spec, ctx, axis);
  return {
    min: spec.min * factor,
    max: spec.max * factor,
    step: spec.step,
    decimals: spec.decimals,
    unit: spec.kind === "number" ? spec.unit : undefined,
  };
}

function displayFactor(spec: NumberSpec | Vec2Spec, ctx: DisplayContext, axis: 0 | 1): number {
  if (spec.kind === "number") return spec.scale ?? 1;
  // Already in px.
  if (spec.space === "px") return 1;
  const frame = spec.space === "canvas" ? ctx.canvas : ctx.media;
  return axis === 0 ? frame.width : frame.height;
}

export function toDisplay(spec: NumberSpec, value: number): number;
export function toDisplay(spec: Vec2Spec, value: Vec2, ctx: DisplayContext): Vec2;
export function toDisplay(spec: NumberSpec | Vec2Spec, value: number | Vec2, ctx?: DisplayContext): number | Vec2 {
  if (spec.kind === "number") return (value as number) * (spec.scale ?? 1);
  const [x, y] = value as Vec2;
  return [x * displayFactor(spec, ctx!, 0), y * displayFactor(spec, ctx!, 1)];
}

export function fromDisplay(spec: NumberSpec, shown: number): number;
export function fromDisplay(spec: Vec2Spec, shown: Vec2, ctx: DisplayContext): Vec2;
export function fromDisplay(spec: NumberSpec | Vec2Spec, shown: number | Vec2, ctx?: DisplayContext): number | Vec2 {
  if (spec.kind === "number") return (shown as number) / (spec.scale ?? 1);
  const [x, y] = shown as Vec2;
  return [x / displayFactor(spec, ctx!, 0), y / displayFactor(spec, ctx!, 1)];
}

/** Round to the shown decimals (and never show "-0"). */
export function roundShown(value: number, decimals: number): number {
  const f = 10 ** decimals;
  return Math.round(value * f) / f + 0;
}

export function formatShown(value: number, decimals: number): string {
  return roundShown(value, decimals).toFixed(decimals);
}

/** Parse typed text (a plain number, commas allowed as decimal point); null when it isn't one. */
export function parseShown(text: string): number | null {
  const cleaned = text.trim().replace(/,/g, ".").replace(/[^\d.+\-eE]/g, "");
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}
