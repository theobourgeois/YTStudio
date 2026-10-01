import { useMemo, useState } from "react";
import { PiDownloadSimple, PiFolderOpen, PiWarning } from "react-icons/pi";
import { cn } from "cn";
import { compileSong } from "@shared/music/compile";
import {
  BITRATES,
  EXPORT_FORMATS,
  EXPORT_FORMAT_NAMES,
  type ExportFormat,
  type ExportSettings,
  type MusicExportJob,
  exportEstimate,
  isAudioFormat,
} from "@shared/music/export";
import { formatTime } from "@shared/format";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { WindowBody, WindowFooter } from "@/components/windows/floating-window";
import { isDesktop } from "@/lib/desktop";
import { musicApi } from "../api";
import { usePiano } from "../piano/store";
import { usePlaylist } from "../playlist/store";
import { useMusicPreferences } from "../preferences";
import { ResamplingSelect } from "../resampling-select";
import { useMusic } from "../store";
import { useTransport } from "../transport";
import { useMusicUi } from "../ui";
import { MusicWindow, centredOnDesktop } from "../window";
import { download, exportBusy, useSongExport } from "./store";

const WIDTH = 460;

/**
 * The export window (⌘R), FL Studio's (`docs/fl-studio/export.md`): what's rendered (song or pattern, and
 * what happens to the tail), the formats and their quality, stems, then Start and how it's going. The
 * song can be edited while it renders (what's exported is the song as it was at Start); closing the
 * window stops the export, so Esc doesn't close it then.
 */
export function ExportWindow() {
  const [initial] = useState(() => centredOnDesktop(WIDTH, 600));
  const job = useSongExport((s) => s.job);
  const busy = exportBusy(job);
  const close = () => {
    if (busy) void useSongExport.getState().abort();
    else useSongExport.getState().reset();
    useMusicUi.getState().setExportOpen(false);
  };
  return (
    <MusicWindow id="export" title="Export" initial={initial} keepsKeys escapeCloses={!busy} onClose={close} className="max-w-full" >
      <WindowBody className="w-[460px] gap-4 p-4">
        {job && job.state !== "failed" ? <Progressing job={job} /> : <ExportForm failed={job?.error ?? null} />}
      </WindowBody>
    </MusicWindow>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="grid gap-2" aria-label={title}>
      <h3 className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">{title}</h3>
      <div className="grid gap-2.5 rounded-md border bg-surface-1 px-3 py-2.5">{children}</div>
    </section>
  );
}

function Row({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <div className="flex min-h-7 items-center justify-between gap-4">
      <span className="text-[13px]" title={hint}>
        {label}
      </span>
      <div className="flex items-center gap-2">{children}</div>
    </div>
  );
}

/** A small choice of numbers (bit depths, bitrates). */
function NumberSelect({ value, options, onChange, label, format }: { value: number; options: readonly number[]; onChange: (value: number) => void; label: string; format: (value: number) => string }) {
  return (
    <Select value={String(value)} onValueChange={(v) => onChange(Number(v))}>
      <SelectTrigger size="sm" className="w-36" aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option} value={String(option)}>
            {format(option)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

const toggleItem = "h-7 px-3 text-xs";

function ExportForm({ failed }: { failed: string | null }) {
  const settings = useSongExport((s) => s.settings);
  const destination = useSongExport((s) => s.destination);
  const starting = useSongExport((s) => s.starting);
  const set = useSongExport((s) => s.setSettings);
  const resampling = useMusicPreferences((s) => s.exportResampling);
  const has = (format: ExportFormat) => settings.formats.includes(format);
  const audio = settings.formats.some(isAudioFormat);
  const sixteen = (has("wav") && settings.wavBits === 16) || (has("flac") && settings.flacBits === 16);

  return (
    <>
      <Destination destination={destination} />

      <Section title="Project type">
        <Row label="Mode">
          <ToggleGroup type="single" value={settings.mode} onValueChange={(mode) => mode && set({ mode: mode as ExportSettings["mode"] })} variant="outline" aria-label="Mode">
            <ToggleGroupItem value="song" className={toggleItem}>
              Song
            </ToggleGroupItem>
            <ToggleGroupItem value="pattern" className={toggleItem}>
              Pattern
            </ToggleGroupItem>
          </ToggleGroup>
        </Row>
        <Row label="Tail" hint="What happens to sound still ringing at the end (a reverb, a long release)">
          <ToggleGroup type="single" value={settings.tail} onValueChange={(tail) => tail && set({ tail: tail as ExportSettings["tail"] })} variant="outline" aria-label="Tail">
            <ToggleGroupItem value="cut" className={toggleItem}>
              Cut at the end
            </ToggleGroupItem>
            <ToggleGroupItem value="ring" className={toggleItem}>
              Let it ring out
            </ToggleGroupItem>
          </ToggleGroup>
        </Row>
        <Estimate settings={settings} />
      </Section>

      <Section title="Output format">
        <ToggleGroup
          type="multiple"
          value={settings.formats}
          onValueChange={(formats) => formats.length && set({ formats: formats as ExportFormat[] })}
          variant="outline"
          className="w-full"
          aria-label="Formats"
        >
          {EXPORT_FORMATS.map((format) => (
            <ToggleGroupItem key={format} value={format} className={cn(toggleItem, "flex-1")}>
              {EXPORT_FORMAT_NAMES[format]}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        {has("wav") && (
          <Row label="WAV bit depth">
            <NumberSelect label="WAV bit depth" value={settings.wavBits} options={[16, 24, 32]} onChange={(wavBits) => set({ wavBits: wavBits as ExportSettings["wavBits"] })} format={(b) => (b === 32 ? "32-bit float" : `${b}-bit`)} />
          </Row>
        )}
        {has("mp3") && (
          <Row label="MP3 bitrate">
            <NumberSelect label="MP3 bitrate" value={settings.mp3Bitrate} options={BITRATES.mp3} onChange={(mp3Bitrate) => set({ mp3Bitrate })} format={(k) => `${k} kb/s`} />
          </Row>
        )}
        {has("flac") && (
          <Row label="FLAC">
            <NumberSelect label="FLAC bit depth" value={settings.flacBits} options={[16, 24]} onChange={(flacBits) => set({ flacBits: flacBits as ExportSettings["flacBits"] })} format={(b) => `${b}-bit`} />
            <NumberSelect label="FLAC compression" value={settings.flacLevel} options={[0, 2, 5, 8]} onChange={(flacLevel) => set({ flacLevel })} format={(l) => `Level ${l}`} />
          </Row>
        )}
        {has("ogg") && (
          <Row label="OGG bitrate">
            <NumberSelect label="OGG bitrate" value={settings.oggBitrate} options={BITRATES.ogg} onChange={(oggBitrate) => set({ oggBitrate })} format={(k) => `${k} kb/s`} />
          </Row>
        )}
        {has("m4a") && (
          <Row label="M4A bitrate">
            <NumberSelect label="M4A bitrate" value={settings.m4aBitrate} options={BITRATES.m4a} onChange={(m4aBitrate) => set({ m4aBitrate })} format={(k) => `${k} kb/s`} />
          </Row>
        )}
      </Section>

      <Section title="Quality">
        <Row label="Resampling" hint="How samplers and audio clips are read when pitched (Settings has it too)">
          <ResamplingSelect value={resampling} onChange={(value) => set({ resampling: value })} label="Resampling" />
        </Row>
        <Row label="Dither" hint="Shaped noise when going down to 16 bits: only heard in very quiet passages">
          <Switch checked={settings.dither} disabled={!sixteen} onCheckedChange={(dither) => set({ dither })} aria-label="Dither" />
        </Row>
      </Section>

      <Section title="Miscellaneous">
        <Row label="Split mixer tracks" hint="A file for each mixer track that has sound, from the same render, in time with the mix">
          <Switch checked={settings.stems} disabled={!audio} onCheckedChange={(stems) => set({ stems })} aria-label="Split mixer tracks" />
        </Row>
        {settings.stems && audio && (
          <Row label="Include the mix">
            <Switch checked={settings.includeMix} onCheckedChange={(includeMix) => set({ includeMix })} aria-label="Include the mix" />
          </Row>
        )}
        {isDesktop && (
          <Row label="Show in Finder when done">
            <Switch checked={settings.reveal} onCheckedChange={(reveal) => set({ reveal })} aria-label="Show in Finder when done" />
          </Row>
        )}
      </Section>

      {failed && (
        <p className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive" role="alert">
          <PiWarning className="mt-0.5 shrink-0" />
          {failed}
        </p>
      )}

      <WindowFooter>
        <Button variant="ghost" onClick={() => useMusicUi.getState().setExportOpen(false)}>
          Cancel
        </Button>
        <Button className="bg-brand text-brand-foreground hover:bg-brand/90" disabled={starting} onClick={() => void useSongExport.getState().start()} data-autofocus>
          Start
        </Button>
      </WindowFooter>
    </>
  );
}

/** Where the files go: beside the save dialog's file (Change… asks again), or downloaded from a browser. */
function Destination({ destination }: { destination: string | null }) {
  if (!isDesktop)
    return <p className="text-[13px] text-muted-foreground">The files are downloaded when they're ready.</p>;
  const name = destination?.split(/[\\/]/).pop() ?? null;
  const folder = destination ? destination.slice(0, destination.length - (name?.length ?? 0) - 1).split(/[\\/]/).pop() : null;
  return (
    <div className="flex items-center justify-between gap-3 text-[13px]">
      <span className="min-w-0 truncate" title={destination ?? undefined} data-testid="export-destination">
        {destination ? (
          <>
            <span className="font-medium">{name}</span>
            <span className="text-muted-foreground"> in {folder}</span>
          </>
        ) : (
          <span className="text-muted-foreground">Choose where to save it</span>
        )}
      </span>
      <Button size="sm" variant="outline" onClick={() => void useSongExport.getState().chooseDestination()}>
        {destination ? "Change…" : "Choose…"}
      </Button>
    </div>
  );
}

/** The length, time and disk space: worked out from the song as it'd be exported now. */
function Estimate({ settings }: { settings: ExportSettings }) {
  const doc = useMusic((s) => s.history?.doc ?? null);
  const patternId = useMusic((s) => s.patternId);
  const playlistTime = usePlaylist((s) => s.time);
  const pianoTime = usePiano((s) => s.time);
  const sampleRate = useTransport((s) => s.sampleRate);
  const selection = settings.mode === "song" ? playlistTime : pianoTime;
  const estimate = useMemo(() => {
    if (!doc) return null;
    const compiled = compileSong(doc, patternId, selection, settings.mode);
    const master = compiled.tracks.length - 1;
    const stems = new Set(compiled.channels.map((c) => c.track).filter((t) => t !== master)).size;
    return exportEstimate(compiled.loopTicks, compiled.tempo, compiled.barTicks, settings, sampleRate, stems);
  }, [doc, patternId, selection, settings, sampleRate]);
  if (!estimate) return null;
  return (
    <dl className="flex items-center justify-between rounded bg-muted/60 px-2.5 py-1.5 text-xs" data-testid="export-estimate">
      <Stat label="Length" value={`${Math.round(estimate.bars * 100) / 100} bar${estimate.bars === 1 ? "" : "s"}`} />
      <Stat label="Time" value={formatTime(estimate.seconds)} />
      <Stat label="Disk" value={`~${megabytes(estimate.bytes)}`} />
      {selection && <span className="text-muted-foreground">Time selection</span>}
    </dl>
  );
}

const megabytes = (bytes: number) => (bytes < 1e6 ? `${Math.max(1, Math.round(bytes / 1e3))} KB` : `${(bytes / 1e6).toFixed(1)} MB`);

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-1.5">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium tabular-nums">{value}</dd>
    </div>
  );
}

/** How the export is going, then what it made. */
function Progressing({ job }: { job: MusicExportJob }) {
  const busy = exportBusy(job);
  const part = job.state === "rendering" ? job.rendered * 0.9 : job.state === "encoding" ? 0.9 + (job.toEncode ? (job.encoded / job.toEncode) * 0.1 : 0) : 1;
  const realTime = job.length && job.renderSeconds ? job.length / job.renderSeconds : null;
  return (
    <>
      <div className="grid gap-2" data-testid="export-progress">
        <div className="flex items-baseline justify-between text-[13px]">
          <span className="font-medium">
            {job.state === "rendering"
              ? job.rendered >= 1
                ? "Rendering the tail…"
                : "Rendering…"
              : job.state === "encoding"
                ? `Encoding ${job.encoded} of ${job.toEncode}…`
                : job.state === "aborted"
                  ? "Stopped"
                  : "Exported"}
          </span>
          {busy && <span className="text-xs text-muted-foreground tabular-nums">{Math.round(part * 100)}%</span>}
          {job.state === "done" && job.seconds !== null && (
            <span className="text-xs text-muted-foreground tabular-nums">
              in {job.seconds.toFixed(1)} s{realTime ? `, ${Math.round(realTime)}× real time` : ""}
            </span>
          )}
        </div>
        <Progress value={part * 100} />
        {busy && <p className="text-xs text-muted-foreground">Keep editing: the song is exported as it was when you pressed Start. Playback comes back when it's done.</p>}
      </div>

      {job.missing.length > 0 && (
        <p className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-900 dark:text-amber-200" role="status">
          <PiWarning className="mt-0.5 shrink-0 text-amber-600 dark:text-amber-400" />
          Not heard (their plugin or sample couldn't be loaded): {job.missing.join(", ")}.
        </p>
      )}

      {job.state === "done" && (
        <ul className="grid max-h-56 gap-1 overflow-y-auto rounded-md border bg-surface-1 p-1.5" aria-label="Exported files">
          {job.files.map((file) => (
            <li key={file.name} className="flex items-center justify-between gap-2 rounded px-1.5 py-1 text-[13px] hover:bg-muted/60">
              <span className="min-w-0 truncate" title={file.path ?? file.name}>
                {file.name}
              </span>
              <span className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground tabular-nums">
                {megabytes(file.bytes)}
                {file.path === null && (
                  <Button size="icon-sm" variant="ghost" aria-label={`Download ${file.name}`} onClick={() => download(job.id, file.name)}>
                    <PiDownloadSimple />
                  </Button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}

      <WindowFooter>
        {busy ? (
          <Button variant="outline" onClick={() => void useSongExport.getState().abort()}>
            Stop
          </Button>
        ) : (
          <>
            {job.state === "done" && job.files.some((f) => f.path) && (
              <Button variant="outline" onClick={() => void musicApi.revealExport(job.id)}>
                <PiFolderOpen />
                Show in Finder
              </Button>
            )}
            {job.state === "done" && job.files.length > 1 && job.files.every((f) => f.path === null) && (
              <Button variant="outline" onClick={() => job.files.forEach((f) => download(job.id, f.name))}>
                <PiDownloadSimple />
                Download all
              </Button>
            )}
            <Button variant="ghost" onClick={() => useSongExport.getState().reset()}>
              Export again
            </Button>
            <Button className="bg-brand text-brand-foreground hover:bg-brand/90" onClick={() => useMusicUi.getState().setExportOpen(false)}>
              Done
            </Button>
          </>
        )}
      </WindowFooter>
    </>
  );
}
