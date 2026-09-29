/**
 * Reading a tool call's input (untrusted JSON from the model) with messages
 * the model can act on, and formatting numbers for its answers.
 */
import type { Vec2 } from "@shared/types";

/** A tool failed in a way the model should hear about (it gets the message). */
export class ToolError extends Error {}

export type Input = Record<string, unknown>;

const fail = (key: string, what: string): never => {
  throw new ToolError(`\`${key}\` must be ${what}.`);
};

export function optNumber(input: Input, key: string, bounds: { min?: number; max?: number } = {}): number | undefined {
  const v = input[key];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "number" || !Number.isFinite(v)) return fail(key, "a number");
  if (bounds.min !== undefined && v < bounds.min) return fail(key, `at least ${bounds.min}`);
  if (bounds.max !== undefined && v > bounds.max) return fail(key, `at most ${bounds.max}`);
  return v;
}

export function number(input: Input, key: string, bounds: { min?: number; max?: number } = {}): number {
  return optNumber(input, key, bounds) ?? fail(key, "given");
}

export function optString(input: Input, key: string): string | undefined {
  const v = input[key];
  if (v === undefined || v === null) return undefined;
  return typeof v === "string" ? v : fail(key, "a string");
}

export function string(input: Input, key: string): string {
  const v = optString(input, key);
  return v === undefined || v === "" ? fail(key, "a non-empty string") : v;
}

export function optBoolean(input: Input, key: string): boolean | undefined {
  const v = input[key];
  if (v === undefined || v === null) return undefined;
  return typeof v === "boolean" ? v : fail(key, "true or false");
}

export function optStrings(input: Input, key: string): string[] | undefined {
  const v = input[key];
  if (v === undefined || v === null) return undefined;
  if (!Array.isArray(v) || v.some((x) => typeof x !== "string")) return fail(key, "a list of strings");
  return [...new Set(v as string[])];
}

export function strings(input: Input, key: string): string[] {
  const v = optStrings(input, key);
  return v?.length ? v : fail(key, "a non-empty list");
}

export function optNumbers(input: Input, key: string): number[] | undefined {
  const v = input[key];
  if (v === undefined || v === null) return undefined;
  if (!Array.isArray(v) || v.some((x) => typeof x !== "number" || !Number.isFinite(x))) return fail(key, "a list of numbers");
  return v as number[];
}

export function optVec2(input: Input, key: string): Vec2 | undefined {
  const v = input[key];
  if (v === undefined || v === null) return undefined;
  if (!Array.isArray(v) || v.length !== 2 || v.some((x) => typeof x !== "number" || !Number.isFinite(x))) return fail(key, "[x, y]");
  return [v[0] as number, v[1] as number];
}

export function optObject(input: Input, key: string): Input | undefined {
  const v = input[key];
  if (v === undefined || v === null) return undefined;
  return typeof v === "object" && !Array.isArray(v) ? (v as Input) : fail(key, "an object");
}

export function oneOf<T extends string>(input: Input, key: string, values: readonly T[]): T | undefined {
  const v = input[key];
  if (v === undefined || v === null) return undefined;
  return values.includes(v as T) ? (v as T) : fail(key, `one of ${values.join(", ")}`);
}

/** Seconds as short as they can be written exactly enough (`3`, `12.4`, `0.033`). */
export const secs = (t: number) => String(Math.round(t * 1000) / 1000);

/** A time range, `3–8.5`. */
export const range = (a: number, b: number) => `${secs(a)}–${secs(b)}`;

/** A value for a tool's answer (numbers rounded, points as [x, y]). */
export function value(v: unknown): string {
  if (typeof v === "number") return String(Math.round(v * 10000) / 10000);
  if (Array.isArray(v)) return `[${v.map(value).join(", ")}]`;
  if (typeof v === "string") return JSON.stringify(v.length > 60 ? `${v.slice(0, 59)}…` : v);
  return String(v);
}
