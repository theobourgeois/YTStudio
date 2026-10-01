import { useEffect, useState } from "react";
import { editNotes, setNoteProps } from "@shared/music/notes";
import { DEFAULT_VELOCITY } from "@shared/music/project";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Knob, PERCENT, panText, percent } from "../knob";
import { useMusic } from "../store";
import { useMusicWindows } from "../ui";
import { MusicWindow, centredOnDesktop } from "../window";
import { pianoContext } from "./actions";
import { formatLength, formatPosition, parseTime, pitchName } from "./geometry";
import { usePiano } from "./store";

/**
 * A note's properties (a double-click on it), in a small window of their own as in FL Studio (not a
 * dialog: the Piano roll stays usable beside it): its velocity and pan, and its start and length as
 * bar:step:tick. If it's one of the selection, the levels apply to all of them (and the times, which
 * they don't share, aren't shown). Enter accepts, Escape closes it.
 */
export function NoteProperties() {
  const ctx = pianoContext();
  const editing = usePiano((s) => s.editing);
  const note = ctx?.notes.find((n) => n.id === editing) ?? null;
  const many = !!note && ctx!.selected.has(note.id) && ctx!.selected.size > 1;
  const [velocity, setVelocity] = useState(note?.velocity ?? DEFAULT_VELOCITY);
  const [pan, setPan] = useState(note?.pan ?? 0);
  const [start, setStart] = useState(note && ctx ? formatPosition(note.start, ctx.barTicks) : "");
  const [length, setLength] = useState(note && ctx ? formatLength(note.length, ctx.barTicks) : "");
  const close = () => usePiano.setState({ editing: null });
  // In front of the Piano roll whenever it opens on a note.
  useEffect(() => useMusicWindows.getState().focus("note"), []);
  if (!ctx || !note) return null;
  const startTicks = parseTime(start, ctx.barTicks, true);
  const lengthTicks = parseTime(length, ctx.barTicks, false);
  const valid = many || (startTicks !== null && lengthTicks !== null && lengthTicks > 0);

  const accept = () => {
    if (!valid) return;
    const ids = many ? ctx.selected : new Set([note.id]);
    const patch = many ? { velocity, pan } : { velocity, pan, start: startTicks!, length: lengthTicks! };
    useMusic.getState().commit((song) => editNotes(song, ctx.pattern.id, ctx.channel.id, (notes) => setNoteProps(notes, ids, patch)));
    close();
  };

  return (
    <MusicWindow
      id="note"
      title={`Note properties – ${pitchName(note.pitch)}${many ? ` and ${ctx.selected.size - 1} more` : ""}`}
      initial={centredOnDesktop(280, 240)}
      onClose={close}
    >
      <form
        className="flex w-[280px] flex-col gap-3 p-3"
        data-testid="note-properties"
        onSubmit={(e) => {
          e.preventDefault();
          accept();
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.stopPropagation();
            close();
          }
        }}
      >
        <div className="flex justify-center gap-8">
          <div className="flex flex-col items-center gap-1">
            <Knob size={34} label="Velocity" value={velocity} min={0} max={1} defaultValue={DEFAULT_VELOCITY} format={percent} unit={PERCENT} onBegin={() => {}} onDrag={setVelocity} onEnd={() => {}} onCancel={() => {}} onSet={setVelocity} />
            <span className="text-[10px] font-medium text-muted-foreground">VEL {percent(velocity)}</span>
          </div>
          <div className="flex flex-col items-center gap-1">
            <Knob size={34} label="Pan" value={pan} min={-1} max={1} defaultValue={0} bipolar format={panText} unit={PERCENT} onBegin={() => {}} onDrag={setPan} onEnd={() => {}} onCancel={() => {}} onSet={setPan} />
            <span className="text-[10px] font-medium text-muted-foreground">PAN {panText(pan)}</span>
          </div>
        </div>
        {!many && (
          <div className="grid grid-cols-2 gap-2">
            <div className="grid gap-1">
              <Label htmlFor="note-start" className="text-xs">
                Start time
              </Label>
              <Input id="note-start" className="h-7 font-mono" value={start} onChange={(e) => setStart(e.target.value)} aria-invalid={startTicks === null} />
            </div>
            <div className="grid gap-1">
              <Label htmlFor="note-length" className="text-xs">
                Duration
              </Label>
              <Input id="note-length" className="h-7 font-mono" value={length} onChange={(e) => setLength(e.target.value)} aria-invalid={lengthTicks === null || lengthTicks === 0} />
            </div>
          </div>
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" size="sm" onClick={close}>
            Cancel
          </Button>
          <Button type="submit" size="sm" disabled={!valid}>
            Accept
          </Button>
        </div>
      </form>
    </MusicWindow>
  );
}
