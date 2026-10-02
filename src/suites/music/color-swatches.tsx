import { cn } from "cn";
import { TRACK_COLORS } from "@shared/music/project";

/** The colours a channel, a pattern, an audio clip or a track can be given, and the usual (FL's palette, ours). */
export function ColorSwatches({ value, onPick }: { value: string | null; onPick: (color: string | null) => void }) {
  return (
    <div className="grid grid-cols-7 gap-1 p-1" role="radiogroup" aria-label="Color">
      <button
        type="button"
        role="radio"
        aria-checked={value === null}
        aria-label="The usual color"
        title="The usual color"
        className={cn("grid size-5 place-items-center rounded-sm border border-line bg-surface-2 text-[10px] text-muted-foreground", value === null && "ring-2 ring-brand")}
        onClick={() => onPick(null)}
      >
        ∅
      </button>
      {TRACK_COLORS.map((c) => (
        <button
          key={c}
          type="button"
          role="radio"
          aria-checked={value === c}
          aria-label={c}
          className={cn("size-5 rounded-sm border border-black/30", value === c && "ring-2 ring-brand")}
          style={{ background: c }}
          onClick={() => onPick(c)}
        />
      ))}
    </div>
  );
}

