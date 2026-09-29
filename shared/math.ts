/** Small numeric helpers shared by the domain logic, the UI and the server. */

/** Tolerance for comparing times in seconds (clip edges, edit points). */
export const EPS = 1e-6;

export const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

export const isFiniteNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** Round to microseconds so repeated edits never accumulate float noise. */
export const roundTime = (t: number) => Math.round(t * 1e6) / 1e6;

/** Round away float noise (and -0) so equal values compare equal. */
export const tidy = (v: number) => Math.round(v * 1e9) / 1e9 + 0;

/** The nearest even integer (video dimensions must be even for yuv420p). */
export const even = (n: number) => Math.round(n / 2) * 2;
