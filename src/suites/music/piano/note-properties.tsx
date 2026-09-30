import { useState } from "react";
import { editNotes, setNoteProps } from "@shared/music/notes";
import { DEFAULT_VELOCITY } from "@shared/music/project";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Knob, PERCENT, panText, percent } from "../knob";
import { useMusic } from "../store";
import { pianoContext } from "./actions";
import { formatLength, formatPosition, parseTime, pitchName } from "./geometry";
import { usePiano } from "./store";

/**
 * A note's properties (a double-click on it): its velocity and pan, and its start and length as
 * bar:step:tick. If it's one of the selection, the levels apply to all of them (and the times, which
 * they don't share, aren't shown), as in FL Studio.
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
    <Dialog open onOpenChange={(open) => !open && close()}>
      <DialogContent className="sm:max-w-xs" data-testid="note-properties">
        <DialogHeader>
          <DialogTitle>
            Note properties – {pitchName(note.pitch)}
            {many && ` and ${ctx.selected.size - 1} more`}
          </DialogTitle>
        </DialogHeader>
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
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="note-start">Start time</Label>
              <Input id="note-start" className="h-8 font-mono" value={start} onChange={(e) => setStart(e.target.value)} aria-invalid={startTicks === null} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="note-length">Duration</Label>
              <Input id="note-length" className="h-8 font-mono" value={length} onChange={(e) => setLength(e.target.value)} aria-invalid={lengthTicks === null || lengthTicks === 0} />
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={close}>
            Cancel
          </Button>
          <Button disabled={!valid} onClick={accept}>
            Accept
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
