import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  PiArrowsInSimple,
  PiArrowsOutSimple,
  PiKeyboard,
  PiMetronome,
  PiPauseFill,
  PiPlayFill,
  PiShuffle,
  PiSkipBackFill,
  PiSkipForwardFill,
  PiWaveform,
  PiX,
} from "react-icons/pi";
import { LIVE_LOOKS, LOOK_KINDS, SWITCHES, type LookKind, liveLook, seededRandom, switchTransition } from "@shared/live-looks";
import { positionAt } from "@shared/now-playing";
import { formatDuration } from "@shared/format";
import type { MusicAnalysis } from "@shared/types";
import { cn } from "cn";
import { PreviewEngine } from "@/components/preview/engine";
import { useNow } from "@/hooks/use-now";
import { CHUNK_SECONDS } from "@/lib/live-audio";
import { useNowPlaying } from "@/stores/now-playing";
import { LiveDirector } from "./director";
import { VISUALIZER_KEYS, visualizerKey } from "./keys";
import { ImageSlots, LiveSource } from "./live-source";
import { LatencyReadout, TapSync, type Tapper } from "./sync";
import { AUTO_SWITCHES, QUALITIES, useVisualizerPrefs } from "./prefs";

/** Seconds the controls stay after the pointer stops. */
const IDLE_MS = 2600;
/** Seconds the song's card shows when a song starts. */
const CARD_MS = 5000;
/** Listening this long, a new song starts a new session (what's kept grows about 50 kB a second). */
const SESSION_SECONDS = 600;
/** Seconds a look stays before a drop may change it. */
const DROP_SETTLE = 8;

/** The first downbeat at or after `after` within `within` seconds (else `after`): switches land on the bar. */
function onTheBar(rhythm: MusicAnalysis | null | undefined, after: number, within = 3): number {
  const next = rhythm?.downbeats.find((t) => t >= after);
  return next !== undefined && next - after <= within ? next : after;
}

/** Seconds a bar lasts (two without a beat). */
const barSeconds = (rhythm: MusicAnalysis | null | undefined) => (rhythm?.bpm ? (4 * 60) / rhythm.bpm : 2);

/**
 * Now Playing's visualizer (docs/now-playing.md): the window filled with a look reacting to what the computer is
 * playing, the song's card when it starts, and controls that come with the pointer: the looks, the song, how
 * looks change. Its keys are vaudio's play mode (`keys.ts`). Drawn by the preview engine from a project of its own
 * (`LiveDirector`), at the listening session's time (`LiveSource`).
 */
export default function NowPlayingView() {
  const status = useNowPlaying((s) => s.status);
  const listening = useNowPlaying((s) => s.listening);
  const palette = useNowPlaying((s) => s.palette);
  const prefs = useVisualizerPrefs();

  const [director] = useState(() => new LiveDirector());
  const sessionRef = useRef<string | null>(null);
  // The song and colours the look shown was made for.
  const songRef = useRef<string | null>(null);
  const shownPalette = useRef<object | null>(null);
  const dueRef = useRef<number | null>(null);
  // The last drop heard (a look changes on one, unless looks stay).
  const dropRef = useRef<number | null>(null);
  const variationRef = useRef(0);
  const historyRef = useRef<string[]>([]);

  // What the tick (outside React) needs, as of the last render.
  const latest = useRef({ status, palette, prefs });
  latest.current = { status, palette, prefs };

  const [source] = useState(
    () =>
      new LiveSource(
        director,
        () => {
          const live = useNowPlaying.getState().live;
          return live ? { signals: live.signals, session: live.session } : null;
        },
        () => useNowPlaying.getState().offset / 1000,
        CHUNK_SECONDS,
        (time) => tick(time),
        () => useNowPlaying.getState().status?.track?.artwork ?? null,
      ),
  );
  const [noWebGl, setNoWebGl] = useState(false);
  // Seen as soon as it's drawn: it follows sound heard live.
  const [engine] = useState(() => new PreviewEngine(({ noWebGl }) => setNoWebGl(noWebGl), source, true, { lowLatency: true }));
  // Pictures the looks show (the cover): an image pair per track, kept as tracks come and go.
  const imageBox = useRef<HTMLDivElement>(null);
  const images = useRef<ImageSlots | null>(null);
  useEffect(() => {
    const slots = new ImageSlots(imageBox.current!);
    images.current = slots;
    return () => {
      images.current = null;
      slots.dispose();
    };
  }, []);

  /** Show a look: at once (`cut`), soon through a transition, or on the next bar. */
  const show = (lookId: string, how: "cut" | "now" | "bar", time = source.now) => {
    const look = liveLook(lookId) ?? LIVE_LOOKS[0];
    const { status: s, palette: p, prefs: pr } = latest.current;
    const random = seededRandom(`${s?.track?.id ?? "nothing"}:${look.id}:${variationRef.current}`);
    const kind = SWITCHES[Math.floor(random() * SWITCHES.length)];
    const seconds = how === "now" ? 0.6 : 1 + random() * 0.8;
    const rhythm = useNowPlaying.getState().live?.signals.data().header.rhythm;
    const at = how === "cut" ? time : how === "now" ? time + seconds / 2 + 0.03 : onTheBar(rhythm, time + seconds / 2 + 0.1);
    director.show(look, { palette: p, random }, at, how === "cut" ? null : switchTransition(kind, seconds));
    songRef.current = s?.track?.id ?? null;
    shownPalette.current = p;
    historyRef.current = [...historyRef.current.filter((id) => id !== look.id), look.id].slice(-6);
    if (pr.look !== look.id) useVisualizerPrefs.getState().setLook(look.id);
    const bars = AUTO_SWITCHES.find((a) => a.id === pr.auto)?.bars;
    dueRef.current = bars ? at + bars * barSeconds(rhythm) : null;
  };

  /** A look not shown lately (of `kind`, if given). */
  const another = (kind?: LookKind) => {
    const pool = LIVE_LOOKS.filter((l) => (!kind || l.kind === kind) && !historyRef.current.includes(l.id));
    const from = pool.length ? pool : LIVE_LOOKS;
    return from[Math.floor(Math.random() * from.length)].id;
  };

  /** Each frame, before it's drawn: start, follow sessions, change looks when it's time. */
  function tick(time: number) {
    const live = useNowPlaying.getState().live;
    if (!live) return;
    if (sessionRef.current !== live.session) {
      // A new session (listening started, or started again): its time starts at 0.
      const first = sessionRef.current === null;
      sessionRef.current = live.session;
      director.reset();
      if (!first) source.restart();
      show(latest.current.prefs.look, "cut", first ? time : 0);
      return;
    }
    director.prune(time);
    images.current?.sync(engine, director.project);
    if (dueRef.current !== null && time >= dueRef.current - 0.6) {
      dueRef.current = null;
      variationRef.current++;
      show(another(), "bar", time);
      return;
    }
    // A drop (the sound suddenly louder): a new look on it, if this one's had its moment.
    const drop = live.signals.data().header.rhythm?.drops.at(-1)?.time;
    if (drop !== undefined && drop !== dropRef.current) {
      dropRef.current = drop;
      const since = time - (director.lookStart ?? 0);
      if (latest.current.prefs.auto !== "off" && since > DROP_SETTLE && time - drop < 1.5) {
        variationRef.current++;
        show(another(), "now", time);
      }
    }
  }

  // New colours (a new song's cover read): a new look for a new song, else this one in them.
  useEffect(() => {
    // Nothing shown yet: the first look takes the colours of the moment.
    if (!sessionRef.current || shownPalette.current === palette) return;
    const song = latest.current.status?.track?.id ?? null;
    const newSong = song !== songRef.current;
    const live = useNowPlaying.getState().live;
    // A long session starts again on a song's change, where the picture changes anyway.
    if (newSong && live && live.signals.seconds > SESSION_SECONDS) {
      live.restart();
      return;
    }
    if (newSong) variationRef.current = 0;
    show(newSong && prefs.auto !== "off" ? another() : (director.look ?? prefs.look), "now");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [palette]);

  // A look asked for from outside (the assistant).
  const requested = prefs.requested;
  useEffect(() => {
    if (requested && sessionRef.current) show(requested.look, "now");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requested]);

  // Drawing.
  const attachCanvas = useCallback((el: HTMLCanvasElement) => engine.attachCanvas(el), [engine]);
  useEffect(() => {
    engine.start();
    source.start();
    return () => {
      source.stop();
      engine.stop();
    };
  }, [engine, source]);
  const quality = QUALITIES.find((q) => q.id === prefs.quality) ?? QUALITIES[1];
  useEffect(() => engine.setResolution(quality.scale), [engine, quality.scale]);

  // The canvas covers the window at 16:9 (a 16:10 screen loses a sliver top and bottom).
  const box = useRef<HTMLDivElement>(null);
  const [area, setArea] = useState({ width: window.innerWidth, height: window.innerHeight });
  useLayoutEffect(() => {
    const node = box.current!;
    const observer = new ResizeObserver(([entry]) => setArea({ width: entry.contentRect.width, height: entry.contentRect.height }));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  const scale = Math.max(area.width / 16, area.height / 9);
  const size = { width: Math.round(16 * scale), height: Math.round(9 * scale) };
  useLayoutEffect(() => engine.setCanvasSize(size), [engine, size.width, size.height]); // eslint-disable-line react-hooks/exhaustive-deps

  // The controls come with the pointer and go when it rests.
  const [hudShown, setHudShown] = useState(true);
  const [hudHidden, setHudHidden] = useState(false);
  const [help, setHelp] = useState(false);
  const [readout, setReadout] = useState(false);
  // Tapping along to measure the headphones' delay: Space taps instead of playing and pausing.
  const [syncing, setSyncing] = useState(false);
  const syncingRef = useRef(false);
  syncingRef.current = syncing;
  const tapper = useRef<Tapper | null>(null);
  const stopSyncing = useCallback(() => setSyncing(false), []);
  const idle = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wake = () => {
    setHudShown(true);
    if (idle.current) clearTimeout(idle.current);
    idle.current = setTimeout(() => setHudShown(false), IDLE_MS);
  };
  useEffect(() => {
    wake();
    return () => {
      if (idle.current) clearTimeout(idle.current);
    };
  }, []);

  const [fullscreen, setFullscreen] = useState(!!document.fullscreenElement);
  useEffect(() => {
    const on = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", on);
    return () => document.removeEventListener("fullscreenchange", on);
  }, []);
  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void box.current?.requestFullscreen().catch(() => {});
  };
  const close = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    useNowPlaying.getState().closeVisualizer();
  };

  const step = (by: 1 | -1) => {
    const i = LIVE_LOOKS.findIndex((l) => l.id === (director.look ?? prefs.look));
    show(LIVE_LOOKS[(i + by + LIVE_LOOKS.length) % LIVE_LOOKS.length].id, "now");
  };
  const stepGroup = (by: 1 | -1) => {
    const current = liveLook(director.look ?? prefs.look)?.kind ?? "world";
    const k = LOOK_KINDS.findIndex((g) => g.id === current);
    const kind = LOOK_KINDS[(k + by + LOOK_KINDS.length) % LOOK_KINDS.length].id;
    show(LIVE_LOOKS.find((l) => l.kind === kind)!.id, "now");
  };

  // The keys: the visualizer has them all while it's open (the editor's under it don't hear them).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey) return;
      e.stopImmediatePropagation();
      // The controls' own lists keep their keys.
      if ((e.target as HTMLElement | null)?.tagName === "SELECT" && e.key !== "Escape") return;
      // Tapping along: Space taps, Escape stops.
      if (syncingRef.current) {
        if (e.key === " " && !e.repeat) tapper.current?.tap();
        else if (e.key === "Escape") tapper.current?.cancel();
        e.preventDefault();
        return;
      }
      const action = visualizerKey(e);
      if (!action) return;
      e.preventDefault();
      if (e.repeat && action.kind !== "pad") return;
      const np = useNowPlaying.getState();
      switch (action.kind) {
        case "close":
          return document.fullscreenElement ? void document.exitFullscreen() : close();
        case "fullscreen":
          return toggleFullscreen();
        case "look":
          return step(action.step);
        case "group":
          return stepGroup(action.step);
        case "random":
          variationRef.current++;
          return show(another(), "now");
        case "vary":
          variationRef.current++;
          return show(director.look ?? prefs.look, "now");
        case "pad":
          return director.hit(action.pad, source.now + 0.01);
        case "hue":
          return director.setHue(action.degrees);
        case "play":
          return void np.command({ action: "toggle" });
        case "song":
          return void np.command({ action: action.step === 1 ? "next" : "previous" });
        case "auto": {
          const i = AUTO_SWITCHES.findIndex((a) => a.id === useVisualizerPrefs.getState().auto);
          useVisualizerPrefs.getState().setAuto(AUTO_SWITCHES[(i + 1) % AUTO_SWITCHES.length].id);
          return wake();
        }
        case "hud":
          return setHudHidden((h) => !h);
        case "help":
          return setHelp((h) => !h);
        case "latency":
          return setReadout((r) => !r);
        case "sync":
          return setSyncing(true);
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (!e.metaKey && !e.ctrlKey) e.stopImmediatePropagation();
    };
    window.addEventListener("keydown", onKey, { capture: true });
    window.addEventListener("keyup", onKeyUp, { capture: true });
    return () => {
      window.removeEventListener("keydown", onKey, { capture: true });
      window.removeEventListener("keyup", onKeyUp, { capture: true });
    };
  });

  const showing = useCurrentLook(director, prefs.look);
  const controls = hudShown && !hudHidden;

  return (
    <div
      ref={box}
      data-now-playing-view
      className={cn("fixed inset-0 z-[70] overflow-hidden bg-black text-white select-none", !controls && "cursor-none")}
      onPointerMove={wake}
      onPointerDown={wake}
    >
      <canvas
        ref={attachCanvas}
        data-slot="visualizer-canvas"
        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2"
        style={size}
      />

      <div ref={imageBox} aria-hidden className="pointer-events-none absolute inset-0 opacity-0" />

      <SongCard visible={controls} />

      {listening !== "on" && <ListenPrompt />}
      {noWebGl && <p className="absolute inset-x-0 top-1/2 text-center text-sm text-white/70">This browser can't draw the visualizer: it needs WebGL 2.</p>}

      <div className={cn("pointer-events-none absolute inset-0 transition-opacity duration-500", controls ? "opacity-100" : "opacity-0")}>
        <div className="pointer-events-auto absolute top-4 right-4 flex items-center gap-1">
          <Hearing />
          <HudButton label="Tap along to sync (S)" onClick={() => setSyncing(true)} active={syncing}>
            <PiMetronome />
          </HudButton>
          <HudButton label="Keys" onClick={() => setHelp((h) => !h)} active={help}>
            <PiKeyboard />
          </HudButton>
          <HudButton label={fullscreen ? "Leave full screen (F)" : "Full screen (F)"} onClick={toggleFullscreen}>
            {fullscreen ? <PiArrowsInSimple /> : <PiArrowsOutSimple />}
          </HudButton>
          <HudButton label="Close (Esc)" onClick={close}>
            <PiX />
          </HudButton>
        </div>

        <div className="pointer-events-auto absolute inset-x-0 bottom-0 bg-linear-to-t from-black/80 via-black/45 to-transparent px-6 pt-16 pb-5">
          <LookPicker current={showing} onPick={(id) => show(id, "now")} />
          <div className="mt-3 flex items-center gap-4">
            <Transport />
            <div className="ml-auto flex items-center gap-2">
              <HudButton
                label="A look at random (R)"
                onClick={() => {
                  variationRef.current++;
                  show(another(), "now");
                }}
              >
                <PiShuffle />
              </HudButton>
              <HudSelect label="Change looks" value={prefs.auto} options={AUTO_SWITCHES} onChange={(id) => useVisualizerPrefs.getState().setAuto(id)} />
              <HudSelect label="Quality" value={prefs.quality} options={QUALITIES} onChange={(id) => useVisualizerPrefs.getState().setQuality(id)} />
            </div>
          </div>
        </div>
      </div>

      {help && <KeysHelp onClose={() => setHelp(false)} />}
      {readout && <LatencyReadout source={source} />}
      {syncing && <TapSync source={source} tapper={tapper} onDone={stopSyncing} />}
    </div>
  );
}

/** The look shown, as the director says (it changes outside React: checked a few times a second). */
function useCurrentLook(director: LiveDirector, fallback: string): string {
  const [look, setLook] = useState(director.look ?? fallback);
  useEffect(() => {
    const id = setInterval(() => setLook(director.look ?? fallback), 250);
    return () => clearInterval(id);
  }, [director, fallback]);
  return look;
}

/** The song: big when it starts (for a few seconds), small in the corner while the controls are up. */
function SongCard({ visible }: { visible: boolean }) {
  const track = useNowPlaying((s) => s.status?.track ?? null);
  const [fresh, setFresh] = useState(true);
  useEffect(() => {
    setFresh(true);
    const t = setTimeout(() => setFresh(false), CARD_MS);
    return () => clearTimeout(t);
  }, [track?.id]);
  if (!track) return null;
  const big = fresh;
  return (
    <div
      data-song-card={big ? "big" : "small"}
      className={cn(
        "pointer-events-none absolute top-6 left-6 flex items-center gap-4 transition-all duration-700",
        big || visible ? "opacity-100" : "opacity-0",
      )}
    >
      {track.artwork && (
        <img
          src={track.artwork}
          alt=""
          className={cn("rounded-md object-cover shadow-2xl ring-1 shadow-black/60 ring-white/10 transition-all duration-700", big ? "size-28" : "size-14")}
          draggable={false}
        />
      )}
      <div className="min-w-0 drop-shadow-[0_2px_8px_rgb(0_0_0/0.8)]">
        <p className={cn("truncate font-semibold tracking-tight transition-all duration-700", big ? "max-w-[60vw] text-4xl" : "max-w-[40vw] text-lg")}>{track.name}</p>
        <p className={cn("truncate text-white/75 transition-all duration-700", big ? "mt-1 text-lg" : "text-sm")}>
          {track.artist}
          {track.album && big && <span className="text-white/50"> · {track.album}</span>}
        </p>
      </div>
    </div>
  );
}

/** Asks to listen (the computer's sound is shared once per opening), or says why it can't. */
function ListenPrompt() {
  const listening = useNowPlaying((s) => s.listening);
  const error = useNowPlaying((s) => s.listenError);
  return (
    <div className="absolute inset-0 grid place-items-center">
      <div className="flex max-w-sm flex-col items-center gap-3 rounded-xl bg-black/60 px-7 py-6 text-center ring-1 ring-white/10 backdrop-blur-md">
        <PiWaveform className="size-7 text-white/80" />
        {listening === "starting" ? (
          <p className="text-sm text-white/80">Listening to what your computer plays…</p>
        ) : (
          <>
            <p className="text-sm leading-relaxed text-white/80">
              {error ?? "The visualizer moves with what your computer plays. It listens while it's open, and keeps nothing."}
            </p>
            <button
              type="button"
              onClick={() => void useNowPlaying.getState().listen()}
              className="rounded-md bg-white px-4 py-1.5 text-sm font-medium text-black hover:bg-white/90"
            >
              {error ? "Try again" : "Listen"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

/** Bars moving with what's heard: shows it's listening (and to something). */
function Hearing() {
  const listening = useNowPlaying((s) => s.listening === "on");
  const bars = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!listening) return;
    let frame = 0;
    const smooth = [0, 0, 0, 0, 0];
    const draw = () => {
      frame = requestAnimationFrame(draw);
      const live = useNowPlaying.getState().live;
      const levels = live ? live.signals.meter(smooth.length) : smooth.map(() => 0);
      const spans = bars.current?.children;
      if (!spans) return;
      levels.forEach((v, i) => {
        smooth[i] = v > smooth[i] ? v : smooth[i] * 0.85 + v * 0.15;
        (spans[i] as HTMLElement).style.transform = `scaleY(${0.12 + 0.88 * smooth[i]})`;
      });
    };
    draw();
    return () => cancelAnimationFrame(frame);
  }, [listening]);
  if (!listening) return null;
  return (
    <span className="mr-2 flex h-8 items-center gap-2 rounded-md px-2 text-xs text-white/70" title="Listening to your computer's sound">
      <span ref={bars} aria-hidden className="flex h-3.5 items-end gap-[2px]">
        {[0, 1, 2, 3, 4].map((i) => (
          <span key={i} className="h-full w-[3px] origin-bottom rounded-[1px] bg-white/85" style={{ transform: "scaleY(0.12)" }} />
        ))}
      </span>
      Listening
    </span>
  );
}

/** The looks, by kind: pick one. */
function LookPicker({ current, onPick }: { current: string; onPick: (id: string) => void }) {
  const kind = liveLook(current)?.kind ?? "world";
  const [group, setGroup] = useState<LookKind>(kind);
  useEffect(() => setGroup(kind), [kind]);
  return (
    <div data-look-picker className="flex flex-col gap-2">
      <div className="flex items-center gap-1">
        {LOOK_KINDS.map((g) => (
          <button
            key={g.id}
            type="button"
            onClick={() => setGroup(g.id)}
            className={cn("rounded-md px-2.5 py-1 text-xs font-medium", g.id === group ? "bg-white/15 text-white" : "text-white/55 hover:text-white")}
          >
            {g.label}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {LIVE_LOOKS.filter((l) => l.kind === group).map((l) => (
          <button
            key={l.id}
            type="button"
            data-look={l.id}
            aria-pressed={l.id === current}
            onClick={() => onPick(l.id)}
            className={cn(
              "rounded-full px-3 py-1 text-[13px] ring-1 transition-colors",
              l.id === current ? "bg-white text-black ring-white" : "bg-black/30 text-white/85 ring-white/15 hover:bg-white/10 hover:ring-white/30",
            )}
          >
            {l.name}
          </button>
        ))}
      </div>
    </div>
  );
}

/** The song's place, and play, pause and skip. */
function Transport() {
  const status = useNowPlaying((s) => s.status);
  const now = useNow(500);
  const track = status?.track;
  if (!status || !track) return <div className="text-sm text-white/50">Nothing's playing</div>;
  const playing = status.state === "playing";
  const position = positionAt(status, now);
  const { command } = useNowPlaying.getState();
  return (
    <div className="flex min-w-0 flex-1 items-center gap-3">
      <HudButton label="Previous song (⇧←)" onClick={() => void command({ action: "previous" })}>
        <PiSkipBackFill />
      </HudButton>
      <button
        type="button"
        aria-label={playing ? "Pause" : "Play"}
        title={playing ? "Pause (Space)" : "Play (Space)"}
        onClick={() => void command({ action: "toggle" })}
        className="grid size-10 shrink-0 place-items-center rounded-full bg-white text-black hover:bg-white/90 [&_svg]:size-4"
      >
        {playing ? <PiPauseFill /> : <PiPlayFill />}
      </button>
      <HudButton label="Next song (⇧→)" onClick={() => void command({ action: "next" })}>
        <PiSkipForwardFill />
      </HudButton>
      <span className="w-10 shrink-0 text-right font-mono text-xs text-white/60 tabular-nums">{formatDuration(Math.floor(position))}</span>
      <div
        className="group relative h-1 max-w-md min-w-24 flex-1 cursor-pointer rounded-full bg-white/20"
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          void command({ action: "seek", position: ((e.clientX - r.left) / r.width) * track.duration });
        }}
      >
        <div className="absolute inset-y-0 left-0 rounded-full bg-white" style={{ width: `${Math.min(100, (position / Math.max(1, track.duration)) * 100)}%` }} />
      </div>
      <span className="w-10 shrink-0 font-mono text-xs text-white/60 tabular-nums">{formatDuration(Math.floor(track.duration))}</span>
    </div>
  );
}

function HudButton({ label, onClick, active, children }: { label: string; onClick: () => void; active?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cn(
        "grid size-8 shrink-0 place-items-center rounded-md text-white/80 hover:bg-white/10 hover:text-white [&_svg]:size-4",
        active && "bg-white/15 text-white",
      )}
    >
      {children}
    </button>
  );
}

function HudSelect<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: { id: T; label: string }[]; onChange: (id: T) => void }) {
  return (
    <label className="flex items-center gap-2 text-xs text-white/60">
      {label}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        className="h-8 rounded-md bg-white/10 px-2 text-[13px] text-white ring-1 ring-white/15 outline-none hover:bg-white/15 [&>option]:text-black"
      >
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function KeysHelp({ onClose }: { onClose: () => void }) {
  return (
    <div className="absolute inset-0 grid place-items-center bg-black/40" onClick={onClose}>
      <div className="w-[min(92vw,460px)] rounded-xl bg-black/80 p-5 ring-1 ring-white/10 backdrop-blur-md" onClick={(e) => e.stopPropagation()}>
        <h2 className="mb-3 text-sm font-semibold">Keys</h2>
        <dl className="grid grid-cols-[auto_1fr] gap-x-5 gap-y-1.5 text-[13px]">
          {VISUALIZER_KEYS.map((k) => (
            <div key={k.keys} className="contents">
              <dt className="font-mono text-white/90">{k.keys}</dt>
              <dd className="text-white/65">{k.does}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}
