/**
 * Two made-up pictures the library's thumbnails (and the contact sheets
 * `scripts/transition-sheet.ts` renders) run transitions between: a cool night
 * scene marked "A" and a warm sunset marked "B", lopsided on purpose so flips,
 * turns and directions read at a glance.
 *
 * Also serialised into the headless page (like `createTransitionRenderer`),
 * so it must not refer to anything outside its own body.
 */
export function drawSampleScene(ctx: CanvasRenderingContext2D, width: number, height: number, which: 0 | 1): void {
  const w = width;
  const h = height;
  const s = Math.min(w, h);
  const night = which === 0;

  const sky = ctx.createLinearGradient(0, 0, 0, h);
  if (night) {
    sky.addColorStop(0, "#1b2a6b");
    sky.addColorStop(0.55, "#4b3f9e");
    sky.addColorStop(1, "#8b6fd6");
  } else {
    sky.addColorStop(0, "#ff9a4d");
    sky.addColorStop(0.55, "#ff5f7e");
    sky.addColorStop(1, "#b83a8a");
  }
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h);

  // Moon or sun, off-centre.
  const cx = night ? w * 0.7 : w * 0.3;
  const cy = h * 0.34;
  const r = s * 0.17;
  const glow = ctx.createRadialGradient(cx, cy, r * 0.6, cx, cy, r * 2.6);
  glow.addColorStop(0, night ? "rgba(220,230,255,0.45)" : "rgba(255,240,180,0.6)");
  glow.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = night ? "#eef1ff" : "#fff3c4";
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();

  if (night) {
    // A few stars.
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    for (let i = 0; i < 28; i++) {
      const x = ((i * 97) % 101) / 101;
      const y = ((i * 57) % 89) / 89;
      ctx.fillRect(x * w, y * h * 0.55, Math.max(1, s * 0.008), Math.max(1, s * 0.008));
    }
  } else {
    // Sun stripes.
    ctx.fillStyle = "rgba(255,95,126,0.9)";
    for (let i = 0; i < 4; i++) ctx.fillRect(cx - r, cy + r * (0.15 + i * 0.22), r * 2, r * 0.07 + i * r * 0.02);
  }

  // Two layers of hills.
  const hills = (base: number, amp: number, freq: number, phase: number, color: string) => {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(0, h);
    for (let x = 0; x <= w; x += Math.max(1, w / 60)) {
      ctx.lineTo(x, h * base - Math.sin((x / w) * Math.PI * freq + phase) * h * amp);
    }
    ctx.lineTo(w, h);
    ctx.closePath();
    ctx.fill();
  };
  hills(0.72, 0.06, 2.2, night ? 0.4 : 2.1, night ? "#2b2466" : "#7a2a6e");
  hills(0.84, 0.05, 3.1, night ? 2.4 : 0.9, night ? "#15123a" : "#4a1745");

  // The letter, in a corner so it shows which way up (and round) the picture is.
  ctx.fillStyle = "rgba(255,255,255,0.95)";
  ctx.font = `800 ${Math.round(s * 0.42)}px "DM Sans Variable", "DM Sans", system-ui, sans-serif`;
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = night ? "left" : "right";
  ctx.fillText(night ? "A" : "B", night ? w * 0.07 : w * 0.93, h * 0.93);
}
