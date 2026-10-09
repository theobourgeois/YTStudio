import { useEffect, useRef } from "react";
import { ownerWindow } from "@/lib/window-events";
import { RIDGE_BINS, centroid, energy, follow, ridgeHeights, ridgeX, stereoPoints, triggered } from "./scope-model";
import { scopeOf } from "./scope";

/** How many ridges recede behind the newest, and how often a new one comes (seconds). */
const DEPTH = 30;
const EVERY = 0.045;
/** A frame older than this is silence (the engine says nothing while nothing sounds). */
const STALE_MS = 140;
/** Quiet this long, the display rests: fewer frames, and a word to play something. */
const REST_MS = 1600;

interface Palette {
  top: string;
  bottom: string;
  low: string;
  mid: string;
  high: string;
  glow: string;
  grid: string;
  label: string;
  text: string;
  font: string;
}

function readPalette(el: Element): Palette {
  const style = ownerWindow(el).getComputedStyle(el);
  const v = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback;
  return {
    top: v("--serum-screen-top", "#070912"),
    bottom: v("--serum-screen-bottom", "#121630"),
    low: v("--serum-low", "#3fe0ff"),
    mid: v("--serum-mid", "#8f6bff"),
    high: v("--serum-high", "#ff5fae"),
    glow: v("--serum-glow", "#6a5cff"),
    grid: v("--serum-grid", "#1e2440"),
    label: v("--serum-label", "#5f6890"),
    text: v("--serum-text", "#c9cff0"),
    font: v("--font-sans", "sans-serif"),
  };
}

/** `#rrggbb` with an alpha. */
function alpha(hex: string, a: number): string {
  const n = parseInt(hex.slice(1, 7), 16);
  if (hex[0] !== "#" || Number.isNaN(n)) return hex;
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${Math.max(0, Math.min(1, a)).toFixed(3)})`;
}

/** The sky's stars: where (fractions of the sky) and how they twinkle. Made once, the same every time. */
const STARS = Array.from({ length: 70 }, (_, i) => {
  const r = (n: number) => {
    const x = Math.sin(i * 12.9898 + n * 78.233) * 43758.5453;
    return x - Math.floor(x);
  };
  return { x: r(1), y: r(2), size: 0.4 + r(3) * 0.9, phase: r(4) * Math.PI * 2, speed: 0.4 + r(5) * 1.2 };
});

/** A smooth line through `points` (each midpoint a corner's control): a ridge's top, without its corners. */
function smooth(path: Path2D, points: [number, number][], from: "move" | "line") {
  if (from === "move") path.moveTo(points[0][0], points[0][1]);
  else path.lineTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length - 1; i++) {
    const [x, y] = points[i];
    const [nx, ny] = points[i + 1];
    path.quadraticCurveTo(x, y, (x + nx) / 2, (y + ny) / 2);
  }
  const [lx, ly] = points[points.length - 1];
  path.lineTo(lx, ly);
}

/** The rising sparks: where they are, how fast they go, how long they've left. */
interface Spark {
  x: number;
  y: number;
  vy: number;
  life: number;
  hue: number;
}

/**
 * The Serum player's display: what its channel's Serum is playing, as light. A range of ridges (the spectrum, each
 * moment's, receding as it ages), a glow that breathes with the level, the waveform held on its cycle, the stereo
 * picture in its corner, sparks off the loudest peaks. It rests, flat and calm, when nothing plays.
 */
export function ScopeView({ channelId }: { channelId: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const win = ownerWindow(canvas);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let palette = readPalette(canvas);
    let paletteAt = performance.now();
    let width = 0;
    let height = 0;
    let scale = 1;
    const fit = () => {
      const box = canvas.getBoundingClientRect();
      scale = win.devicePixelRatio || 1;
      width = Math.max(1, box.width);
      height = Math.max(1, box.height);
      canvas.width = Math.round(width * scale);
      canvas.height = Math.round(height * scale);
    };
    fit();
    const resize = new ResizeObserver(fit);
    resize.observe(canvas);

    const now = new Float32Array(RIDGE_BINS);
    const target = new Float32Array(RIDGE_BINS);
    // The ridges, newest first.
    const ridges: Float32Array[] = Array.from({ length: DEPTH }, () => new Float32Array(RIDGE_BINS));
    const sparks: Spark[] = [];
    let wave: number[] = [];
    let stereo: [number, number][] = [];
    let lastFrame = performance.now();
    let sinceRidge = 0;
    let lastSound = -Infinity;
    let level = 0;
    let hueAt = 0.5;
    let raf = 0;
    let timer = 0;

    const draw = (time: number) => {
      const dt = Math.min(0.1, (time - lastFrame) / 1000);
      lastFrame = time;
      if (time - paletteAt > 2000) {
        palette = readPalette(canvas);
        paletteAt = time;
      }
      const scope = scopeOf(channelId);
      const fresh = scope && time - scope.at < STALE_MS;
      if (fresh) {
        target.set(ridgeHeights(scope.scope.spectrum));
        wave = triggered(scope.scope.wave);
        stereo = stereoPoints(scope.scope.left, scope.scope.right);
        lastSound = time;
      } else target.fill(0);
      follow(now, target, dt);
      const e = energy(now);
      level += (e - level) * (1 - Math.exp(-dt / (e > level ? 0.05 : 0.6)));
      hueAt += (centroid(now) - hueAt) * (1 - Math.exp(-dt / 0.4));
      sinceRidge += dt;
      while (sinceRidge >= EVERY) {
        sinceRidge -= EVERY;
        const oldest = ridges.pop()!;
        oldest.set(now);
        ridges.unshift(oldest);
      }
      const resting = time - lastSound > REST_MS;

      ctx.setTransform(scale, 0, 0, scale, 0, 0);
      const W = width;
      const H = height;
      // The screen.
      const screen = ctx.createLinearGradient(0, 0, 0, H);
      screen.addColorStop(0, palette.top);
      screen.addColorStop(1, palette.bottom);
      ctx.fillStyle = screen;
      ctx.fillRect(0, 0, W, H);

      // Where the ridges stand: the front one low, the range receding up and in toward a horizon.
      const front = H * 0.9;
      const horizon = H * 0.3;

      // The sky's stars, twinkling, brighter as the sound is.
      for (const star of STARS) {
        const twinkle = 0.5 + 0.5 * Math.sin(time / 1000 * star.speed + star.phase);
        ctx.fillStyle = alpha(palette.text, (0.08 + 0.25 * twinkle) * (0.6 + 0.6 * level));
        ctx.beginPath();
        ctx.arc(star.x * W, star.y * horizon * 1.05, star.size, 0, Math.PI * 2);
        ctx.fill();
      }
      const ridgeAt = (k: number) => {
        const t = k / (DEPTH - 1);
        const ease = 1 - (1 - t) ** 1.8;
        const span = 0.9 - 0.42 * ease;
        return { base: front - (front - horizon) * ease, left: (W * (1 - span)) / 2, span: W * span, tall: H * (0.5 - 0.3 * ease), fade: (1 - t) ** 1.4 };
      };

      // The floor's lines, faint, toward the horizon.
      ctx.lineWidth = 1;
      ctx.strokeStyle = alpha(palette.grid, 0.9);
      for (const hz of [50, 100, 200, 500, 1000, 2000, 5000, 10_000]) {
        const x = ridgeX(hz);
        const near = ridgeAt(0);
        const far = ridgeAt(DEPTH - 1);
        ctx.beginPath();
        ctx.moveTo(near.left + near.span * x, near.base);
        ctx.lineTo(far.left + far.span * x, far.base);
        ctx.stroke();
      }

      // The glow, under the energy, breathing with the level.
      const glowX = W * (0.15 + 0.7 * hueAt);
      const glow = ctx.createRadialGradient(glowX, front, 0, glowX, front, W * (0.25 + 0.35 * level));
      glow.addColorStop(0, alpha(palette.glow, 0.1 + 0.45 * level));
      glow.addColorStop(1, alpha(palette.glow, 0));
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, W, H);

      // The waveform, high and faint, held on its cycle.
      if (wave.length > 1 && level > 0.02) {
        const line = ctx.createLinearGradient(0, 0, W, 0);
        line.addColorStop(0, alpha(palette.low, 0));
        line.addColorStop(0.5, alpha(palette.mid, 0.55 * level));
        line.addColorStop(1, alpha(palette.high, 0));
        ctx.strokeStyle = line;
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        const mid = H * 0.17;
        for (let i = 0; i < wave.length; i++) {
          const x = (i / (wave.length - 1)) * W;
          const y = mid - wave[i] * H * 0.12;
          if (i) ctx.lineTo(x, y);
          else ctx.moveTo(x, y);
        }
        ctx.stroke();
      }

      // The ridges, the farthest first, each hiding what's behind it.
      const colours = (left: number, span: number, a: number) => {
        const g = ctx.createLinearGradient(left, 0, left + span, 0);
        g.addColorStop(0, alpha(palette.low, a));
        g.addColorStop(0.5, alpha(palette.mid, a));
        g.addColorStop(1, alpha(palette.high, a));
        return g;
      };
      for (let k = DEPTH - 1; k >= 0; k--) {
        const { base, left, span, tall, fade } = ridgeAt(k);
        const heights = ridges[k];
        // At rest, the range breathes a little rather than lying dead.
        const breath = resting ? 0.012 * (1 + Math.sin(time / 900 + k * 0.35)) : 0;
        const points: [number, number][] = [];
        for (let i = 0; i < RIDGE_BINS; i++) points.push([left + (span * i) / (RIDGE_BINS - 1), base - (heights[i] + breath) * tall]);
        // The ridge's top (stroked), and the same closed down to its base (filled).
        const line = new Path2D();
        smooth(line, points, "move");
        const path = new Path2D();
        path.moveTo(left, base);
        smooth(path, points, "line");
        path.lineTo(left + span, base);
        path.closePath();
        // What's behind it is hidden by it: filled with the screen.
        const shade = ctx.createLinearGradient(0, base - tall, 0, base);
        shade.addColorStop(0, alpha(palette.top, 0.9));
        shade.addColorStop(1, alpha(palette.bottom, 0.98));
        ctx.fillStyle = shade;
        ctx.fill(path);
        if (k === 0) {
          // The newest: lit from beneath, and glowing.
          const light = ctx.createLinearGradient(0, base - tall, 0, base);
          light.addColorStop(0, alpha(palette.mid, 0.28 + 0.2 * level));
          light.addColorStop(1, alpha(palette.mid, 0));
          ctx.fillStyle = light;
          ctx.fill(path);
          // A wide soft pass, then the line itself, bright.
          ctx.save();
          ctx.lineJoin = "round";
          ctx.lineWidth = 6;
          ctx.strokeStyle = colours(left, span, 0.12 + 0.18 * level);
          ctx.stroke(line);
          ctx.shadowColor = alpha(palette.mid, 0.9);
          ctx.shadowBlur = 8 + 16 * level;
          ctx.lineWidth = 1.8;
          ctx.strokeStyle = colours(left, span, 0.95);
          ctx.stroke(line);
          ctx.restore();
        } else {
          ctx.lineWidth = 1;
          ctx.strokeStyle = colours(left, span, 0.1 + 0.55 * fade);
          ctx.stroke(line);
        }
      }

      // Sparks off the loudest peaks of the newest ridge, rising and fading.
      const near = ridgeAt(0);
      if (!resting)
        for (let i = 2; i < RIDGE_BINS - 2; i += 3)
          if (now[i] > 0.55 && now[i] >= now[i - 2] && now[i] >= now[i + 2] && Math.random() < 1.6 * dt * now[i] * level)
            sparks.push({ x: near.left + (near.span * i) / (RIDGE_BINS - 1), y: near.base - now[i] * near.tall, vy: 18 + 40 * Math.random(), life: 1, hue: i / RIDGE_BINS });
      for (let i = sparks.length - 1; i >= 0; i--) {
        const s = sparks[i];
        s.y -= s.vy * dt;
        s.life -= dt / 1.4;
        if (s.life <= 0 || s.y < 0) {
          sparks.splice(i, 1);
          continue;
        }
        ctx.fillStyle = alpha(s.hue < 0.4 ? palette.low : s.hue < 0.7 ? palette.mid : palette.high, s.life * 0.9);
        ctx.beginPath();
        ctx.arc(s.x, s.y, 1.2 + s.life, 0, Math.PI * 2);
        ctx.fill();
      }

      // The stereo picture, in its corner: a line for mono, a cloud for wide.
      const r = Math.min(34, H * 0.2);
      const cx = W - r - 14;
      const cy = r + 14;
      ctx.strokeStyle = alpha(palette.grid, 1);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.stroke();
      if (level > 0.02) {
        const peak = Math.max(1e-3, ...stereo.map(([x, y]) => Math.hypot(x, y)));
        ctx.fillStyle = alpha(palette.low, 0.55 * Math.min(1, level * 1.5));
        for (const [x, y] of stereo) {
          ctx.beginPath();
          ctx.arc(cx + (x / peak) * r * 0.9, cy - (y / peak) * r * 0.9, 0.9, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // The screen's edges, darker: a vignette.
      const vignette = ctx.createRadialGradient(W / 2, H * 0.55, Math.min(W, H) * 0.35, W / 2, H * 0.55, Math.max(W, H) * 0.75);
      vignette.addColorStop(0, alpha(palette.top, 0));
      vignette.addColorStop(1, alpha(palette.top, 0.55));
      ctx.fillStyle = vignette;
      ctx.fillRect(0, 0, W, H);

      // The frequencies, under the newest ridge.
      ctx.font = `10px ${palette.font}`;
      ctx.fillStyle = palette.label;
      ctx.textAlign = "center";
      for (const [hz, text] of [[50, "50"], [200, "200"], [1000, "1k"], [5000, "5k"]] as const) ctx.fillText(text, near.left + near.span * ridgeX(hz), H - 4);

      // At rest: a word.
      if (resting) {
        const quiet = Math.min(1, (time - lastSound - REST_MS) / 800);
        ctx.font = `12px ${palette.font}`;
        ctx.fillStyle = alpha(palette.text, 0.55 * (Number.isFinite(quiet) ? quiet : 1));
        ctx.fillText("Play a note to see it", W / 2, H * 0.22);
      }

      // Resting, it needn't be smooth: fewer frames.
      if (resting && level < 0.01 && !sparks.length) timer = win.setTimeout(() => (raf = win.requestAnimationFrame(draw)), 66);
      else raf = win.requestAnimationFrame(draw);
    };
    raf = win.requestAnimationFrame(draw);
    return () => {
      win.cancelAnimationFrame(raf);
      win.clearTimeout(timer);
      resize.disconnect();
    };
  }, [channelId]);

  return <canvas ref={canvasRef} className="block h-full w-full" aria-label="What it sounds like" role="img" data-testid="serum-scope" />;
}
