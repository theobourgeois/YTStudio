import { useEffect, useMemo, useRef, useState } from "react";
import { PiPlayFill, PiStopFill } from "react-icons/pi";
import type { ConvertSettings } from "@shared/music/convert";
import { NOTE_NAMES } from "@shared/music/scales";
import { PPQ, STEP_TICKS } from "@shared/music/types";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { WindowBody, WindowFooter } from "@/components/windows/floating-window";
import { Knob, MILLISECONDS, PERCENT, percent } from "../knob";
import { modelMegabytes, targetIn, useModelStatus } from "../ml";
import { useMusic, useSong } from "../store";
import { MusicWindow, centredOnDesktop } from "../window";
import { acceptConvert, closeConvert, conversion, downloadConvertModel, hearTarget, setConvertSettings, toggleConvertPreview, useConvert } from "./actions";

const WIDTH = 380;
const PREVIEW_HEIGHT = 110;

/** The Quantize choices: off, or a grid. */
const GRIDS: { ticks: number; label: string }[] = [
  { ticks: 0, label: "Off" },
  { ticks: STEP_TICKS / 2, label: "1/32" },
  { ticks: STEP_TICKS, label: "1/16" },
  { ticks: STEP_TICKS * 2, label: "1/8" },
  { ticks: PPQ, label: "1/4" },
];

const noteName = (pitch: number) => `${NOTE_NAMES[pitch % 12]}${Math.floor(pitch / 12) - 1}`;

/**
 * Convert to notes (an audio clip's menu, or an audio channel's in the rack; FL Studio's Edison "Convert to score
 * and dump to piano roll"): the notes heard in the clip, Melodic (any pitch) or Drums (kick, snare, hat), drawn
 * as the settings move; Preview plays the clip with them. Convert makes them a pattern on a sampler under the clip
 * and shows it in the Piano roll.
 */
export function ConvertWindow() {
  const target = useConvert((s) => s.target);
  const settings = useConvert((s) => s.settings);
  const heard = useConvert((s) => s.heard);
  const hearing = useConvert((s) => s.hearing);
  const error = useConvert((s) => s.error);
  const previewing = useConvert((s) => s.previewing);
  const ids = useConvert((s) => s.ids);
  const samples = useConvert((s) => s.samples);
  const song = useMusic((s) => s.history?.doc);
  const hasScale = useSong((s) => Boolean(s.settings.scale));
  const model = useModelStatus("notes");
  const [initial] = useState(() => centredOnDesktop(WIDTH, 420));
  const found = useMemo(() => (song && target ? targetIn(song, target) : null), [song, target]);
  const made = useMemo(() => (song && target && heard ? conversion(song, target, heard, settings, ids, samples) : null), [song, target, heard, settings, ids, samples]);
  // Once the model's downloaded (here or by another window), the file's heard.
  const ready = model?.status === "ready" || model?.standIn;
  useEffect(() => {
    if (ready && target && !heard && !hearing && !error) void hearTarget();
  }, [ready, target, heard, hearing, error]);
  if (!target || !found) return null;
  const melodic = settings.kind === "melodic";
  const notes = made?.parts.flatMap((p) => p.notes) ?? [];
  const summary = !made
    ? null
    : melodic
      ? notes.length
        ? `${notes.length} note${notes.length === 1 ? "" : "s"}, ${noteName(Math.min(...notes.map((n) => n.pitch)))} to ${noteName(Math.max(...notes.map((n) => n.pitch)))}`
        : "No notes heard: try more sensitivity."
      : made.parts.map((p) => `${p.notes.length} ${p.channel.name.toLowerCase()}${p.notes.length === 1 ? "" : "s"}`).join(", ");
  const set = (patch: Partial<ConvertSettings>) => setConvertSettings(patch);
  const noop = () => {};

  return (
    <MusicWindow id="to-notes" title="Convert to notes" initial={initial} keepsKeys onClose={closeConvert}>
      <WindowBody className="gap-3 p-3">
        <form
          className="flex flex-col gap-3"
          style={{ width: WIDTH - 24 }}
          data-testid="convert-window"
          onSubmit={(e) => {
            e.preventDefault();
            void acceptConvert();
          }}
        >
          <p className="truncate text-[12px] text-muted-foreground" title={"error" in found ? found.error : found.channel.name}>
            {"error" in found ? found.error : found.clip ? `${found.channel.name}: the notes in this clip` : `${found.channel.name}: the notes in its file`}
          </p>
          <ToggleGroup type="single" value={settings.kind} onValueChange={(kind) => kind && set({ kind: kind as ConvertSettings["kind"] })} variant="outline" className="w-full" aria-label="What to hear">
            <ToggleGroupItem value="melodic" className="h-7 flex-1 text-xs" title="Notes of any pitch: a melody, a bass line, chords">
              Melodic
            </ToggleGroupItem>
            <ToggleGroupItem value="drums" className="h-7 flex-1 text-xs" title="Kicks, snares and hats, each on a sampler of the starter kit's">
              Drums
            </ToggleGroupItem>
          </ToggleGroup>
          <div className="sunken flex items-center justify-around gap-2 rounded-sm px-2 py-2">
            <Labelled label="SENS" title="How readily a sound counts as a note">
              <Knob size={30} label="Sensitivity" value={settings.sensitivity} min={0} max={1} defaultValue={0.5} format={percent} unit={PERCENT} onBegin={noop} onDrag={(sensitivity) => set({ sensitivity })} onEnd={noop} onCancel={noop} onSet={(sensitivity) => set({ sensitivity })} />
            </Labelled>
            {melodic && (
              <Labelled label="SHORTEST" title="Notes shorter than this are left out">
                <Knob
                  size={30}
                  label="Shortest note"
                  value={settings.shortest / 1000}
                  min={0.02}
                  max={0.5}
                  defaultValue={0.128}
                  format={(v) => `${Math.round(v * 1000)} ms`}
                  unit={MILLISECONDS}
                  onBegin={noop}
                  onDrag={(v) => set({ shortest: v * 1000 })}
                  onEnd={noop}
                  onCancel={noop}
                  onSet={(v) => set({ shortest: v * 1000 })}
                />
              </Labelled>
            )}
            <Labelled label="QUANTIZE" title="Starts and ends moved onto a grid">
              <Select value={String(settings.quantize)} onValueChange={(v) => set({ quantize: Number(v) })}>
                <SelectTrigger size="sm" className="w-20" aria-label="Quantize">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {GRIDS.map((g) => (
                    <SelectItem key={g.ticks} value={String(g.ticks)}>
                      {g.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Labelled>
          </div>
          {melodic && (
            <label className="flex items-center justify-between gap-3 text-[13px]" title={hasScale ? "Each note moved to the nearest of the song's scale" : "The song has no scale (the Piano roll's scale menu)"}>
              Snap to the song's scale
              <Switch checked={settings.snapToScale && hasScale} disabled={!hasScale} onCheckedChange={(snapToScale) => set({ snapToScale })} aria-label="Snap to the song's scale" />
            </label>
          )}
          <NotesPreview parts={made?.parts ?? []} length={made ? noteSpan(made) : 0} drums={!melodic} />
          <p className="min-h-4 text-[11px] text-muted-foreground" data-testid="convert-summary">
            {error ?? (model && !ready ? null : hearing || !heard ? "Listening…" : summary)}
          </p>
          {model && !ready && (
            <div className="flex items-center gap-2 rounded-sm bg-surface-1 px-2 py-1.5 text-[11px] text-muted-foreground" data-testid="convert-model-note">
              <span className="flex-1">
                {model.status === "downloading"
                  ? `Downloading the transcription model… ${Math.round((model.progress ?? 0) * 100)}%`
                  : `This downloads a transcription model (Spotify's Basic Pitch, ${modelMegabytes("notes")}) once. It runs on this computer.`}
              </span>
              {model.status !== "downloading" && (
                <Button type="button" size="xs" onClick={() => void downloadConvertModel()}>
                  Download
                </Button>
              )}
            </div>
          )}
          <WindowFooter className="sm:justify-between">
            <Button type="button" variant="outline" size="sm" disabled={!made || !notes.length} onClick={toggleConvertPreview} aria-pressed={previewing} title="Hear the clip with its notes, looping">
              {previewing ? <PiStopFill /> : <PiPlayFill />}
              {previewing ? "Stop" : "Preview"}
            </Button>
            <div className="flex gap-2">
              <Button type="button" variant="outline" size="sm" onClick={closeConvert}>
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={!made || !notes.length}>
                Convert
              </Button>
            </div>
          </WindowFooter>
        </form>
      </WindowBody>
    </MusicWindow>
  );
}

/** How long the notes drawn span, in ticks: the clip's (or file's) length. */
function noteSpan(made: NonNullable<ReturnType<typeof conversion>>) {
  return Math.max(PPQ, ...made.parts.flatMap((p) => p.notes.map((n) => n.start + n.length)));
}

/** A knob or a choice with its name under it. */
function Labelled({ label, title, children }: { label: string; title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-1" title={title}>
      {children}
      <span className="text-[10px] font-semibold text-muted-foreground">{label}</span>
    </div>
  );
}

/** The notes as a small piano roll (time across, pitch up; drums a row each), redrawn as the settings move. */
function NotesPreview({ parts, length, drums }: { parts: NonNullable<ReturnType<typeof conversion>>["parts"]; length: number; drums: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const element = canvas.current;
    const g = element?.getContext("2d");
    if (!element || !g) return;
    const ratio = element.ownerDocument.defaultView?.devicePixelRatio ?? 1;
    const width = element.clientWidth;
    element.width = Math.round(width * ratio);
    element.height = Math.round(PREVIEW_HEIGHT * ratio);
    g.setTransform(ratio, 0, 0, ratio, 0, 0);
    g.clearRect(0, 0, width, PREVIEW_HEIGHT);
    const style = getComputedStyle(element);
    const notes = parts.flatMap((p, row) => p.notes.map((n) => ({ ...n, row })));
    if (!notes.length || !length) return;
    const pitches = notes.map((n) => n.pitch);
    const low = drums ? 0 : Math.min(...pitches) - 1;
    const high = drums ? parts.length - 1 : Math.max(...pitches) + 1;
    const rows = high - low + 1;
    const rowHeight = PREVIEW_HEIGHT / rows;
    g.fillStyle = style.getPropertyValue("--line").trim() || "#888";
    for (let beat = 0; beat <= length; beat += PPQ * 4) g.fillRect(Math.round((beat / length) * width), 0, 1, PREVIEW_HEIGHT);
    g.fillStyle = style.getPropertyValue("--brand").trim() || "#4a8";
    for (const n of notes) {
      const y = drums ? (high - n.row) * rowHeight : (high - n.pitch) * rowHeight;
      g.globalAlpha = 0.45 + 0.55 * Math.min(1, (n.velocity ?? 0.78) / 0.78);
      g.fillRect((n.start / length) * width, y + 0.5, Math.max(1.5, (n.length / length) * width - 0.5), Math.max(1.5, rowHeight - 1));
    }
    g.globalAlpha = 1;
  }, [parts, length, drums]);
  return <canvas ref={canvas} className="sunken block w-full rounded-sm" style={{ height: PREVIEW_HEIGHT }} data-testid="convert-preview" />;
}
