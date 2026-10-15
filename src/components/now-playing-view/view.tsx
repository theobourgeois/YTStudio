import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  PiArrowSquareIn,
  PiArrowSquareOut,
  PiArrowsInSimple,
  PiArrowsOutSimple,
  PiCaretDown,
  PiCaretLeft,
  PiCheck,
  PiCornersIn,
  PiCornersOut,
  PiKeyboard,
  PiMetronome,
  PiPauseFill,
  PiPictureInPicture,
  PiPlayFill,
  PiPushPin,
  PiPushPinFill,
  PiShuffle,
  PiSlidersHorizontal,
  PiSkipBackFill,
  PiSkipForwardFill,
  PiWaveform,
  PiX,
} from "react-icons/pi";
import { type Frame, LIVE_LOOKS, LOOK_KINDS, type LookKind, PLAIN_FRAME, SLOW_MOTION, liveLook, ofMany, seededRandom, switchTransition } from "@shared/live-looks";
import { MILKDROP_ASSET } from "@shared/live-milkdrop";
import { positionAt } from "@shared/now-playing";
import { isSlow } from "@shared/signals/mood";
import { formatDuration } from "@shared/format";
import type { MusicAnalysis } from "@shared/types";
import { cn } from "cn";
import { PreviewEngine } from "@/components/preview/engine";
import { type StageWindow, openStageWindow } from "@/components/windows/native/stage-window";
import { useNow } from "@/hooks/use-now";
import { log } from "@/lib/log";
import { CHUNK_SECONDS } from "@/lib/live-audio";
import { startPointerDrag } from "@/lib/pointer-drag";
import { addWindowListener, isElement, ownerWindow } from "@/lib/window-events";
import { useNowPlaying } from "@/stores/now-playing";
import { type Choice, LookChooser, type Moment, slowMotionOn } from "./chooser";
import { EFFECTS_MODES, EffectsEngine } from "./effects-engine";
import { LiveDirector } from "./director";
import { MilkDrop } from "./milkdrop";
import { VISUALIZER_KEYS, visualizerKey } from "./keys";
import { ImageSlots, LiveSource } from "./live-source";
import { MoodReadout } from "./mood-readout";
import { VibeOffer } from "./vibe-offer";
import { type Area, type Box, type BoxedSize, COMPACT, type Edges, type VisualizerSize, dragBox, placeBox } from "./placement";
import { PlayPanel } from "./play-panel";
import { TapSync, type Tapper } from "./sync";
import { AUTO_SWITCHES, CUT_BEATS, QUALITIES, useVisualizerPrefs } from "./prefs";
import { type Switch, type SwitchReason, switchFor } from "./switches";

/** Seconds the controls stay after the pointer stops. */
const IDLE_MS = 2600;
/** Seconds the song's card shows when a song starts. */
const CARD_MS = 5000;
/** Listening this long, a new song starts a new session (what's kept grows about 50 kB a second). */
const SESSION_SECONDS = 600;

/** The first downbeat at or after `after` within `within` seconds (else `after`): switches land on the bar. */
function onTheBar(rhythm: MusicAnalysis | null | undefined, after: number, within = 3): number {
  const next = rhythm?.downbeats.find((t) => t >= after);
  return next !== undefined && next - after <= within ? next : after;
}

/** Seconds a beat lasts (half a second without one). */
const beatSeconds = (rhythm: MusicAnalysis | null | undefined) => (rhythm?.bpm ? 60 / rhythm.bpm : 0.5);
/** Seconds a bar lasts. */
const barSeconds = (rhythm: MusicAnalysis | null | undefined) => 4 * beatSeconds(rhythm);

const logger = log("now-playing");
/** Choices the mood readout (I) shows. */
const CHOICES_KEPT = 5;
/** What a switch goes by when nothing's heard yet. */
const UNHEARD = { intensity: 0.5, character: null, sure: 0, slow: 0 } as const;
/** The frame keys' steps: turning (degrees a second) and zoom. */
const SPINS = [-45, -20, -6, 0, 6, 20, 45];
const ZOOMS = [0.5, 0.65, 0.8, 1, 1.25];
/** The next step along `steps` from `value` (`by` one up or down), kept at the ends. */
const stepAlong = (steps: readonly number[], value: number, by: 1 | -1) => {
  const i = steps.reduce((best, v, k) => (Math.abs(v - value) < Math.abs(steps[best] - value) ? k : best), 0);
  return steps[Math.max(0, Math.min(steps.length - 1, i + by))];
};

/** The first downbeat at or after `after`: the last one heard, carried on a bar at a time (null: none known yet). */
function nextDownbeat(rhythm: MusicAnalysis | null | undefined, after: number): number | null {
  const last = rhythm?.downbeats.findLast((t) => t <= after);
  if (last === undefined || !rhythm?.bpm) return rhythm?.downbeats.find((t) => t >= after) ?? null;
  const bar = (4 * 60) / rhythm.bpm;
  return last + Math.ceil((after - last) / bar - 1e-6) * bar;
}

/** The first beat at or after `after`: the last one heard, carried on at the tempo (else `after`). */
function onTheBeat(rhythm: MusicAnalysis | null | undefined, after: number): number {
  const last = rhythm?.beats.findLast((t) => t <= after);
  if (last === undefined || !rhythm?.bpm) return after;
  const beat = 60 / rhythm.bpm;
  return last + Math.ceil((after - last) / beat - 1e-6) * beat;
}

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
  // Which look plays, following the music (`chooser.ts`), and its last choices (the readout's).
  const [chooser] = useState(() => new LookChooser(LIVE_LOOKS));
  // The effects over the looks, played by the music (`effects-engine.ts`) unless by hand.
  const [effectsEngine] = useState(() => new EffectsEngine());
  const choices = useRef<{ time: number; why: string }[]>([]);
  const variationRef = useRef(0);
  // The look shown's song, id and variation, and how many times it's been mutated (`-`).
  const shownKey = useRef("");
  const mutation = useRef({ key: "", n: 0 });
  const historyRef = useRef<string[]>([]);
  // The looks in slow motion (a slow song's): what's shown moves half as fast, its hits swell.
  const slowMotion = useRef(false);

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
  // MilkDrop's looks: Butterchurn's canvas, a live picture the engine takes each frame.
  const milkdrop = useRef<MilkDrop | null>(null);
  const lastTick = useRef(0);
  useEffect(() => {
    const drop = new MilkDrop();
    milkdrop.current = drop;
    source.pictures = (assetId) => (assetId === MILKDROP_ASSET ? drop.canvas : null);
    imageBox.current?.append(drop.canvas);
    // Loaded once the visualizer's going (a couple of MB), so a MilkDrop look is ready when one's picked.
    const later = setTimeout(() => void drop.prepare(), 1500);
    return () => {
      clearTimeout(later);
      drop.dispose();
      drop.canvas.remove();
      if (milkdrop.current === drop) milkdrop.current = null;
      source.pictures = () => null;
    };
  }, [source]);
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

  /**
   * Show a look, switching as the music says for why it's changing (`switchFor`: a cut at `time`, a blend with a
   * feedback morph, a punch or a glitch landing on the next downbeat, a key's quick one), or as `switching` says.
   */
  const show = (lookId: string, reason: SwitchReason, time = source.now, switching?: Partial<Switch>) => {
    const look = liveLook(lookId) ?? LIVE_LOOKS[0];
    const { status: s, palette: p, prefs: pr } = latest.current;
    const key = `${s?.track?.id ?? "nothing"}:${look.id}:${variationRef.current}`;
    const random = seededRandom(key);
    const signals = useNowPlaying.getState().live?.signals;
    const rhythm = signals?.data().header.rhythm;
    const before = liveLook(director.look ?? "") ?? null;
    const plan: Switch = { ...switchFor(reason, signals?.mood ?? UNHEARD, before, look, beatSeconds(rhythm), random), ...switching };
    const at = plan.type === null ? time : plan.lands === "now" ? time + plan.seconds / 2 + 0.03 : onTheBar(rhythm, time + plan.seconds / 2 + 0.1);
    const mutations = mutation.current.key === key ? mutation.current.n : 0;
    shownKey.current = key;
    const pace = slowMotion.current ? SLOW_MOTION : 1;
    director.show(look, { palette: p, random, mutations, pace }, at, plan.type === null ? null : switchTransition(plan.type, plan.seconds));
    if (plan.morph) director.morph(at, plan.seconds);
    chooser.shown(look.id, at, barSeconds(rhythm));
    songRef.current = s?.track?.id ?? null;
    shownPalette.current = p;
    historyRef.current = [...historyRef.current.filter((id) => id !== look.id), look.id].slice(-6);
    if (pr.look !== look.id) useVisualizerPrefs.getState().setLook(look.id);
    const beats = AUTO_SWITCHES.find((a) => a.id === pr.auto)?.beats;
    dueRef.current = beats ? at + beats * beatSeconds(rhythm) : null;
  };

  /** vaudio's =: a roll of another chaos recipe (or `lookId`'s), kicked in with a flash. */
  const chaos = (lookId?: string) => {
    const current = director.look ?? prefs.look;
    const pool = LIVE_LOOKS.filter((l) => l.kind === "chaos" && l.id !== current);
    variationRef.current++;
    director.hit("flash", source.now + 0.01, 0.45);
    director.hit("zoom", source.now + 0.01, 0.35);
    show(lookId ?? pool[Math.floor(Math.random() * pool.length)].id, "chaos");
  };

  /** Whether the song is a slow one (its looks flow into each other). */
  const slowSong = () => {
    const mood = useNowPlaying.getState().live?.signals.mood;
    return !!mood && isSlow(mood);
  };

  /** vaudio's -: the chaos shown, its world nudged, blended in (slowly, on a slow song); another way of any other look. */
  const mutate = () => {
    const current = director.look ?? prefs.look;
    variationRef.current += liveLook(current)?.kind === "chaos" ? 0 : 1;
    if (liveLook(current)?.kind === "chaos") {
      mutation.current = { key: shownKey.current, n: (mutation.current.key === shownKey.current ? mutation.current.n : 0) + 1 };
    }
    show(current, "key", source.now, { type: "additive-dissolve", seconds: slowSong() ? 2.5 : 0.8 });
  };

  /** The engine's effects for this moment, if it plays them (not by hand): landing on their beats, eased. */
  const playEffects = (time: number, now: Moment) => {
    const mode = latest.current.prefs.effects;
    if (mode === "hand") return;
    const rhythm = useNowPlaying.getState().live?.signals.data().header.rhythm;
    const beat = beatSeconds(rhythm);
    const change = effectsEngine.step(
      { time, mood: now.mood, beat, nextBeat: onTheBeat(rhythm, time + 0.02), nextBar: nextDownbeat(rhythm, time + 0.02), drop: now.drop, look: liveLook(director.look ?? "") ?? null },
      mode,
    );
    if (!change) return;
    director.setFrame(change.effects.frame, change.at, Math.max(0.01, change.seconds), change.upright);
    director.setFx(change.effects.fx, change.at, change.seconds);
    choices.current = [...choices.current, { time, why: change.why }].slice(-CHOICES_KEPT);
    if (change.often) logger.debug(change.why);
    else logger.info(change.why);
  };

  /**
   * Played by hand from here (a slider, an effect key, the frame keys): the engine's effects become the panel's, as
   * they are, and it stops.
   */
  const takeOver = () => {
    const prefs = useVisualizerPrefs.getState();
    if (prefs.effects === "hand") return;
    prefs.setFx(director.fxNow(source.now));
    prefs.setEffects("hand");
    logger.info("effects by hand");
  };

  /** The frame now, for the panel (it changes outside React). */
  const frameNow = useCallback(() => director.frame, [director]);
  const fxNow = useCallback(() => director.fxNow(source.now), [director, source]);

  /** Reframe the picture over a beat (the frame keys, the panel, the assistant): by hand from then on. */
  const reframe = (frame: Frame, upright = false) => {
    takeOver();
    const rhythm = useNowPlaying.getState().live?.signals.data().header.rhythm;
    director.setFrame(frame, source.now, Math.max(0.25, beatSeconds(rhythm)), upright);
  };

  /** What the chooser goes by now. */
  const moment = (time: number): Moment | null => {
    const signals = useNowPlaying.getState().live?.signals;
    if (!signals) return null;
    const rhythm = signals.data().header.rhythm;
    return { time, mood: signals.mood, bar: barSeconds(rhythm), drop: rhythm?.drops.at(-1)?.time };
  };

  /** A choice of the chooser's, made: said (the log, the readout), then shown, mutated or varied. */
  const apply = (choice: Choice, time: number, often = false) => {
    choices.current = [...choices.current, { time, why: choice.why }].slice(-CHOICES_KEPT);
    // Switching every beat or bar, a line each would flood the log.
    if (often) logger.debug(choice.why);
    else logger.info(choice.why);
    if (choice.how === "mutate") return mutate();
    variationRef.current++;
    if (choice.how === "vary") return show(choice.look, choice.reason, time, { type: "additive-dissolve", seconds: slowSong() ? 2.5 : 1.2, morph: false, lands: "bar" });
    if (choice.how === "cut") {
      // On the drop's kick: cut there, with a flash. How late it's drawn is logged (step 6's pass: within a frame).
      const at = choice.at ?? time;
      director.hit("flash", at, 0.6);
      show(choice.look, choice.reason, at, { type: null });
      logger.info(`cut on the drop ${Math.round(Math.max(0, time - at) * 1000)} ms after its kick (a frame is ${Math.round(1000 / 60)} ms)`);
      return;
    }
    show(choice.look, choice.reason, time);
  };

  /** A look not shown lately (of `kind`, if given). */
  const another = (kind?: LookKind) => {
    const pool = LIVE_LOOKS.filter((l) => (!kind || l.kind === kind) && !historyRef.current.includes(l.id));
    const from = pool.length ? pool : LIVE_LOOKS;
    return from[Math.floor(Math.random() * from.length)].id;
  };

  /** Each frame, before it's drawn: what's decided (`decide`), then MilkDrop's frame, if one of its looks is on screen. */
  function tick(time: number) {
    decide(time);
    const seconds = Math.min(0.1, Math.max(0.001, time - lastTick.current));
    lastTick.current = time;
    milkdrop.current?.draw(time, seconds, director.shownAt(time), useNowPlaying.getState().live?.signals ?? null, slowMotion.current ? SLOW_MOTION : 1);
  }

  /** Start, follow sessions, change looks when it's time. */
  function decide(time: number) {
    const live = useNowPlaying.getState().live;
    if (!live) return;
    if (sessionRef.current !== live.session) {
      // A new session (listening started, or started again): its time starts at 0.
      const first = sessionRef.current === null;
      sessionRef.current = live.session;
      director.reset();
      if (!first) source.restart();
      show(latest.current.prefs.look, "key", first ? time : 0, { type: null });
      return;
    }
    director.prune(time);
    images.current?.sync(engine, director.project);
    const beats = AUTO_SWITCHES.find((a) => a.id === latest.current.prefs.auto)?.beats ?? Infinity;
    // Every few beats a look cuts in on the beat (a little ahead, so it's ready); less often, through a transition
    // landing on the bar.
    const cuts = beats <= CUT_BEATS;
    const now = moment(time);
    if (!now) return;
    // A song turning slow (or not any more): the look shown again in slow motion (or out of it), melting into itself.
    // (One that doesn't flow is about to go anyway, for one that does.)
    const slowNow = slowMotionOn(now.mood, slowMotion.current);
    if (slowNow !== slowMotion.current) {
      slowMotion.current = slowNow;
      logger.info(`${slowNow ? "slow motion" : "out of slow motion"} (slow ${now.mood.slow.toFixed(2)})`);
      const shown = liveLook(director.look ?? "");
      if (shown && (shown.suits.flows || !slowNow)) show(shown.id, "fit", time, { type: "film-dissolve", seconds: 3, morph: true, lands: "bar" });
    }
    playEffects(time, now);
    if (dueRef.current !== null && time >= dueRef.current - (cuts ? 0.12 : 0.6)) {
      // Every so many bars: a look that suits the music, on time.
      const due = dueRef.current;
      dueRef.current = null;
      const label = AUTO_SWITCHES.find((a) => a.id === latest.current.prefs.auto)?.label.toLowerCase() ?? "on time";
      const choice = chooser.pick(now, label);
      const rhythm = live.signals.data().header.rhythm;
      if (cuts) {
        // On the beat: no time for a transition.
        choices.current = [...choices.current, { time, why: choice.why }].slice(-CHOICES_KEPT);
        logger.debug(choice.why);
        variationRef.current++;
        show(choice.look, "schedule", Math.max(time, onTheBeat(rhythm, due - beatSeconds(rhythm) / 2)), { type: null });
      } else apply(choice, time, beats <= 16);
      return;
    }
    // Following the music: songs, drops, breakdowns, phrases.
    if (latest.current.prefs.auto === "song") {
      const choice = chooser.follow(now);
      if (choice) apply(choice, time);
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
    const now = moment(source.now);
    // A new song, following the music: something minimal until it's known what kind of song it is.
    if (newSong && prefs.auto !== "off" && now) apply(chooser.song(now), source.now);
    else show(director.look ?? prefs.look, "key");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [palette]);

  // The player's distortions and feedback by hand, over every look; or the engine's, carrying on from them.
  const fx = prefs.fx;
  const effectsMode = prefs.effects;
  useEffect(() => {
    if (effectsMode === "hand") director.setFx(fx, source.now, 0.15);
    else effectsEngine.from({ frame: director.frame, fx: director.fx }, source.now);
  }, [director, source, effectsEngine, fx, effectsMode]);

  // A look asked for from outside (the assistant), or chaos rolled or mutated.
  const requested = prefs.requested;
  useEffect(() => {
    if (!requested || !sessionRef.current) return;
    if (requested.roll === "chaos") chaos(requested.look);
    else if (requested.roll === "mutate") mutate();
    else if (requested.frame) reframe(requested.frame === "reset" ? PLAIN_FRAME : { ...director.frame, ...requested.frame }, requested.frame === "reset");
    else show(requested.look, "key");
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

  // Where it is (`placement.ts`): filling the app, a window over it, the mini player, or out in its own window.
  const place = prefs.place;
  const viewport = useViewport();
  const stage = useStage(place.out);
  useEffect(() => source.drawIn(stage?.win ?? window), [source, stage]);
  const track = status?.track;
  useEffect(() => {
    if (stage) stage.win.document.title = track ? `${track.name} · ${track.artist}` : "Now Playing";
  }, [stage, track?.name, track?.artist]); // eslint-disable-line react-hooks/exhaustive-deps
  const boxed = !place.out && place.size !== "full";
  const boxedSize = place.size as BoxedSize;
  // A box being moved or resized (kept once it's let go).
  const [dragging, setDragging] = useState<Box | null>(null);
  const at = boxed ? (dragging ?? placeBox(boxedSize, place.boxes[boxedSize], viewport)) : null;

  // Its element, in whichever window it's in. The canvas covers it at 16:9 (a 16:10 screen loses a sliver top and
  // bottom).
  const [root, setRoot] = useState<HTMLDivElement | null>(null);
  const [area, setArea] = useState({ width: window.innerWidth, height: window.innerHeight });
  useLayoutEffect(() => {
    if (!root) return;
    // (The window's own observer: another's doesn't look while that one isn't drawn.)
    const Observer = (ownerWindow(root) as unknown as typeof globalThis).ResizeObserver;
    const observer = new Observer(([entry]) => setArea({ width: entry.contentRect.width, height: entry.contentRect.height }));
    observer.observe(root);
    return () => observer.disconnect();
  }, [root]);
  const scale = Math.max(area.width / 16, area.height / 9);
  const size = { width: Math.round(16 * scale), height: Math.round(9 * scale) };
  useLayoutEffect(() => engine.setCanvasSize(size), [engine, size.width, size.height]); // eslint-disable-line react-hooks/exhaustive-deps

  // The controls come with the pointer and go when it rests.
  const [hudShown, setHudShown] = useState(true);
  const [hudHidden, setHudHidden] = useState(false);
  const [help, setHelp] = useState(false);
  const [moodShown, setMoodShown] = useState(false);
  // Every setting the player plays (D).
  const [panel, setPanel] = useState(false);
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

  // Full screen: the screen its window is on (its own window's, out of the app).
  const doc = () => root?.ownerDocument ?? document;
  const [fullscreen, setFullscreen] = useState(!!document.fullscreenElement);
  useEffect(() => {
    if (!root) return;
    const d = root.ownerDocument;
    const on = () => setFullscreen(!!d.fullscreenElement);
    on();
    d.addEventListener("fullscreenchange", on);
    return () => d.removeEventListener("fullscreenchange", on);
  }, [root]);
  const toggleFullscreen = () => {
    if (doc().fullscreenElement) void doc().exitFullscreen();
    else void root?.requestFullscreen().catch(() => {});
  };
  const close = () => {
    if (doc().fullscreenElement) void doc().exitFullscreen();
    useNowPlaying.getState().closeVisualizer();
  };

  // In a box over the app, its keys are its own once it's been clicked, until something else is (the app's are the
  // app's). It's just been opened, so it starts with them.
  const [engaged, setEngaged] = useState(true);
  const engagedRef = useRef(engaged);
  engagedRef.current = engaged;
  useEffect(() => {
    if (!boxed || !root) return;
    return addWindowListener("pointerdown", (e) => setEngaged(root.contains(e.target as Node)), true);
  }, [boxed, root]);

  /** To a size in the app (from its own window too). */
  const resize = (size: VisualizerSize) => {
    if (doc().fullscreenElement) void doc().exitFullscreen();
    useVisualizerPrefs.getState().setSize(size);
    setEngaged(true);
    wake();
  };
  /** Out into its own window, or back into the app. */
  const popOut = (out: boolean) => {
    if (doc().fullscreenElement) void doc().exitFullscreen();
    useVisualizerPrefs.getState().setOut(out);
    setEngaged(true);
  };
  /** The size it was before (double-click and P go back to it). */
  const before = () => (place.before !== place.size ? place.before : place.size === "full" ? "window" : "full");
  const toggleMini = () => (place.out || place.size !== "mini" ? resize("mini") : resize(before()));

  /** Move the box (from anywhere but its controls), or resize it by its edges. */
  const drag = (e: React.PointerEvent, edges: Edges | null) => {
    if (!at || (!edges && isControl(e.target))) return;
    const start = at;
    const size = boxedSize;
    const from = { x: e.clientX, y: e.clientY };
    let now = start;
    startPointerDrag(e, {
      threshold: edges ? 0 : 4,
      cursor: edges ? HANDLES.find((h) => h.edges === edges)?.cursor : "grabbing",
      onMove: (ev) => {
        now = dragBox(start, edges, ev.clientX - from.x, ev.clientY - from.y, viewport);
        setDragging(now);
      },
      onEnd: () => {
        useVisualizerPrefs.getState().setBox(size, now);
        setDragging(null);
      },
      onCancel: () => setDragging(null),
    });
  };
  const onDoubleClick = (e: React.MouseEvent) => {
    if (isControl(e.target)) return;
    if (place.out) toggleFullscreen();
    else resize(place.size === "full" ? before() : "full");
  };

  /** A look of `kind` at random, not the one shown (the looks menu's Shuffle of a kind). */
  const shuffle = (kind: LookKind) => {
    const pool = LIVE_LOOKS.filter((l) => l.kind === kind && l.id !== director.look);
    if (!pool.length) return;
    variationRef.current++;
    show(pool[Math.floor(Math.random() * pool.length)].id, "key");
  };
  /** A look at random, of any kind, not shown lately (R, the shuffle button, the looks menu's Shuffle). */
  const shuffleAny = () => {
    variationRef.current++;
    show(another(), "key");
  };
  // The arrows step through the looks but a kind of many's (MilkDrop's).
  const stepped = LIVE_LOOKS.filter((l) => !ofMany(l));
  const step = (by: 1 | -1) => {
    const i = stepped.findIndex((l) => l.id === (director.look ?? prefs.look));
    show(stepped[(i + by + stepped.length) % stepped.length].id, "key");
  };
  const stepGroup = (by: 1 | -1) => {
    const current = liveLook(director.look ?? prefs.look)?.kind ?? "world";
    const k = LOOK_KINDS.findIndex((g) => g.id === current);
    const kind = LOOK_KINDS[(k + by + LOOK_KINDS.length) % LOOK_KINDS.length];
    if (kind.many) shuffle(kind.id);
    else show(LIVE_LOOKS.find((l) => l.kind === kind.id)!.id, "key");
  };

  // The keys: the visualizer has them all while it fills the app (the editor's under it don't hear them), in a box
  // over it once it's been clicked, and out of the app, in its own window.
  useEffect(() => {
    const win = root ? ownerWindow(root) : window;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey) return;
      if (boxed && !engagedRef.current) return;
      e.stopImmediatePropagation();
      // The controls' own lists and sliders keep their keys.
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "SELECT" && e.key !== "Escape") return;
      if (tag === "INPUT" && /^(Arrow|Home|End|Page)/.test(e.key)) return;
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
          return doc().fullscreenElement ? void doc().exitFullscreen() : close();
        case "fullscreen":
          return toggleFullscreen();
        case "mini":
          return toggleMini();
        case "out":
          return popOut(!place.out);
        case "look":
          return step(action.step);
        case "group":
          return stepGroup(action.step);
        case "random":
          return shuffleAny();
        case "vary":
          variationRef.current++;
          return show(director.look ?? prefs.look, "key");
        case "chaos":
          return chaos();
        case "frame": {
          const f = director.frame;
          const next: Frame =
            action.change === "repeat"
              ? { ...f, repeat: ((f.repeat % 4) + 1) as Frame["repeat"] }
              : action.change === "mirror"
                ? { ...f, mirror: !f.mirror }
                : action.change === "spin-left" || action.change === "spin-right"
                  ? { ...f, spin: stepAlong(SPINS, f.spin, action.change === "spin-left" ? 1 : -1) }
                  : action.change === "zoom-out" || action.change === "zoom-in"
                    ? { ...f, zoom: stepAlong(ZOOMS, f.zoom, action.change === "zoom-in" ? 1 : -1) }
                    : PLAIN_FRAME;
          // Backspace is vaudio's wash: the distortions and feedback go too.
          const washing = action.change === "reset";
          reframe(next, washing);
          if (washing) useVisualizerPrefs.getState().setFx("wash");
          return;
        }
        case "fx": {
          takeOver();
          const now = useVisualizerPrefs.getState().fx;
          return useVisualizerPrefs.getState().setFx({ [action.key]: now[action.key] + action.by });
        }
        case "panel":
          return setPanel((p) => !p);
        case "mutate":
          return mutate();
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
        case "mood":
          return setMoodShown((m) => !m);
        case "sync":
          return setSyncing(true);
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (!e.metaKey && !e.ctrlKey && !(boxed && !engagedRef.current)) e.stopImmediatePropagation();
    };
    win.addEventListener("keydown", onKey, { capture: true });
    win.addEventListener("keyup", onKeyUp, { capture: true });
    return () => {
      win.removeEventListener("keydown", onKey, { capture: true });
      win.removeEventListener("keyup", onKeyUp, { capture: true });
    };
  });

  const showing = useCurrentLook(director, prefs.look);
  const controls = hudShown && !hudHidden;
  // Small (the mini player, a small window): only its few controls.
  const compact = area.width < COMPACT.width || area.height < COMPACT.height;

  const placeButtons = place.out ? (
    <>
      {stage?.pin && (
        <HudButton
          label={place.pinned ? "Stop keeping it on top" : "Keep it on top of other windows"}
          active={place.pinned}
          onClick={() => {
            stage.pin!(!place.pinned);
            useVisualizerPrefs.getState().setPinned(!place.pinned);
          }}
        >
          {place.pinned ? <PiPushPinFill /> : <PiPushPin />}
        </HudButton>
      )}
      <HudButton label="Back into the app (O)" onClick={() => popOut(false)}>
        <PiArrowSquareIn />
      </HudButton>
    </>
  ) : (
    <>
      {place.size !== "mini" && (
        <HudButton label="Mini player (P)" onClick={() => resize("mini")}>
          <PiPictureInPicture />
        </HudButton>
      )}
      {place.size === "full" ? (
        <HudButton label="A window over the app" onClick={() => resize("window")}>
          <PiCornersIn />
        </HudButton>
      ) : (
        <HudButton label="Fill the app" onClick={() => resize("full")}>
          <PiCornersOut />
        </HudButton>
      )}
      <HudButton label="Its own window (O)" onClick={() => popOut(true)}>
        <PiArrowSquareOut />
      </HudButton>
    </>
  );
  const fullscreenButton = (
    <HudButton label={fullscreen ? "Leave full screen (F)" : "Full screen (F)"} onClick={toggleFullscreen}>
      {fullscreen ? <PiArrowsInSimple /> : <PiArrowsOutSimple />}
    </HudButton>
  );
  const closeButton = (
    <HudButton label="Close (Esc)" onClick={close}>
      <PiX />
    </HudButton>
  );

  const content = (
    <div
      ref={setRoot}
      data-now-playing-view={place.out ? "out" : place.size}
      data-showing={showing}
      data-engaged={boxed ? engaged : undefined}
      className={cn(
        "fixed z-[70] overflow-hidden bg-black text-white select-none",
        at ? "rounded-lg shadow-2xl ring-1 shadow-black/60" : "inset-0",
        at && (engaged ? "ring-white/35" : "ring-white/15"),
        !controls && "cursor-none",
      )}
      style={at ? { left: at.x, top: at.y, width: at.width, height: at.height } : undefined}
      onPointerMove={wake}
      onPointerDown={(e) => {
        wake();
        drag(e, null);
      }}
      onDoubleClick={onDoubleClick}
    >
      <canvas
        ref={attachCanvas}
        data-slot="visualizer-canvas"
        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2"
        style={size}
      />

      <SongCard visible={controls} compact={compact} />

      {listening !== "on" && <ListenPrompt compact={compact} />}
      {!compact && !hudHidden && <VibeOffer />}
      {noWebGl && <p className="absolute inset-x-0 top-1/2 text-center text-sm text-white/70">This browser can't draw the visualizer: it needs WebGL 2.</p>}

      {compact ? (
        <div className={cn("pointer-events-none absolute inset-0 transition-opacity duration-300", controls ? "opacity-100" : "opacity-0")}>
          <div className="pointer-events-auto absolute top-1.5 right-1.5 flex items-center">
            {placeButtons}
            {fullscreenButton}
            {closeButton}
          </div>
          <div className="pointer-events-auto absolute inset-x-0 bottom-0 flex justify-center bg-linear-to-t from-black/75 to-transparent pt-10 pb-2.5">
            <Transport compact />
          </div>
        </div>
      ) : (
        <div className={cn("pointer-events-none absolute inset-0 transition-opacity duration-500", controls ? "opacity-100" : "opacity-0")}>
          <div className="pointer-events-auto absolute top-4 right-4 flex items-center gap-1">
            <LooksMenu current={showing} onPick={(id) => show(id, "key")} onShuffle={shuffle} onShuffleAny={shuffleAny} />
            <Hearing />
            <HudButton label="Tap along to sync (S)" onClick={() => setSyncing(true)} active={syncing}>
              <PiMetronome />
            </HudButton>
            <HudButton label="Distort, feedback and frame (D)" onClick={() => setPanel((p) => !p)} active={panel}>
              <PiSlidersHorizontal />
            </HudButton>
            <HudButton label="Keys" onClick={() => setHelp((h) => !h)} active={help}>
              <PiKeyboard />
            </HudButton>
            <span aria-hidden className="mx-1 h-5 w-px bg-white/20" />
            {placeButtons}
            {fullscreenButton}
            {closeButton}
          </div>

          <div className="pointer-events-auto absolute inset-x-0 bottom-0 bg-linear-to-t from-black/80 via-black/45 to-transparent px-6 pt-12 pb-5">
            <div className="flex items-center gap-4">
              <Transport />
              <div className="ml-auto flex items-center gap-2">
                <HudButton label="A look at random (R)" onClick={shuffleAny}>
                  <PiShuffle />
                </HudButton>
                <HudSelect label="Change looks" value={prefs.auto} options={AUTO_SWITCHES} onChange={(id) => useVisualizerPrefs.getState().setAuto(id)} />
                <HudSelect label="Effects" value={prefs.effects} options={EFFECTS_MODES} onChange={(id) => useVisualizerPrefs.getState().setEffects(id)} />
                <HudSelect label="Quality" value={prefs.quality} options={QUALITIES} onChange={(id) => useVisualizerPrefs.getState().setQuality(id)} />
              </div>
            </div>
          </div>
        </div>
      )}

      {panel && !hudHidden && !compact && (
        <PlayPanel
          frame={frameNow}
          fx={fxNow}
          onFrame={(f) => reframe(f)}
          onFx={(change) => {
            takeOver();
            useVisualizerPrefs.getState().setFx(change);
          }}
          onWash={() => {
            reframe(PLAIN_FRAME, true);
            useVisualizerPrefs.getState().setFx("wash");
          }}
        />
      )}
      {help && !compact && <KeysHelp onClose={() => setHelp(false)} />}
      {moodShown && !compact && <MoodReadout now={() => source.now} choices={() => choices.current} />}
      {syncing && <TapSync source={source} tapper={tapper} onDone={stopSyncing} />}

      {at &&
        HANDLES.map((h) => (
          <div
            key={`${h.edges.x},${h.edges.y}`}
            data-resize={`${h.edges.x},${h.edges.y}`}
            aria-hidden
            className={cn("absolute z-20", h.className)}
            style={{ cursor: h.cursor }}
            onPointerDown={(e) => {
              e.stopPropagation();
              drag(e, h.edges);
            }}
          />
        ))}
    </div>
  );

  return (
    <>
      {/* The pictures the looks show: in the app's page wherever the visualizer is. */}
      <div ref={imageBox} aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden opacity-0" />
      {place.out ? stage && createPortal(content, stage.container) : content}
    </>
  );
}

/** Its edges and corners, to resize it by when it's a box over the app. */
const HANDLES: { edges: Edges; className: string; cursor: string }[] = [
  { edges: { x: -1, y: 0 }, className: "inset-y-3 left-0 w-1.5", cursor: "ew-resize" },
  { edges: { x: 1, y: 0 }, className: "inset-y-3 right-0 w-1.5", cursor: "ew-resize" },
  { edges: { x: 0, y: -1 }, className: "inset-x-3 top-0 h-1.5", cursor: "ns-resize" },
  { edges: { x: 0, y: 1 }, className: "inset-x-3 bottom-0 h-1.5", cursor: "ns-resize" },
  { edges: { x: -1, y: -1 }, className: "top-0 left-0 size-3", cursor: "nwse-resize" },
  { edges: { x: 1, y: 1 }, className: "right-0 bottom-0 size-3", cursor: "nwse-resize" },
  { edges: { x: 1, y: -1 }, className: "top-0 right-0 size-3", cursor: "nesw-resize" },
  { edges: { x: -1, y: 1 }, className: "bottom-0 left-0 size-3", cursor: "nesw-resize" },
];

/** What's pressed is one of its controls (which a press doesn't move it by). */
const isControl = (target: EventTarget | null) =>
  isElement(target) && target.closest("button, input, select, label, a, [data-play-panel], [data-looks-menu], [data-resize]") !== null;

/** The app's window's size (CSS px), as it changes. */
function useViewport(): Area {
  const [area, setArea] = useState(() => ({ width: window.innerWidth, height: window.innerHeight }));
  useEffect(() => {
    const on = () => setArea({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  return area;
}

/**
 * Its own window while it's out of the app (`openStageWindow`), once that has the page's styles; null in the app.
 * Refused (a browser's blocker), it stays in the app. Closing the window closes the visualizer: it opens out again
 * next time.
 */
function useStage(out: boolean): StageWindow | null {
  const [stage, setStage] = useState<StageWindow | null>(null);
  // Held across React running an effect twice in development (StrictMode), so one window opens, not two.
  const held = useRef<{ stage: StageWindow; closing: ReturnType<typeof setTimeout> | null } | null>(null);
  useEffect(() => {
    if (!out) return;
    let kept = held.current;
    if (kept?.closing) {
      clearTimeout(kept.closing);
      kept.closing = null;
    } else {
      const { place } = useVisualizerPrefs.getState();
      const track = useNowPlaying.getState().status?.track;
      const opened = openStageWindow(track ? `${track.name} · ${track.artist}` : "Now Playing", place.stage);
      if (!opened) {
        logger.warn("its own window was refused: it stays in the app");
        useVisualizerPrefs.getState().setOut(false);
        return;
      }
      if (place.pinned) opened.pin?.(true);
      opened.onGone = () => {
        useVisualizerPrefs.getState().setBox("stage", opened.bounds());
        held.current = null;
        setStage(null);
        useNowPlaying.getState().closeVisualizer();
      };
      kept = held.current = { stage: opened, closing: null };
      logger.info("in its own window");
    }
    const holding = kept;
    let current = true;
    void holding.stage.ready.then(() => current && setStage(holding.stage));
    return () => {
      current = false;
      holding.closing = setTimeout(() => {
        useVisualizerPrefs.getState().setBox("stage", holding.stage.bounds());
        holding.stage.close();
        if (held.current === holding) held.current = null;
        setStage(null);
      });
    };
  }, [out]);
  return out ? stage : null;
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
function SongCard({ visible, compact }: { visible: boolean; compact: boolean }) {
  const track = useNowPlaying((s) => s.status?.track ?? null);
  const [fresh, setFresh] = useState(true);
  useEffect(() => {
    setFresh(true);
    const t = setTimeout(() => setFresh(false), CARD_MS);
    return () => clearTimeout(t);
  }, [track?.id]);
  if (!track) return null;
  const big = fresh && !compact;
  return (
    <div
      data-song-card={big ? "big" : "small"}
      className={cn(
        "pointer-events-none absolute flex items-center transition-all duration-700",
        compact ? "top-2.5 left-3 gap-2.5" : "top-6 left-6 gap-4",
        fresh || visible ? "opacity-100" : "opacity-0",
      )}
    >
      {track.artwork && (
        <img
          src={track.artwork}
          alt=""
          className={cn("rounded-md object-cover shadow-2xl ring-1 shadow-black/60 ring-white/10 transition-all duration-700", big ? "size-28" : compact ? "size-9" : "size-14")}
          draggable={false}
        />
      )}
      <div className="min-w-0 drop-shadow-[0_2px_8px_rgb(0_0_0/0.8)]">
        <p className={cn("truncate font-semibold tracking-tight transition-all duration-700", big ? "max-w-[60vw] text-4xl" : compact ? "max-w-40 text-sm" : "max-w-[40vw] text-lg")}>{track.name}</p>
        <p className={cn("truncate text-white/75 transition-all duration-700", big ? "mt-1 text-lg" : compact ? "max-w-40 text-xs" : "text-sm")}>
          {track.artist}
          {track.album && big && <span className="text-white/50"> · {track.album}</span>}
        </p>
      </div>
    </div>
  );
}

/** Asks to listen (the computer's sound is shared once per opening), or says why it can't. */
function ListenPrompt({ compact }: { compact: boolean }) {
  const listening = useNowPlaying((s) => s.listening);
  const error = useNowPlaying((s) => s.listenError);
  return (
    <div className="absolute inset-0 grid place-items-center">
      <div
        className={cn(
          "flex max-w-sm flex-col items-center rounded-xl bg-black/60 text-center ring-1 ring-white/10 backdrop-blur-md",
          compact ? "mx-3 gap-2 px-4 py-3 [&_p]:text-xs" : "gap-3 px-7 py-6",
        )}
      >
        <PiWaveform className={compact ? "size-5 text-white/80" : "size-7 text-white/80"} />
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
    const win = ownerWindow(bars.current);
    const draw = () => {
      frame = win.requestAnimationFrame(draw);
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
    return () => win.cancelAnimationFrame(frame);
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

/**
 * The looks, as a menu up top (Théo's: the music picks them, this is for picking one yourself): the look playing on its
 * button; inside, Shuffle, then each kind opening its looks beside it (Shuffle of that kind first), the one playing
 * ticked. A shuffle keeps it open, for another.
 */
function LooksMenu({
  current,
  onPick,
  onShuffle,
  onShuffleAny,
}: {
  current: string;
  onPick: (id: string) => void;
  onShuffle: (kind: LookKind) => void;
  onShuffleAny: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<LookKind | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const close = () => {
    setOpen(false);
    setKind(null);
  };
  // A press anywhere else closes it (in the window it's in).
  useEffect(() => {
    if (!open) return;
    const win = ownerWindow(box.current);
    const away = (e: PointerEvent) => {
      if (box.current?.contains(e.target as Node)) return;
      setOpen(false);
      setKind(null);
    };
    win.addEventListener("pointerdown", away, true);
    return () => win.removeEventListener("pointerdown", away, true);
  }, [open]);
  const look = liveLook(current);
  const panel = "rounded-lg bg-black/85 p-1 ring-1 ring-white/10 backdrop-blur-md";
  const item = "flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[13px] text-white/85 hover:bg-white/10 [&_svg]:size-3.5 [&_svg]:shrink-0";
  const tick = (on: boolean) => <span className="grid size-3.5 shrink-0 place-items-center">{on && <PiCheck />}</span>;
  const label = LOOK_KINDS.find((g) => g.id === kind)?.label;
  return (
    <div ref={box} data-looks-menu className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Looks: ${look?.name ?? "none"}`}
        title="Looks"
        onClick={() => (open ? close() : setOpen(true))}
        className="flex h-8 max-w-48 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium text-white/85 hover:bg-white/10 [&_svg]:size-3 [&_svg]:shrink-0"
      >
        <span className="truncate">{look?.name ?? "Looks"}</span>
        <PiCaretDown />
      </button>
      {open && (
        <div role="menu" aria-label="Looks" className={cn("absolute top-9 right-0 z-30 w-48", panel)}>
          <button type="button" role="menuitem" data-shuffle="any" onClick={onShuffleAny} className={item}>
            <PiShuffle />
            Shuffle
          </button>
          <div className="my-1 h-px bg-white/10" />
          {LOOK_KINDS.map((g) => (
            <button
              key={g.id}
              type="button"
              role="menuitem"
              aria-haspopup="menu"
              aria-expanded={kind === g.id}
              data-kind={g.id}
              onPointerEnter={() => setKind(g.id)}
              onClick={() => setKind(g.id)}
              className={cn(item, kind === g.id && "bg-white/10")}
            >
              <PiCaretLeft />
              <span className="flex-1">{g.label}</span>
              {tick(look?.kind === g.id)}
            </button>
          ))}
          {kind && (
            <div role="menu" aria-label={label} className={cn("absolute top-0 right-full mr-1 max-h-[60vh] w-64 overflow-y-auto", panel)}>
              <button type="button" role="menuitem" data-shuffle={kind} onClick={() => onShuffle(kind)} className={item}>
                <PiShuffle />
                Shuffle {label}
              </button>
              <div className="my-1 h-px bg-white/10" />
              {LIVE_LOOKS.filter((l) => l.kind === kind).map((l) => (
                <button
                  key={l.id}
                  type="button"
                  role="menuitemradio"
                  aria-checked={l.id === current}
                  data-look={l.id}
                  onClick={() => {
                    onPick(l.id);
                    close();
                  }}
                  className={item}
                >
                  {tick(l.id === current)}
                  <span className="truncate">{l.name}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** The song's place, and play, pause and skip. */
function Transport({ compact = false }: { compact?: boolean }) {
  const status = useNowPlaying((s) => s.status);
  const now = useNow(500);
  const track = status?.track;
  if (!status || !track) return <div className="text-sm text-white/50">Nothing's playing</div>;
  const playing = status.state === "playing";
  const position = positionAt(status, now);
  const { command } = useNowPlaying.getState();
  if (compact) {
    return (
      <div className="flex items-center gap-2">
        <HudButton label="Previous song (⇧←)" onClick={() => void command({ action: "previous" })}>
          <PiSkipBackFill />
        </HudButton>
        <button
          type="button"
          aria-label={playing ? "Pause" : "Play"}
          title={playing ? "Pause (Space)" : "Play (Space)"}
          onClick={() => void command({ action: "toggle" })}
          className="grid size-8 shrink-0 place-items-center rounded-full bg-white text-black hover:bg-white/90 [&_svg]:size-3.5"
        >
          {playing ? <PiPauseFill /> : <PiPlayFill />}
        </button>
        <HudButton label="Next song (⇧→)" onClick={() => void command({ action: "next" })}>
          <PiSkipForwardFill />
        </HudButton>
      </div>
    );
  }
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
