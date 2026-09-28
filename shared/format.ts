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

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v < 10 ? 1 : 0)} ${units[i]}`;
}
