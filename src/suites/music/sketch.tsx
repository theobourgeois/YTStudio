import type { SongOutline } from "@shared/music/outline";
import type { SuiteProjectSummary } from "@shared/types";
import { NOTE } from "./piano/note-colours";
import { clipColours, KIND_COLOURS } from "./playlist/draw";

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
  const rows = Math.max(outline.rows, 4);
  const rowH = H / rows;
  // A line a bar, or every 4 in a long song.
  const bars = Math.max(1, Math.min(64, outline.bars || 1));
  const every = bars > 32 ? 4 : 1;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="Song preview" className="absolute inset-0 size-full">
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
        if (kind === "note") {
          return <rect key={i} x={start} y={y + h * 0.2} width={Math.max(4, length - 3)} height={h * 0.6} rx={3} fill={color ?? NOTE.bottom} stroke={NOTE.edge} strokeWidth={1} vectorEffect="non-scaling-stroke" />;
        }
        const colours = color ? clipColours(color) : KIND_COLOURS[kind];
        return (
          <g key={i}>
            <rect x={start} y={y} width={Math.max(3, length - 2)} height={h} fill={colours.body} opacity={0.9} />
            <rect x={start} y={y} width={Math.max(3, length - 2)} height={Math.min(h, rowH * 0.26)} fill={colours.title} />
          </g>
        );
      })}
      {progress > 0 && <line x1={progress * W} x2={progress * W} y2={H} stroke="var(--piano-time)" strokeWidth={2} vectorEffect="non-scaling-stroke" />}
    </svg>
  );
}

/** Summaries are kept on disk (the recents): draw only what has the outline's shape. */
function isOutline(v: unknown): v is SongOutline {
  if (!v || typeof v !== "object") return false;
  const o = v as SongOutline;
  return (o.kind === "playlist" || o.kind === "pattern") && Number.isFinite(o.rows) && Number.isFinite(o.bars) && Array.isArray(o.blocks) && Array.isArray(o.styles) && o.blocks.length > 0;
}
