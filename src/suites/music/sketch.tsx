import type { SongOutline } from "@shared/music/outline";
import type { SuiteProjectSummary } from "@shared/types";
import { NOTE } from "./piano/note-colours";
import { useClipLook } from "./playlist/clip-look";
import { clipColours, kindColours } from "./playlist/draw";

const W = 1000;
const H = 600;

/**
 * A song's Home card: its Playlist in miniature (`SongOutline`, kept with its summary), clips in their colours
 * on the Piano roll's grid; a song still in its patterns, its busiest pattern's notes by channel. `progress`
 * (0..1) is its preview's playhead. Nothing to draw (or a summary from before outlines): null.
 */
export function songSketch(project: SuiteProjectSummary<"music">, progress: number) {
  return isOutline(project.outline) ? <SongSketch outline={project.outline} progress={progress} /> : null;
}

function SongSketch({ outline, progress }: { outline: SongOutline; progress: number }) {
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="Song preview" className="absolute inset-0 size-full">
      {outline.kind === "pattern" ? <StepSequencer outline={outline} /> : <Playlist outline={outline} />}
      {progress > 0 && <line x1={progress * W} x2={progress * W} y2={H} stroke="var(--piano-time)" strokeWidth={2} vectorEffect="non-scaling-stroke" />}
    </svg>
  );
}

/** Clips on their tracks, over the grid in bars (every fourth in a long song). */
function Playlist({ outline }: { outline: SongOutline }) {
  const rows = Math.max(outline.rows, 4);
  const rowH = H / rows;
  const bars = Math.max(1, Math.min(64, outline.bars || 1));
  const every = bars > 32 ? 4 : 1;
  const look = useClipLook();
  return (
    <>
      {Array.from({ length: rows }, (_, i) => (
        <rect key={i} y={i * rowH} width={W} height={rowH} fill={i % 2 ? "var(--piano-black-row)" : "var(--piano-row)"} />
      ))}
      {Array.from({ length: bars - 1 }, (_, i) => (i + 1) % every === 0 && (
        <line key={i} x1={((i + 1) * W) / bars} x2={((i + 1) * W) / bars} y2={H} stroke="var(--piano-bar-line)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
      ))}
      {outline.blocks.map(([row, start, length, style], i) => {
        const y = row * rowH + rowH * 0.08;
        const h = rowH * 0.84;
        const { kind, color } = outline.styles[style] ?? { kind: "pattern", color: null };
        const colours = color ? clipColours(color, look) : kindColours(kind === "note" ? "pattern" : kind, look);
        return (
          <g key={i}>
            <rect x={start} y={y} width={Math.max(3, length - 2)} height={h} fill={colours.body} opacity={0.9} />
            <rect x={start} y={y} width={Math.max(3, length - 2)} height={Math.min(h, rowH * 0.26)} fill={colours.title} />
          </g>
        );
      })}
    </>
  );
}

/**
 * A pattern as FL's step sequencer shows it: a row of pads a channel, a pad a sixteenth, lit where a note
 * starts; the rows centred, as many as fit a few to the card.
 */
function StepSequencer({ outline }: { outline: SongOutline }) {
  const steps = Math.max(16, Math.min(64, Math.round(outline.bars || 1) * 16));
  const rowH = H / Math.max(outline.rows, 5);
  const top = (H - rowH * outline.rows) / 2;
  const padW = W / steps;
  const lit = new Set(outline.blocks.map(([row, start]) => `${row}:${Math.min(steps - 1, Math.floor((start / 1000) * steps))}`));
  return (
    <>
      <rect width={W} height={H} fill="var(--piano-black-row)" />
      {Array.from({ length: outline.rows }, (_, row) =>
        Array.from({ length: steps }, (_, step) => {
          const on = lit.has(`${row}:${step}`);
          // FL's pads alternate in groups of four (a beat).
          const shade = Math.floor(step / 4) % 2 ? "var(--piano-line)" : "var(--piano-row)";
          return (
            <rect key={`${row}:${step}`} x={step * padW + padW * 0.12} y={top + row * rowH + rowH * 0.14} width={padW * 0.76} height={rowH * 0.72} rx={2}
              fill={on ? NOTE.bottom : shade} stroke={on ? NOTE.edge : "none"} strokeWidth={1} vectorEffect="non-scaling-stroke" />
          );
        }),
      )}
    </>
  );
}

/** Summaries are kept on disk (the recents): draw only what has the outline's shape. */
function isOutline(v: unknown): v is SongOutline {
  if (!v || typeof v !== "object") return false;
  const o = v as SongOutline;
  return (o.kind === "playlist" || o.kind === "pattern") && Number.isFinite(o.rows) && Number.isFinite(o.bars) && Array.isArray(o.blocks) && Array.isArray(o.styles) && o.blocks.length > 0;
}
