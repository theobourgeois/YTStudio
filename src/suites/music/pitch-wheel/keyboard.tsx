import { useEffect, useRef, useState } from "react";
import { startPointerDrag } from "@/lib/pointer-drag";
import { prepare } from "../piano/draw";
import { pitchName } from "../piano/geometry";
import { keysHeld, playKey } from "./actions";
import { alpha, wheelColours } from "./draw";
import { type KeyRect, keyAt, keyboardLayout } from "./geometry";
import { freshWheel } from "./live";

/** The keyboard's notes: five octaves, C2 to B6 (FL's names: C5 is MIDI 60). */
export const LOW_KEY = 36;
export const HIGH_KEY = 95;

/**
 * QuikQuak's input keyboard: the origin (a dot: it shifts nothing), the notes playing it (lit: a
 * channel's, as the engine says them, and the keys held here), and in Single the note the sound is at
 * now (ringed). It plays: press a key and the Pitch Wheel hears a note, as from a channel; drag across
 * to glide; Shift+click holds one on (a chord, in Multi) until it's clicked again. A right-click makes a
 * key the origin.
 */
export function Keyboard({ effectId, origin, multi, onOrigin, height = 46 }: { effectId: string; origin: number; multi: boolean; onOrigin: (key: number) => void; height?: number }) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [width, setWidth] = useState(0);
  const latched = useRef(new Set<number>());
  const latest = useRef({ origin, multi });
  latest.current = { origin, multi };

  useEffect(() => {
    const element = wrap.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.floor(entry.contentRect.width)));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const element = canvas.current;
    if (!element || !width) return;
    const keys = keyboardLayout(width, height, LOW_KEY, HIGH_KEY);
    let frame = 0;
    let drawn = "";
    const loop = () => {
      frame = requestAnimationFrame(loop);
      const fresh = freshWheel(effectId);
      const lit = new Set<number>([...keysHeld(effectId), ...(fresh?.state.notes ?? [])]);
      const { origin: o, multi: m } = latest.current;
      // Single: the note the sound is at now (the origin moved by what's heard), ringed.
      const at = !m && fresh ? o + Math.round(fresh.state.pitch) : null;
      const key = `${[...lit].join()}|${o}|${at}|${document.documentElement.className}`;
      if (key === drawn) return;
      drawn = key;
      const ctx = prepare(element, width, height);
      if (ctx) drawKeys(ctx, element, keys, width, height, lit, o, at);
    };
    loop();
    return () => cancelAnimationFrame(frame);
  }, [effectId, width, height]);

  const keyOf = (e: { clientX: number; clientY: number }) => {
    const rect = canvas.current!.getBoundingClientRect();
    return keyAt(keyboardLayout(width, height, LOW_KEY, HIGH_KEY), e.clientX - rect.left, e.clientY - rect.top);
  };

  return (
    <div ref={wrap} className="min-w-0 flex-1">
      <canvas
        ref={canvas}
        className="block cursor-pointer rounded-sm"
        style={{ width: "100%", height }}
        aria-label="Keyboard: press a key to play the YT-Pitch; right-click to make it the origin"
        title="Press a key: the YT-Pitch plays it (drag to glide; Shift+click holds one on). Right-click: make it the origin"
        data-testid="wheel-keyboard"
        onContextMenu={(e) => {
          e.preventDefault();
          const key = keyOf(e);
          if (key !== null) onOrigin(key);
        }}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          let key = keyOf(e);
          if (key === null) return;
          if (e.shiftKey) {
            // Held on until it's clicked again.
            const on = !latched.current.has(key);
            if (on) latched.current.add(key);
            else latched.current.delete(key);
            playKey(effectId, key, on);
            return;
          }
          playKey(effectId, key, true);
          const letGo = () => {
            if (key !== null && !latched.current.has(key)) playKey(effectId, key, false);
            key = null;
          };
          startPointerDrag(e, {
            threshold: 0,
            onMove(ev) {
              const next = keyOf(ev);
              if (next === key) return;
              letGo();
              key = next;
              if (key !== null) playKey(effectId, key, true);
            },
            onEnd: letGo,
            onCancel: letGo,
            onClick: letGo,
          });
        }}
      />
      <span className="sr-only">Origin: {pitchName(origin)}</span>
    </div>
  );
}

function drawKeys(ctx: CanvasRenderingContext2D, element: Element, keys: readonly KeyRect[], width: number, height: number, lit: ReadonlySet<number>, origin: number, at: number | null) {
  const c = wheelColours(element, "pitch");
  ctx.clearRect(0, 0, width, height);
  const glow = c.glow;
  for (const black of [false, true])
    for (const k of keys) {
      if (k.black !== black) continue;
      const on = lit.has(k.key);
      const face = ctx.createLinearGradient(0, k.y, 0, k.y + k.height);
      if (on) {
        face.addColorStop(0, alpha(glow, black ? 0.95 : 0.7));
        face.addColorStop(1, glow);
      } else if (black) {
        face.addColorStop(0, "#2a2e35");
        face.addColorStop(1, "#14161a");
      } else {
        face.addColorStop(0, "#f7f9fb");
        face.addColorStop(1, "#d9dee4");
      }
      ctx.fillStyle = face;
      ctx.beginPath();
      ctx.roundRect(k.x + 0.5, k.y, k.width - 1, k.height, black ? [0, 0, 2, 2] : [0, 0, 3, 3]);
      ctx.fill();
      ctx.strokeStyle = "rgba(0, 0, 0, 0.45)";
      ctx.lineWidth = 0.75;
      ctx.stroke();
      // The note the sound is at now (Single), ringed in the glow.
      if (k.key === at && !on) {
        ctx.strokeStyle = glow;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.roundRect(k.x + 1.5, k.y + 1, k.width - 3, k.height - 2, 2);
        ctx.stroke();
      }
      // The origin: a dot near its bottom.
      if (k.key === origin) {
        ctx.beginPath();
        ctx.arc(k.x + k.width / 2, k.y + k.height - Math.min(7, k.width * 0.45), Math.max(2, k.width * 0.18), 0, Math.PI * 2);
        ctx.fillStyle = on ? "#ffffff" : glow;
        ctx.fill();
      }
      // Each C named, to find your way.
      if (!black && k.key % 12 === 0 && k.width > 9) {
        ctx.font = `600 ${Math.min(9, k.width * 0.6)}px ${c.sans}`;
        ctx.textAlign = "center";
        ctx.textBaseline = "alphabetic";
        ctx.fillStyle = on ? "#ffffff" : "rgba(40, 46, 54, 0.55)";
        ctx.fillText(`C${Math.floor(k.key / 12)}`, k.x + k.width / 2, k.y + k.height - (k.key === origin ? 14 : 3));
      }
    }
}
