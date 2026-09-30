import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { transposeSelected } from "./rack-actions";
import { useSong } from "./store";
import { selectedIn, useMusicUi } from "./ui";
import { MusicWindow, centredOnDesktop } from "./window";

/** A whole number of semitones as typed ("+5", "-12", "7"), or null. */
export function parseSemitones(text: string): number | null {
  const trimmed = text.trim();
  if (!/^[+-]?\d{1,3}$/.test(trimmed)) return null;
  const value = Number(trimmed);
  return Math.abs(value) <= 127 ? value : null;
}

/**
 * The rack's Transpose selected (its menu): a small window asking by how many semitones, up (positive)
 * or down, to move every note of the selected channels in the pattern shown. Enter applies it.
 */
export function TransposeWindow() {
  const channels = useSong((song) => song.channels);
  const selectedIds = useMusicUi((s) => s.selectedChannelIds);
  const selected = selectedIn({ channels } as Parameters<typeof selectedIn>[0], selectedIds);
  const [text, setText] = useState("0");
  const semitones = parseSemitones(text);
  const close = () => useMusicUi.getState().setTransposeOpen(false);
  const accept = () => {
    if (semitones === null || !selected.length) return;
    transposeSelected(semitones);
    close();
  };
  const nudge = (by: number) => setText((t) => String(Math.max(-127, Math.min(127, (parseSemitones(t) ?? 0) + by))));
  const names = selected.map((c) => c.name).join(", ");

  return (
    <MusicWindow id="transpose" title="Transpose selected" initial={centredOnDesktop(296, 150)} onClose={close}>
      <form
        className="flex w-[296px] flex-col gap-2.5 p-3"
        onSubmit={(e) => {
          e.preventDefault();
          accept();
        }}
      >
        <p className="truncate text-[11px] text-muted-foreground" title={names}>
          {selected.length ? `${names}: every note in this pattern` : "Select channels in the rack first"}
        </p>
        <div className="flex items-center gap-1">
          <label htmlFor="transpose-semitones" className="mr-auto text-xs">
            Semitones
          </label>
          <Button type="button" variant="outline" size="xs" onClick={() => nudge(-12)} title="An octave down">
            −12
          </Button>
          <Button type="button" variant="outline" size="xs" onClick={() => nudge(-1)} aria-label="A semitone down">
            −
          </Button>
          <Input
            id="transpose-semitones"
            autoFocus
            className="h-7 shrink-0 px-1 text-center font-mono"
            style={{ width: 52 }}
            value={text}
            aria-invalid={semitones === null}
            onFocus={(e) => e.currentTarget.select()}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") close();
              else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
                e.preventDefault();
                nudge((e.key === "ArrowUp" ? 1 : -1) * (e.shiftKey ? 12 : 1));
              }
            }}
          />
          <Button type="button" variant="outline" size="xs" onClick={() => nudge(1)} aria-label="A semitone up">
            +
          </Button>
          <Button type="button" variant="outline" size="xs" onClick={() => nudge(12)} title="An octave up">
            +12
          </Button>
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" size="sm" onClick={close}>
            Cancel
          </Button>
          <Button type="submit" size="sm" disabled={semitones === null || !selected.length}>
            Transpose
          </Button>
        </div>
      </form>
    </MusicWindow>
  );
}
