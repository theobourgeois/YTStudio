/** "1:05.40" — minutes, seconds, hundredths. Used for the playhead readout. */
export function formatTime(seconds: number): string {
  const s = Math.max(0, seconds);
  const cs = Math.floor(s * 100 + 1e-6);
  const m = Math.floor(cs / 6000);
  const sec = Math.floor((cs % 6000) / 100);
  const hundredths = cs % 100;
  return `${m}:${String(sec).padStart(2, "0")}.${String(hundredths).padStart(2, "0")}`;
}

/** "1:05" — compact duration for labels and badges. */
export function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

/** Compact "time ago" like "now", "4m", "3h", "2d", or a short date for older times. */
export function formatRelative(then: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - then) / 1000));
  if (s < 45) return "now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d}d`;
  const date = new Date(then);
  const sameYear = date.getFullYear() === new Date(now).getFullYear();
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}

/** How long something has been going: "8s", "12m", "1h 5m". */
export function formatElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return m % 60 ? `${h}h ${m % 60}m` : `${h}h`;
}

/** "2×", "0.5×", "1.25×": a playback speed, to two decimals at most. */
export function formatSpeed(speed: number): string {
  return `${Math.round(speed * 100) / 100}×`;
}

/**
 * A speed typed by someone: "2", "2x", "0.5×" or "50%" (a percentage, as in
 * Premiere). Null when it isn't a positive number.
 */
export function parseSpeed(raw: string): number | null {
  const m = /^\s*(\d*\.?\d+)\s*([x×%])?\s*$/i.exec(raw);
  if (!m) return null;
  const n = Number(m[1]) / (m[2] === "%" ? 100 : 1);
  return n > 0 && Number.isFinite(n) ? n : null;
}
