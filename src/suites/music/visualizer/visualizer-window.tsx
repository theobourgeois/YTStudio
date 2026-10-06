import { useMemo, useState } from "react";
import { PiInfo, PiWarning } from "react-icons/pi";
import { cn } from "cn";
import { VISUALIZER_ASPECTS, VISUALIZER_FPS, VISUALIZER_LOOKS } from "@shared/handoff";
import { type VisualizerJob, visualizerSources } from "@shared/music/visualizer";
import { formatTime } from "@shared/format";
import type { SignalRole } from "@shared/types";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { WindowBody, WindowFooter } from "@/components/windows/floating-window";
import { useMusic, useSong } from "../store";
import { MusicWindow, centredOnDesktop } from "../window";
import { useVisualizer, visualizerBusy } from "./store";

const WIDTH = 480;

const ROLE_LABELS: Record<SignalRole | "none", string> = {
  kick: "Kick",
  snare: "Snare / clap",
  hats: "Hats",
  bass: "Bass",
  vocal: "Vocal",
  lead: "Lead",
  mix: "Mix",
  none: "Something else",
};

/**
 * Make visualizer (docs/visualizer/README.md, V5): the song becomes a video project, its mix and stems
 * rendered, its channels' notes as hits, its beat exact, with a starting look already reacting. Here the
 * user picks the look, the video's shape, and what goes over (each stem's and channel's role, guessed
 * from its name, to correct). Closing it while it renders stops it.
 */
export function VisualizerWindow() {
  const [initial] = useState(() => centredOnDesktop(WIDTH, 640));
  const job = useVisualizer((s) => s.job);
  const busy = visualizerBusy(job);
  return (
    <MusicWindow id="visualizer" title="Make visualizer" initial={initial} keepsKeys escapeCloses={!busy} onClose={() => useVisualizer.getState().close()} className="max-w-full">
      <WindowBody className="w-[480px] gap-4 p-4">{job && job.state !== "failed" && job.state !== "aborted" ? <Making job={job} /> : <Choices failed={job?.error ?? null} />}</WindowBody>
    </MusicWindow>
  );
}

function Section({ title, children, hint }: { title: string; children: React.ReactNode; hint?: React.ReactNode }) {
  return (
    <section className="grid gap-2" aria-label={title}>
      <h3 className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">{title}</h3>
      <div className="grid gap-1.5 rounded-md border bg-surface-1 px-3 py-2.5">{children}</div>
      {hint}
    </section>
  );
}

const toggleItem = "h-7 px-3 text-xs";

function Choices({ failed }: { failed: string | null }) {
  const song = useSong((s) => s);
  const patternId = useMusic((s) => s.patternId);
  const sources = useMemo(() => visualizerSources(song, patternId), [song, patternId]);
  const video = useVisualizer((s) => s.video);
  const off = useVisualizer((s) => s.off);
  const roles = useVisualizer((s) => s.roles);
  const starting = useVisualizer((s) => s.starting);
  const store = useVisualizer.getState();
  const silent = !sources.stems.length && !sources.channels.length;

  return (
    <>
      <p className="text-[13px] text-muted-foreground">
        A {video.aspectRatio} video of the {sources.mode === "song" ? "song" : "pattern shown"} ({formatTime(sources.length)}): its mix, a stem for each mixer
        track, each channel's notes as hits and its exact beat, with a look already reacting to them. It opens in a tab of its own.
      </p>

      <Section title="Look">
        <div className="grid grid-cols-2 gap-1.5" role="radiogroup" aria-label="Look">
          {VISUALIZER_LOOKS.map((look) => (
            <button
              key={look.id}
              type="button"
              role="radio"
              aria-checked={video.look === look.id}
              onClick={() => store.setVideo({ look: look.id })}
              className={cn("raised grid gap-0.5 rounded-md border px-2.5 py-2 text-left", video.look === look.id ? "border-brand bg-brand/10 ring-1 ring-brand" : "hover:bg-muted/60")}
            >
              <span className="text-[13px] font-medium">{look.label}</span>
              <span className="text-[11px] leading-snug text-muted-foreground">{look.description}</span>
            </button>
          ))}
        </div>
        <div className="flex min-h-7 items-center justify-between gap-4 pt-1">
          <span className="text-[13px]">Shape</span>
          <div className="flex items-center gap-2">
            <ToggleGroup type="single" value={video.aspectRatio} onValueChange={(v) => v && store.setVideo({ aspectRatio: v as typeof video.aspectRatio })} variant="outline" aria-label="Aspect ratio">
              {VISUALIZER_ASPECTS.map((a) => (
                <ToggleGroupItem key={a} value={a} className={toggleItem}>
                  {a}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
            <ToggleGroup type="single" value={String(video.fps)} onValueChange={(v) => v && store.setVideo({ fps: Number(v) })} variant="outline" aria-label="Frame rate">
              {VISUALIZER_FPS.map((f) => (
                <ToggleGroupItem key={f} value={String(f)} className={toggleItem}>
                  {f} fps
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>
        </div>
      </Section>

      <Section
        title="Stems"
        hint={
          sources.direct.length > 0 && (
            <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
              <PiInfo className="mt-0.5 shrink-0" />
              {listOf(sources.direct)} {sources.direct.length === 1 ? "plays" : "play"} straight into the master, so no stem is theirs alone: route a channel to an
              insert of its own to get one.
            </p>
          )
        }
      >
        {sources.stems.length ? (
          sources.stems.map((stem) => (
            <Choice
              key={stem.trackId}
              id={stem.trackId}
              label={stem.name}
              detail={stem.channels.length ? listOf(stem.channels) : "a bus"}
              color={stem.color}
              on={!off.includes(stem.trackId)}
              role={roles[stem.trackId] ?? stem.role ?? "none"}
            />
          ))
        ) : (
          <p className="py-1 text-xs text-muted-foreground">No mixer track has a sound of its own: the video gets the mix alone.</p>
        )}
      </Section>

      <Section title="Notes as hits">
        {sources.channels.length ? (
          sources.channels.map((channel) => (
            <Choice
              key={channel.channelId}
              id={channel.channelId}
              label={channel.name}
              detail={`${channel.notes} note${channel.notes === 1 ? "" : "s"}`}
              color={channel.color}
              on={!off.includes(channel.channelId)}
              role={roles[channel.channelId] ?? channel.role ?? "none"}
            />
          ))
        ) : (
          <p className="py-1 text-xs text-muted-foreground">No channel plays notes.</p>
        )}
      </Section>

      {failed && (
        <p className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs" role="alert">
          <PiWarning className="mt-0.5 shrink-0 text-destructive" />
          {failed}
        </p>
      )}

      <WindowFooter>
        <Button variant="ghost" onClick={() => store.close()}>
          Cancel
        </Button>
        <Button className="bg-brand text-brand-foreground hover:bg-brand/90" disabled={starting || (silent && !song.playlist.clips.length)} onClick={() => void store.make()}>
          Make visualizer
        </Button>
      </WindowFooter>
    </>
  );
}

/** A stem or channel: whether it goes over, and what it is. */
function Choice({ id, label, detail, color, on, role }: { id: string; label: string; detail: string; color: string; on: boolean; role: SignalRole | "none" }) {
  const store = useVisualizer.getState();
  return (
    <div className="flex min-h-8 items-center gap-2.5" data-testid={`visualizer-choice-${id}`}>
      <Switch checked={on} onCheckedChange={(checked) => store.setOn(id, checked)} aria-label={`Include ${label}`} />
      <span className="size-2.5 shrink-0 rounded-full" style={{ background: color }} />
      <span className={cn("min-w-0 flex-1 truncate text-[13px]", !on && "text-muted-foreground")} title={detail}>
        {label} <span className="text-xs text-muted-foreground">· {detail}</span>
      </span>
      <Select value={role} onValueChange={(v) => store.setRole(id, v as SignalRole | "none")} disabled={!on}>
        <SelectTrigger size="sm" className="w-36" aria-label={`What ${label} is`}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {(Object.keys(ROLE_LABELS) as (SignalRole | "none")[]).map((r) => (
            <SelectItem key={r} value={r}>
              {ROLE_LABELS[r]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

/** How it's going. */
function Making({ job }: { job: VisualizerJob }) {
  const busy = visualizerBusy(job);
  const part = job.state === "rendering" ? job.rendered * 0.8 : job.state === "making" ? 0.9 : 1;
  return (
    <>
      <div className="grid gap-2" data-testid="visualizer-progress">
        <div className="flex items-baseline justify-between text-[13px]">
          <span className="font-medium">{job.state === "rendering" ? "Rendering the song and its stems…" : job.state === "making" ? "Making the video…" : "Made"}</span>
          {busy && <span className="text-xs text-muted-foreground tabular-nums">{Math.round(part * 100)}%</span>}
        </div>
        <Progress value={part * 100} />
        {busy && <p className="text-xs text-muted-foreground">Keep editing: the song is used as it was when you pressed Make. Playback comes back when it's rendered.</p>}
      </div>
      {job.missing.length > 0 && (
        <p className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-900 dark:text-amber-200" role="status">
          <PiWarning className="mt-0.5 shrink-0 text-amber-600 dark:text-amber-400" />
          Not heard (their plugin or sample couldn't be loaded): {job.missing.join(", ")}.
        </p>
      )}
      <WindowFooter>
        {job.state === "rendering" && (
          <Button variant="outline" onClick={() => void useVisualizer.getState().abort()}>
            Stop
          </Button>
        )}
      </WindowFooter>
    </>
  );
}

/** "Kick", "Kick and Hat", "Kick, Hat and Snare". */
function listOf(names: string[]): string {
  return names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}
