import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  PiArrowLeft,
  PiArrowRight,
  PiArrowSquareIn,
  PiArrowSquareOut,
  PiArrowsInSimple,
  PiArrowsOutSimple,
  PiCaretDown,
  PiCaretLeft,
  PiCards,
  PiCheck,
  PiCornersIn,
  PiCornersOut,
  PiFilmStrip,
  PiHeart,
  PiHeartFill,
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
  PiTrash,
  PiTrashFill,
  PiWaveform,
  PiX,
} from "react-icons/pi";
import { type Frame, LIVE_LOOKS, LOOK_KINDS, type LookKind, PLAIN_FRAME, SLOW_MOTION, liveLook, ofMany, seededRandom, switchTransition } from "@shared/live-looks";
import { MILKDROP_ASSET, milkdropPreset } from "@shared/live-milkdrop";
import { MASTER, signalValue } from "@shared/audio-signals";
import type { LookVerdict, RatingVerdict } from "@shared/look-ratings";
import { positionAt } from "@shared/now-playing";
import { type Mood, type SongCharacter, isSlow } from "@shared/signals/mood";
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
import { type Choice, LookChooser, type Moment, pickWanted, slowMotionOn, slowedDown } from "./chooser";
import { EFFECTS_MODES, EffectsEngine } from "./effects-engine";
import { LiveDirector } from "./director";
import { type Feeding, MilkDrop } from "./milkdrop";
import { useVisualizerMedia } from "./media-library";
import { nextSet } from "./media-sets";
import { KickHit, mixFor, pickMedia } from "./media-mix";
import { MediaPanel, type MediaTab } from "./media-panel";
import { SCREEN_MEDIA, useVisualizerScreen } from "./screen";
import { desktopScreens } from "@/lib/desktop";
import { VISUALIZER_KEYS, visualizerKey } from "./keys";
import { useLookRatings } from "./look-ratings";
import { ImageSlots, LiveSource } from "./live-source";
import { MoodReadout } from "./mood-readout";
import { VibeOffer } from "./vibe-offer";
import { type Area, type Box, type BoxedSize, COMPACT, type Edges, type VisualizerSize, dragBox, placeBox } from "./placement";
import { PlayPanel } from "./play-panel";
import { RATE_SECONDS, RatingRound, SKIP_SECONDS } from "./rating";
import { TapSync, type Tapper } from "./sync";
import { AUTO_SWITCHES, CUT_BEATS, PACE, QUALITIES, SLOW_PACE, paceLabel, useVisualizerPrefs } from "./prefs";
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
/** Seconds the speed stays put before the looks are made at it (each change makes the look shown again). */
const PACE_SETTLES = 0.35;
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

/** What a rating says, for the log. */
const VERDICT_WORDS: Record<RatingVerdict, string> = { love: "loved", bin: "binned", clear: "took back the rating of", pass: "passed over", skip: "skipped" };
/** Seconds the note saying what was rated shows. */
const RATED_MS = 1800;
/** Why a look changes when the visualizer picks it itself (the music's reasons): left soon after, it's a skip. */
const PUT_UP: ReadonlySet<SwitchReason> = new Set(["drop", "breakdown", "song", "quiet", "fit", "phrase", "schedule"]);

/**
 * The user's taste as it is now (their ratings), for a look on a kind of song. While a screen's shared, only MilkDrop's
 * looks show it, so only they're picked (by the music, or shuffled: one asked for by name still shows).
 */
const appealNow = (look: string, character: SongCharacter | null) =>
  useVisualizerScreen.getState().shared && !milkdropPreset(look) ? 0 : useLookRatings.getState().taste.appeal(look, character);

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
  const [chooser] = useState(() => {
    const following = new LookChooser(LIVE_LOOKS);
    following.appeal = appealNow;
    return following;
  });
  // The effects over the looks, played by the music (`effects-engine.ts`) unless by hand.
  const [effectsEngine] = useState(() => new EffectsEngine());
  const choices = useRef<{ time: number; why: string }[]>([]);
  const variationRef = useRef(0);
  // The look shown's song, id and variation, and how many times it's been mutated (`-`).
  const shownKey = useRef("");
  const mutation = useRef({ key: "", n: 0 });
  const historyRef = useRef<string[]>([]);
  // The look shown, since when (ms), and whether the visualizer put it up itself (following the music, or at random):
  // one the user leaves within a few seconds is skipped (a small thumbs-down, `SKIP_SECONDS`).
  const shownSince = useRef<{ look: string; at: number; by: "music" | "random" | null }>({ look: "", at: 0, by: null });
  // The rating mode (⇧R): the looks one after another (`rating.ts`), the one showing and when it moves on.
  const round = useRef<RatingRound | null>(null);
  const [rating, setRatingState] = useState<{ look: string; until: number } | null>(null);
  const ratingRef = useRef(rating);
  const setRating = (next: { look: string; until: number } | null) => {
    ratingRef.current = next;
    setRatingState(next);
  };
  // The user's clip melting into the MilkDrop look shown (`media-feed.ts`), and those shown lately; a kick's hit.
  const feedingRef = useRef<{ look: string; feeding: Omit<Feeding, "hit"> } | null>(null);
  const recentMedia = useRef<string[]>([]);
  const [kick] = useState(() => new KickHit());
  // What was just rated, for the note saying so (`n` counts them, so the same one twice shows again).
  const [rated, setRated] = useState<{ look: string; verdict: RatingVerdict | "done"; character: SongCharacter | null; n: number } | null>(null);
  // The looks in slow motion (a slow song's, or the Speed slider's): what's shown moves that much as fast, its hits
  // swell. The speed the looks are made at, and the one wanted lately (made at once it's settled).
  const slowMotion = useRef(prefs.pace < 1);
  const paceShown = useRef(prefs.pace < 1 ? prefs.pace : 1);
  const paceWanted = useRef({ pace: paceShown.current, since: 0 });

  // What the tick (outside React) needs, as of the last render.
  const latest = useRef({ status, palette, prefs });
  latest.current = { status, palette, prefs };
  /** What's heard, as the looks go by it: a slow song's whatever plays, in slow motion by choice (`slowedDown`). */
  const asHeard = (mood: Mood) => (latest.current.prefs.pace < 1 ? slowedDown(mood) : mood);

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
    source.pictures = (assetId) => (assetId === MILKDROP_ASSET ? drop.picture : null);
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
  const show = (lookId: string, reason: SwitchReason, time = source.now, switching?: Partial<Switch>, by?: "music" | "random") => {
    const look = liveLook(lookId) ?? LIVE_LOOKS[0];
    const { status: s, palette: p, prefs: pr } = latest.current;
    const key = `${s?.track?.id ?? "nothing"}:${look.id}:${variationRef.current}`;
    const random = seededRandom(key);
    const signals = useNowPlaying.getState().live?.signals;
    const rhythm = signals?.data().header.rhythm;
    const before = liveLook(director.look ?? "") ?? null;
    const heard = signals ? asHeard(signals.mood) : { ...UNHEARD, slow: pr.pace < 1 ? 1 : 0 };
    const plan: Switch = { ...switchFor(reason, heard, before, look, beatSeconds(rhythm), random), ...switching };
    const at = plan.type === null ? time : plan.lands === "now" ? time + plan.seconds / 2 + 0.03 : onTheBar(rhythm, time + plan.seconds / 2 + 0.1);
    const mutations = mutation.current.key === key ? mutation.current.n : 0;
    shownKey.current = key;
    const pace = paceShown.current;
    director.show(look, { palette: p, random, mutations, pace }, at, plan.type === null ? null : switchTransition(plan.type, plan.seconds));
    if (plan.morph) director.morph(at, plan.seconds);
    chooser.shown(look.id, at, barSeconds(rhythm));
    songRef.current = s?.track?.id ?? null;
    shownPalette.current = p;
    historyRef.current = [...historyRef.current.filter((id) => id !== look.id), look.id].slice(-6);
    if (look.id !== shownSince.current.look) shownSince.current = { look: look.id, at: Date.now(), by: by ?? (PUT_UP.has(reason) ? "music" : null) };
    feedFor(look.id);
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
    show(lookId ?? pickWanted(pool, appealNow, characterNow(), Math.random)!.id, "chaos");
  };

  /** `lookId`, or one of MilkDrop's in its place while a screen's shared (only theirs show it). */
  const forScreen = (lookId: string) => {
    if (!useVisualizerScreen.getState().shared || milkdropPreset(lookId)) return lookId;
    return pickWanted(LIVE_LOOKS.filter((l) => milkdropPreset(l.id)), appealNow, characterNow(), Math.random)?.id ?? lookId;
  };

  /** The kind of song playing, as the looks hear it (null: not known yet, or nothing heard). */
  const characterNow = () => {
    const mood = useNowPlaying.getState().live?.signals.mood;
    return mood ? asHeard(mood).character : null;
  };

  /**
   * The user's clip for the MilkDrop look `lookId` (`again`: another, even for the same look): not one shown lately, from
   * a moment of it at random, going in as the moment says (`mixFor`). None for any other look, or with none, or off.
   */
  const feedFor = (lookId: string, again = false) => {
    // A screen shared goes into every MilkDrop look, in place of the clips.
    const screen = useVisualizerScreen.getState().shared;
    if (screen) {
      if (!milkdropPreset(lookId)) return;
      if (!again && feedingRef.current?.look === lookId && feedingRef.current.feeding.media.id === SCREEN_MEDIA) return;
      const mood = useNowPlaying.getState().live?.signals.mood;
      const mix = mixFor(mood ? asHeard(mood) : { intensity: 0.5, slow: latest.current.prefs.pace < 1 ? 1 : 0 }, Math.random, "screen");
      feedingRef.current = { look: lookId, feeding: { media: { id: SCREEN_MEDIA, kind: "stream", stream: screen.stream }, mix } };
      useVisualizerMedia.getState().setFeeding(null);
      logger.debug(`${screen.name} into ${liveLook(lookId)?.name ?? lookId}'s feedback (${mix.mode})`);
      return;
    }
    if (feedingRef.current?.feeding.media.id === SCREEN_MEDIA) feedingRef.current = null;
    const list = useVisualizerMedia.getState().media;
    if (!useVisualizerPrefs.getState().media || !list.length) {
      if (feedingRef.current) feedingRef.current = null;
      useVisualizerMedia.getState().setFeeding(null);
      return;
    }
    // Not a MilkDrop look: none for it (the clip of the one going stays while that's on screen: `tick`).
    if (!milkdropPreset(lookId)) return;
    if (!again && feedingRef.current?.look === lookId) return;
    const choices = list.map((m) => ({ id: m.asset.id, kind: m.asset.kind === "video" ? ("video" as const) : ("image" as const), duration: m.asset.duration }));
    // One just added comes first (from its start), else one not shown lately.
    const wanted = useVisualizerMedia.getState().wanted;
    if (wanted) useVisualizerMedia.getState().setWanted(null);
    const picked = wanted && choices.some((c) => c.id === wanted) ? { id: wanted, from: 0 } : pickMedia(choices, recentMedia.current, Math.random);
    const asset = list.find((m) => m.asset.id === picked?.id)?.asset;
    if (!picked || !asset) return;
    const mood = useNowPlaying.getState().live?.signals.mood;
    const mix = mixFor(mood ? asHeard(mood) : { intensity: 0.5, slow: latest.current.prefs.pace < 1 ? 1 : 0 }, Math.random);
    feedingRef.current = { look: lookId, feeding: { media: { id: asset.id, src: asset.src, kind: asset.kind === "video" ? "video" : "image", from: picked.from }, mix } };
    recentMedia.current = [...recentMedia.current.filter((id) => id !== asset.id), asset.id].slice(-4);
    useVisualizerMedia.getState().setFeeding(asset.id);
    logger.debug(`${asset.name} into ${liveLook(lookId)?.name ?? lookId}'s feedback (${mix.mode}, ${picked.from} s in)`);
  };

  /** Whether the song is a slow one, or taken as one (its looks flow into each other). */
  const slowSong = () => {
    const mood = useNowPlaying.getState().live?.signals.mood;
    return !!mood && isSlow(asHeard(mood));
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
    return { time, mood: asHeard(signals.mood), bar: barSeconds(rhythm), drop: rhythm?.drops.at(-1)?.time };
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

  /** A look not shown lately (of `kind`, if given), by the user's taste (never one they binned, loved ones more). */
  const another = (kind?: LookKind) => {
    const pool = LIVE_LOOKS.filter((l) => (!kind || l.kind === kind) && !historyRef.current.includes(l.id));
    return pickWanted(pool.length ? pool : LIVE_LOOKS, appealNow, characterNow(), Math.random)!.id;
  };

  /** A rating of `look`, with the moment it's given: how long it showed, the song, the kind of song and how intense. */
  const record = (look: string, verdict: RatingVerdict, inRound = false) => {
    const mood = useNowPlaying.getState().live?.signals.mood;
    const heard = mood ? asHeard(mood) : null;
    const track = latest.current.status?.track;
    const since = shownSince.current;
    useLookRatings.getState().rate({
      look,
      verdict,
      ...(inRound && { rating: true as const }),
      seconds: since.look === look ? (Date.now() - since.at) / 1000 : 0,
      song: track ? { id: track.id, name: track.name, artist: track.artist } : null,
      mood: heard ? { character: heard.character, intensity: heard.intensity, slow: heard.slow } : null,
    });
    const line = `${VERDICT_WORDS[verdict]} ${liveLook(look)?.name ?? look}${heard ? ` (${heard.character ?? "not sure yet"}, intensity ${heard.intensity.toFixed(2)})` : ""}`;
    if (verdict === "skip" || verdict === "pass") logger.debug(line);
    else logger.info(line);
  };

  /** The user's moving off the look shown: one the visualizer put up, left within a few seconds, is skipped. */
  const leaving = () => {
    const shown = shownSince.current;
    if (!shown.by || round.current || shown.look !== director.look) return;
    shown.by = null;
    if (Date.now() - shown.at < SKIP_SECONDS * 1000) record(shown.look, "skip");
  };

  /** Another look at once, as the music says (at random, before it's heard): the one shown was binned. */
  const moveOn = (why: string) => {
    const now = moment(source.now);
    variationRef.current++;
    show(now ? chooser.pick(now, why).look : another(), "key", source.now, undefined, "music");
  };

  /**
   * L and B (and the assistant): the look shown loved or binned for this kind of song, or taken back if it was
   * already (`toggle`: a key pressed again) or asked (`clear`). A binned look goes at once; in the rating mode, the next
   * look comes.
   */
  const rate = (verdict: "love" | "bin" | "clear", toggle = true) => {
    const look = director.look ?? latest.current.prefs.look;
    const character = characterNow();
    const was = useLookRatings.getState().taste.verdict(look, character);
    const said = verdict === "clear" || (toggle && was.here && was.verdict === verdict) ? "clear" : verdict;
    if (said === "clear" && !was.here) return;
    record(look, said, !!round.current);
    shownSince.current.by = null;
    setRated((r) => ({ look, verdict: said, character, n: (r?.n ?? 0) + 1 }));
    if (round.current) {
      if (said !== "clear") nextToRate();
      return;
    }
    if (said === "bin") moveOn("binned");
  };

  /** The rating mode (⇧R): the looks one after another, those nobody has judged first, each suiting what's playing. */
  const startRating = () => {
    if (round.current) return;
    round.current = new RatingRound(LIVE_LOOKS);
    logger.info("rating the looks");
    nextToRate();
  };
  const stopRating = (done = false) => {
    if (!round.current) return;
    round.current = null;
    setRating(null);
    useLookRatings.getState().setRating(null);
    logger.info(done ? "every look's rated" : "stopped rating the looks");
    if (done) setRated((r) => ({ look: "", verdict: "done", character: null, n: (r?.n ?? 0) + 1 }));
  };
  /** The next look to rate (`passed`: the one showing goes by with nothing said of it); none left, it's done. */
  const nextToRate = (passed = false) => {
    const r = round.current;
    if (!r) return;
    const showing = ratingRef.current?.look;
    if (passed && showing && showing === director.look && !useLookRatings.getState().taste.judged(showing)) record(showing, "pass", true);
    const mood = useNowPlaying.getState().live?.signals.mood;
    const look = r.next(useLookRatings.getState().taste, mood ? asHeard(mood) : null);
    if (!look) return stopRating(true);
    showToRate(look);
  };
  const showToRate = (look: string) => {
    variationRef.current++;
    show(look, "key");
    setRating({ look, until: Date.now() + RATE_SECONDS * 1000 });
    useLookRatings.getState().setRating({ left: round.current!.left(useLookRatings.getState().taste) });
  };
  const backToRate = () => {
    const look = round.current?.back();
    if (look) showToRate(look);
  };

  /** Each frame, before it's drawn: what's decided (`decide`), then MilkDrop's frame, if one of its looks is on screen. */
  function tick(time: number) {
    decide(time);
    const seconds = Math.min(0.1, Math.max(0.001, time - lastTick.current));
    lastTick.current = time;
    const shown = director.shownAt(time);
    // The user's clip, while its MilkDrop look's on screen, pulsing in on the kicks.
    const feeding = feedingRef.current;
    let fed: Feeding | null = null;
    if (feeding && shown.some((s) => s.look === feeding.look)) {
      const reader = source.signals();
      const hit = kick.step(reader ? signalValue(reader, null, MASTER, "onsetLow", time, seconds) : 0, seconds);
      fed = { ...feeding.feeding, hit };
    }
    milkdrop.current?.draw(time, seconds, shown, useNowPlaying.getState().live?.signals ?? null, paceShown.current, fed);
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
      director.setPace(paceShown.current, time);
      if (!first) source.restart();
      show(forScreen(latest.current.prefs.look), "key", first ? time : 0, { type: null });
      // The rating mode, asked for before it could start (the assistant opening the visualizer for it).
      const asked = useLookRatings.getState().asked;
      if (asked !== null) {
        useLookRatings.getState().ask(null);
        if (asked) startRating();
      }
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
    // A song turning slow, or the speed set (or not any more): once it's settled, the look shown again at that speed,
    // melting into itself. (One that doesn't flow, following the music into a slow song, is about to go anyway.)
    slowMotion.current = slowMotionOn(now.mood, slowMotion.current);
    const set = latest.current.prefs.pace;
    const pace = !slowMotion.current ? 1 : set < 1 ? set : SLOW_MOTION;
    if (pace !== paceWanted.current.pace) paceWanted.current = { pace, since: time };
    if (pace !== paceShown.current && time - paceWanted.current.since >= PACE_SETTLES) {
      paceShown.current = pace;
      director.setPace(pace, time);
      logger.info(pace < 1 ? `slow motion at ${Math.round(pace * 100)}% (${set < 1 ? "set" : `slow ${now.mood.slow.toFixed(2)}`})` : "out of slow motion");
      const shown = liveLook(director.look ?? "");
      if (shown && (shown.suits.flows || pace === 1 || set < 1 || latest.current.prefs.auto === "off")) show(shown.id, "fit", time, { type: "film-dissolve", seconds: 3, morph: true, lands: "bar" });
    }
    playEffects(time, now);
    // Rating the looks: they change as the rating mode says, not by themselves.
    if (round.current) return;
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
    if (newSong && prefs.auto !== "off" && now && !round.current) apply(chooser.song(now), source.now);
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

  // The user's clips and pictures (the Library's Visualizer folder): read once it opens; another when asked, and the
  // one for the look shown chosen again as they come and go or are turned on or off.
  useEffect(() => {
    void useVisualizerMedia.getState().load();
    return () => useVisualizerMedia.getState().setFeeding(null);
  }, []);
  const mediaList = useVisualizerMedia((s) => s.media);
  const wantedMedia = useVisualizerMedia((s) => s.wanted);
  // Another set of clips (K, the media panel, the assistant): said for a moment, with how many are in it.
  const mediaSetId = useVisualizerMedia((s) => s.setId);
  const mediaSetWas = useRef(mediaSetId);
  const [setNote, setSetNote] = useState<{ name: string; count: number; n: number } | null>(null);
  useEffect(() => {
    const was = mediaSetWas.current;
    mediaSetWas.current = mediaSetId;
    const set = useVisualizerMedia.getState().sets.find((s) => s.id === mediaSetId);
    if (!was || !set || was === mediaSetId) return;
    setSetNote((note) => ({ name: set.name, count: set.media.length, n: (note?.n ?? 0) + 1 }));
    const t = setTimeout(() => setSetNote(null), RATED_MS);
    return () => clearTimeout(t);
  }, [mediaSetId]);
  // A screen or window shared (G, the media panel's Screen): into the MilkDrop look shown, and one of theirs put up if
  // it isn't one; out again when it stops. Sharing stops when the visualizer closes.
  const screen = useVisualizerScreen((s) => s.shared);
  useEffect(() => () => useVisualizerScreen.getState().stop(), []);
  useEffect(() => {
    // (Not started yet: it starts on one of MilkDrop's, `forScreen`.)
    const look = director.look;
    if (!look) return;
    const wanted = forScreen(look);
    if (wanted !== look) show(wanted, "key");
    else feedFor(look, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen]);
  const mediaOn = prefs.media;
  const nextMedia = prefs.nextMedia;
  const mediaChanged = useRef({ list: mediaList, on: mediaOn, next: nextMedia });
  useEffect(() => {
    const was = mediaChanged.current;
    mediaChanged.current = { list: mediaList, on: mediaOn, next: nextMedia };
    const look = director.look;
    if (!look) return;
    const gone = feedingRef.current && feedingRef.current.feeding.media.id !== SCREEN_MEDIA && !mediaList.some((m) => m.asset.id === feedingRef.current!.feeding.media.id);
    if (nextMedia !== was.next || mediaOn !== was.on || gone || wantedMedia || (!feedingRef.current && mediaList.length)) feedFor(look, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mediaList, mediaOn, nextMedia, wantedMedia]);

  // The user's ratings (kept on this computer), for the looks picked; the rating mode's off once it's closed.
  useEffect(() => {
    void useLookRatings.getState().load();
    return () => useLookRatings.getState().setRating(null);
  }, []);
  // The rating mode asked for by the assistant, once the visualizer's going (before, it starts when it is).
  const asked = useLookRatings((s) => s.asked);
  useEffect(() => {
    if (asked === null || !sessionRef.current) return;
    useLookRatings.getState().ask(null);
    if (asked) startRating();
    else stopRating();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asked]);
  // The rating mode: on to the next look when this one's time is up, nothing said of it.
  useEffect(() => {
    if (!rating) return;
    const t = setTimeout(() => nextToRate(true), Math.max(0, rating.until - Date.now()));
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rating]);
  // The note saying what was rated goes after a moment.
  useEffect(() => {
    if (!rated) return;
    const t = setTimeout(() => setRated(null), RATED_MS);
    return () => clearTimeout(t);
  }, [rated]);

  // A look asked for from outside (the assistant), or chaos rolled or mutated.
  const requested = prefs.requested;
  useEffect(() => {
    if (!requested || !sessionRef.current) return;
    if (requested.rate) {
      if (requested.look !== director.look) show(requested.look, "key");
      rate(requested.rate, false);
    } else if (requested.roll === "chaos") chaos(requested.look);
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
  // Every setting the player plays (D), or the user's clips and pictures (one panel at a time).
  const [panel, setPanelOpen] = useState(false);
  const [mediaPanel, setMediaPanelOpen] = useState(false);
  const [mediaTab, setMediaTab] = useState<MediaTab>("yours");
  const setPanel = (open: boolean | ((was: boolean) => boolean)) => {
    setPanelOpen(open);
    setMediaPanelOpen(false);
  };
  const setMediaPanel = (open: boolean | ((was: boolean) => boolean)) => {
    setMediaPanelOpen(open);
    setPanelOpen(false);
  };
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

  /** A look of `kind` at random, not the one shown, by the user's taste (the looks menu's Shuffle of a kind). */
  const shuffle = (kind: LookKind) => {
    const pool = LIVE_LOOKS.filter((l) => l.kind === kind && l.id !== director.look);
    if (!pool.length) return;
    leaving();
    variationRef.current++;
    show(pickWanted(pool, appealNow, characterNow(), Math.random)!.id, "key", undefined, undefined, "random");
  };
  /** A look at random, of any kind, not shown lately (R, the shuffle button, the looks menu's Shuffle). */
  const shuffleAny = () => {
    leaving();
    variationRef.current++;
    show(another(), "key", undefined, undefined, "random");
  };
  /** A look picked by name (the looks menu). */
  const pick = (id: string) => {
    leaving();
    show(id, "key");
  };
  // The arrows step through the looks but a kind of many's (MilkDrop's), and those the user binned.
  const stepped = LIVE_LOOKS.filter((l) => !ofMany(l));
  const kept = (l: (typeof LIVE_LOOKS)[number]) => l.id === director.look || appealNow(l.id, characterNow()) > 0;
  const step = (by: 1 | -1) => {
    const looks = stepped.filter(kept);
    const i = looks.findIndex((l) => l.id === (director.look ?? prefs.look));
    leaving();
    show(looks[(i + by + looks.length) % looks.length].id, "key");
  };
  const stepGroup = (by: 1 | -1) => {
    const current = liveLook(director.look ?? prefs.look)?.kind ?? "world";
    const k = LOOK_KINDS.findIndex((g) => g.id === current);
    const kind = LOOK_KINDS[(k + by + LOOK_KINDS.length) % LOOK_KINDS.length];
    if (kind.many) return shuffle(kind.id);
    leaving();
    const ofKind = LIVE_LOOKS.filter((l) => l.kind === kind.id);
    show((ofKind.find(kept) ?? ofKind[0]).id, "key");
  };

  // The keys: the visualizer has them all while it fills the app (the editor's under it don't hear them), in a box
  // over it once it's been clicked, and out of the app, in its own window.
  useEffect(() => {
    const win = root ? ownerWindow(root) : window;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey) return;
      if (boxed && !engagedRef.current) return;
      e.stopImmediatePropagation();
      // Typing in a field (the media panel's search) is typing: Escape leaves it.
      const target = e.target as HTMLElement | null;
      const typing =
        !!target &&
        (target.isContentEditable || target.tagName === "TEXTAREA" || (target.tagName === "INPUT" && /^(text|search|url|email|password|number)$/.test((target as HTMLInputElement).type)));
      if (typing) {
        if (e.key === "Escape") target.blur();
        return;
      }
      // The controls' own lists and sliders keep their keys.
      const tag = target?.tagName;
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
      // Rating the looks: → the next (nothing said), ← back, Esc stops.
      if (round.current && action.kind === "close" && !doc().fullscreenElement) return stopRating();
      if (round.current && action.kind === "look") return action.step === 1 ? nextToRate(true) : backToRate();
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
          leaving();
          return chaos();
        case "rate":
          return rate(action.verdict);
        case "rating":
          return round.current ? stopRating() : startRating();
        case "media": {
          const prefs = useVisualizerPrefs.getState();
          if (!useVisualizerMedia.getState().media.length) {
            setMediaPanel(true);
            return wake();
          }
          if (action.next) {
            if (!prefs.media) prefs.setMedia(true);
            else prefs.requestNextMedia();
          } else prefs.setMedia(!prefs.media);
          return wake();
        }
        case "screen": {
          // Shared: stopped. Else the panel's Screen, to pick one (a browser's picker opens at once: a key is a gesture).
          const vis = useVisualizerScreen.getState();
          if (vis.shared) vis.stop();
          else {
            setMediaTab("screen");
            setMediaPanel(true);
            if (!desktopScreens()) void vis.share();
          }
          return wake();
        }
        case "mediaSet": {
          const vis = useVisualizerMedia.getState();
          const next = nextSet(vis.sets, vis.setId);
          if (!next || next.id === vis.setId) {
            setMediaPanel(true);
            return wake();
          }
          vis.useSet(next.id);
          if (!useVisualizerPrefs.getState().media) useVisualizerPrefs.getState().setMedia(true);
          return;
        }
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
        case "slow": {
          const prefs = useVisualizerPrefs.getState();
          prefs.setPace(prefs.pace < 1 ? 1 : SLOW_PACE);
          return wake();
        }
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
  // The look shown, as rated for the kind of song playing (the hearts and bins).
  const taste = useLookRatings((s) => s.taste);
  const left = useLookRatings((s) => s.rating?.left ?? 0);
  const character = characterNow();
  const shownVerdict = taste.verdict(showing, character);
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
      data-player={status?.state}
      data-showing={showing}
      data-rating={rating ? "on" : undefined}
      data-engaged={boxed ? engaged : undefined}
      className={cn(
        "fixed z-[70] overflow-hidden bg-black text-white select-none",
        at ? "rounded-lg shadow-2xl ring-1 shadow-black/60" : "inset-0",
        at && (engaged ? "ring-white/35" : "ring-white/15"),
        !controls && "cursor-none",
      )}
      style={at ? { left: at.x, top: at.y, width: at.width, height: at.height } : undefined}
      onPointerMove={wake}
      onDragOver={(e) => {
        if (![...e.dataTransfer.types].includes("Files")) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
      }}
      onDrop={(e) => {
        const files = [...e.dataTransfer.files];
        if (!files.length) return;
        e.preventDefault();
        setMediaPanel(true);
        wake();
        void useVisualizerMedia.getState().add(files);
      }}
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
          <div data-hud-top className="pointer-events-auto absolute top-1.5 right-1.5 flex items-center">
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
          <div data-hud-top className="pointer-events-auto absolute top-4 right-4 flex items-center gap-1">
            <LooksMenu current={showing} verdictOf={(id) => taste.verdict(id, character)} onPick={pick} onShuffle={shuffle} onShuffleAny={shuffleAny} />
            <RateButtons verdict={shownVerdict} onRate={rate} />
            <Hearing />
            <HudButton label="Tap along to sync (S)" onClick={() => setSyncing(true)} active={syncing}>
              <PiMetronome />
            </HudButton>
            <HudButton label="Distort, feedback and frame (D)" onClick={() => setPanel((p) => !p)} active={panel}>
              <PiSlidersHorizontal />
            </HudButton>
            <HudButton label="Your clips, pictures and screen, in the feedback" onClick={() => setMediaPanel((p) => !p)} active={mediaPanel}>
              <PiFilmStrip />
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
                <HudButton label={rating ? "Stop rating the looks (Esc)" : "Rate the looks, one after another (⇧R)"} active={!!rating} onClick={() => (rating ? stopRating() : startRating())}>
                  <PiCards />
                </HudButton>
                <HudButton label="A look at random (R)" onClick={shuffleAny}>
                  <PiShuffle />
                </HudButton>
                <HudSelect label="Change looks" value={prefs.auto} options={AUTO_SWITCHES} onChange={(id) => useVisualizerPrefs.getState().setAuto(id)} />
                <HudSelect label="Effects" value={prefs.effects} options={EFFECTS_MODES} onChange={(id) => useVisualizerPrefs.getState().setEffects(id)} />
                <HudSlider label="Speed" title="Slow motion (⇧S): all the way right follows the music" value={prefs.pace} {...PACE} text={paceLabel(prefs.pace)} onChange={(v) => useVisualizerPrefs.getState().setPace(v)} />
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
      {mediaPanel && !hudHidden && !compact && <MediaPanel milkdrop={!!milkdropPreset(showing)} tab={mediaTab} onTab={setMediaTab} />}
      {rating && !hudHidden && (
        <RatingBar
          look={rating.look}
          until={rating.until}
          left={left}
          verdict={shownVerdict}
          compact={compact}
          onRate={rate}
          onNext={() => nextToRate(true)}
          onBack={backToRate}
          onStop={() => stopRating()}
        />
      )}
      {rated && <RatedNote key={rated.n} {...rated} />}
      {setNote && !rated && <SetNote key={setNote.n} {...setNote} />}
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
  isElement(target) && target.closest("button, input, select, label, a, [data-play-panel], [data-media-panel], [data-looks-menu], [data-resize]") !== null;

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
  verdictOf,
  onPick,
  onShuffle,
  onShuffleAny,
}: {
  current: string;
  /** How each look's rated for the kind of song playing (a heart, a bin). */
  verdictOf: (id: string) => LookVerdict;
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
  // The kind's looks (MilkDrop's, hundreds of them, by name).
  const listed = LIVE_LOOKS.filter((l) => l.kind === kind);
  if (kind === "milkdrop") listed.sort((a, b) => a.name.localeCompare(b.name));
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
              {listed.map((l) => {
                const { verdict } = verdictOf(l.id);
                return (
                  <button
                    key={l.id}
                    type="button"
                    role="menuitemradio"
                    aria-checked={l.id === current}
                    data-look={l.id}
                    data-verdict={verdict ?? undefined}
                    title={verdict === "bin" ? "Binned: never shown by itself" : verdict === "love" ? "Loved: shown more" : undefined}
                    onClick={() => {
                      onPick(l.id);
                      close();
                    }}
                    className={cn(item, verdict === "bin" && "text-white/40")}
                  >
                    {tick(l.id === current)}
                    <span className="flex-1 truncate">{l.name}</span>
                    {verdict === "love" && <PiHeartFill className="text-white/70" />}
                    {verdict === "bin" && <PiTrash className="text-white/40" />}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Love or bin the look shown (L, B), each again to take it back. */
function RateButtons({ verdict, onRate }: { verdict: LookVerdict; onRate: (verdict: "love" | "bin") => void }) {
  const loved = verdict.here && verdict.verdict === "love";
  const binned = verdict.here && verdict.verdict === "bin";
  return (
    <>
      <HudButton label={loved ? "Loved: shown more (L takes it back)" : "Love this look: shown more (L)"} active={loved} onClick={() => onRate("love")}>
        {loved ? <PiHeartFill /> : <PiHeart />}
      </HudButton>
      <HudButton label={binned ? "Binned (B takes it back)" : "Bin this look: never shown again (B)"} active={binned} onClick={() => onRate("bin")}>
        {binned ? <PiTrashFill /> : <PiTrash />}
      </HudButton>
    </>
  );
}

/**
 * The rating mode's bar (⇧R): the look to rate, love or bin it (each moving on), back or on with nothing said, how
 * many are left, and how long until the next comes by itself.
 */
function RatingBar({
  look,
  until,
  left,
  verdict,
  compact,
  onRate,
  onNext,
  onBack,
  onStop,
}: {
  look: string;
  until: number;
  left: number;
  verdict: LookVerdict;
  compact: boolean;
  onRate: (verdict: "love" | "bin") => void;
  onNext: () => void;
  onBack: () => void;
  onStop: () => void;
}) {
  const now = useNow(100);
  const share = Math.max(0, Math.min(1, (until - now) / (RATE_SECONDS * 1000)));
  const l = liveLook(look);
  const kind = LOOK_KINDS.find((k) => k.id === l?.kind)?.label;
  const loved = verdict.here && verdict.verdict === "love";
  const binned = verdict.here && verdict.verdict === "bin";
  const big = "flex h-9 items-center gap-1.5 rounded-md px-3 text-[13px] font-medium text-white/90 hover:bg-white/10 [&_svg]:size-4";
  return (
    <div
      data-rating-bar={look}
      className={cn(
        "absolute left-1/2 z-10 -translate-x-1/2 overflow-hidden rounded-xl bg-black/75 ring-1 ring-white/10 backdrop-blur-md",
        compact ? "bottom-14" : "bottom-28",
      )}
    >
      <div className={cn("flex items-center", compact ? "gap-0.5 p-0.5" : "gap-1 py-1.5 pr-1.5 pl-4")}>
        {!compact && (
          <div className="mr-3 min-w-0">
            <p className="text-[11px] tracking-wide text-white/50 uppercase">Rating the looks · {left} to go</p>
            <p className="max-w-64 truncate text-sm font-medium">
              {l?.name ?? look}
              {kind && <span className="font-normal text-white/50"> · {kind}</span>}
            </p>
          </div>
        )}
        <HudButton label="Back to the one before (←)" onClick={onBack}>
          <PiArrowLeft />
        </HudButton>
        <button type="button" data-rate="love" aria-pressed={loved} title="Love it: shown more (L)" onClick={() => onRate("love")} className={cn(big, loved && "bg-white/15")}>
          {loved ? <PiHeartFill /> : <PiHeart />}
          {!compact && (
            <>
              Love <Key>L</Key>
            </>
          )}
        </button>
        <button type="button" data-rate="bin" aria-pressed={binned} title="Bin it: never shown again (B)" onClick={() => onRate("bin")} className={cn(big, binned && "bg-white/15")}>
          {binned ? <PiTrashFill /> : <PiTrash />}
          {!compact && (
            <>
              Bin <Key>B</Key>
            </>
          )}
        </button>
        <HudButton label="Next, nothing said (→)" onClick={onNext}>
          <PiArrowRight />
        </HudButton>
        {!compact && (
          <button type="button" onClick={onStop} title="Stop rating (Esc)" className="ml-1 h-9 rounded-md px-3 text-[13px] text-white/70 hover:bg-white/10 hover:text-white">
            Done
          </button>
        )}
      </div>
      <div className="h-0.5 bg-white/10">
        <div className="h-full bg-white/60" style={{ width: `${share * 100}%` }} />
      </div>
    </div>
  );
}

function Key({ children }: { children: React.ReactNode }) {
  return <kbd className="rounded bg-white/15 px-1 font-mono text-[11px] leading-4 font-normal text-white/70">{children}</kbd>;
}

/** What was just rated, said for a moment. */
function RatedNote({ look, verdict, character }: { look: string; verdict: RatingVerdict | "done"; character: SongCharacter | null }) {
  const name = liveLook(look)?.name ?? look;
  const on = character ? ` on ${character} songs` : "";
  const text =
    verdict === "love"
      ? `Loved ${name}: shown more${on}`
      : verdict === "bin"
        ? `Binned ${name}: it won't come back${on}`
        : verdict === "clear"
          ? `${name}: as any other look again`
          : "That's every look rated";
  return (
    <div data-rated={verdict} className="pointer-events-none absolute top-6 left-1/2 z-10 flex -translate-x-1/2 items-center gap-2 rounded-full bg-black/70 px-4 py-2 text-sm text-white/90 ring-1 ring-white/10 backdrop-blur-md [&_svg]:size-4">
      {verdict === "love" ? <PiHeartFill /> : verdict === "bin" ? <PiTrashFill /> : verdict === "done" ? <PiCheck /> : <PiHeart />}
      <span className="max-w-[60vw] truncate">{text}</span>
    </div>
  );
}

/** The set of the user's clips the visualizer has gone on to, and how many are in it. */
function SetNote({ name, count }: { name: string; count: number }) {
  return (
    <div data-set-note className="pointer-events-none absolute top-6 left-1/2 z-10 flex -translate-x-1/2 items-center gap-2 rounded-full bg-black/70 px-4 py-2 text-sm text-white/90 ring-1 ring-white/10 backdrop-blur-md [&_svg]:size-4">
      <PiFilmStrip />
      <span className="max-w-[60vw] truncate">
        {name}: {count ? `${count} clip${count === 1 ? "" : "s"}` : "nothing in it yet"}
      </span>
    </div>
  );
}

/** The song's place, and play, pause and skip. */
function Transport({ compact = false }: { compact?: boolean }) {
  const status = useNowPlaying((s) => s.status);
  const now = useNow(500);
  const track = status?.track;
  if (!status || !track) return <div className="text-sm text-white/50">Listening to the computer's sound</div>;
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

/** A slider along the controls: its label, the slider, what it's set to. */
function HudSlider({
  label,
  title,
  value,
  min,
  max,
  step,
  text,
  onChange,
}: {
  label: string;
  title: string;
  value: number;
  min: number;
  max: number;
  step: number;
  text: string;
  onChange: (value: number) => void;
}) {
  return (
    <label title={title} className="flex items-center gap-2 text-xs text-white/60">
      {label}
      <input
        type="range"
        aria-label={label}
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-8 w-28 accent-white outline-none"
      />
      <span className="w-24 text-[13px] text-white/85 tabular-nums">{text}</span>
    </label>
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
