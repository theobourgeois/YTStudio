import { describe, expect, it } from "vitest";
import { LIVE_LOOKS, seededRandom } from "@shared/live-looks";
import { SONG_CHARACTERS, type Mood, type MoodEvent, type Section, type SongCharacter } from "@shared/signals/mood";
import { FAR, LookChooser, MARGIN, PHRASE_BARS, SLOW_MOST, outOfRange, pickLook, slowMotionOn, suits } from "./chooser";

/** A mood: what's given, the rest quiet and unremarkable. */
function mood(m: Partial<Mood> = {}): Mood {
  return {
    intensity: 0.5,
    presence: { low: 0, mid: 0, high: 0 },
    section: "steady",
    sectionSince: 0,
    character: null,
    sure: 0,
    scores: { chill: 0, groove: 0, hype: 0, heavy: 0 },
    slow: 0,
    events: [],
    heard: { loudness: -20, hits: 2, kicks: 1, sub: 0.2, brightness: 2000 },
    ...m,
  };
}

/** A part of a made-up song: its section, its intensity from `from` to `to` over `seconds`. */
type Part = { section: Section; seconds: number; from: number; to?: number; event?: MoodEvent["kind"] };

/**
 * A song's moods every 0.1 s: its kind known after 8 s, each part's event as it starts, a drop also as the signals
 * hear it (its kick, 20 ms on).
 */
function* song(character: SongCharacter, parts: Part[], start = 0, slow = 0): Generator<{ time: number; mood: Mood; drop?: number }> {
  let at = start;
  const events: MoodEvent[] = [];
  let drop: number | undefined;
  for (const part of parts) {
    if (part.event) events.push({ kind: part.event, time: at });
    const dropAt = part.event === "drop" ? at : undefined;
    for (let t = 0; t < part.seconds; t += 0.1) {
      const x = t / part.seconds;
      const time = at + t;
      if (dropAt !== undefined && time >= dropAt + 0.02) drop = dropAt;
      yield {
        time,
        drop,
        mood: mood({
          intensity: part.from + ((part.to ?? part.from) - part.from) * x,
          section: part.section,
          character: time - start > 8 ? character : null,
          sure: time - start > 8 ? 0.7 : 0.1,
          slow: time - start > 8 ? slow : 0,
          events: [...events],
        }),
      };
    }
    at += part.seconds;
  }
}

/** A song shaped as most are: an intro, a build-up, a drop, a breakdown, a build-up and a drop again. */
const SHAPED = (calm: number, loud: number): Part[] => [
  { section: "intro", seconds: 16, from: calm },
  { section: "build", seconds: 14, from: calm, to: loud - 0.15, event: "build" },
  { section: "drop", seconds: 30, from: loud, event: "drop" },
  { section: "breakdown", seconds: 20, from: calm, event: "breakdown" },
  { section: "build", seconds: 12, from: calm, to: loud - 0.15, event: "build" },
  { section: "drop", seconds: 30, from: loud, event: "drop" },
];

/** A song played through the chooser, following the music, as the view does: every look it showed, and when. */
function follow(character: SongCharacter, parts: Part[], seed = "x", { slow = 0, bpm = 128 } = {}) {
  const chooser = new LookChooser(LIVE_LOOKS, seededRandom(seed));
  const bar = (4 * 60) / bpm;
  const shown: { time: number; look: string; why: string; how: string; reason: string; at?: number }[] = [];
  const frames = [...song(character, parts, 0, slow)];
  const first = chooser.song({ time: 0, mood: frames[0].mood, bar });
  chooser.shown(first.look, 0, bar);
  shown.push({ time: 0, ...first });
  const timeline: { time: number; mood: Mood; look: string }[] = [];
  for (const { time, mood: m, drop } of frames) {
    const choice = chooser.follow({ time, mood: m, bar, drop });
    if (choice) {
      chooser.shown(choice.look, choice.at ?? time, bar);
      shown.push({ time, ...choice });
    }
    timeline.push({ time, mood: m, look: chooser.look! });
  }
  return { shown, timeline, bar };
}

describe("what looks suit", () => {
  it("has looks for every kind of song at every intensity it's likely to have (three at least)", () => {
    const likely: Record<SongCharacter, [number, number]> = { chill: [0, 0.7], groove: [0.1, 0.9], hype: [0.3, 1], heavy: [0.1, 1] };
    for (const character of SONG_CHARACTERS) {
      const [lo, hi] = likely[character];
      for (let i = lo; i <= hi + 1e-9; i += 0.05) {
        const m = mood({ character, sure: 0.8, intensity: i });
        expect(LIVE_LOOKS.filter((l) => suits(l, m)).length, `${character} at ${i.toFixed(2)}`).toBeGreaterThanOrEqual(3);
      }
    }
    // Minimal ones, for between songs.
    expect(LIVE_LOOKS.filter((l) => l.suits.minimal).length).toBeGreaterThanOrEqual(4);
  });

  it("has looks that flow for a slow song of every kind but hype (it's never), however loud it's mastered", () => {
    for (const character of ["chill", "groove", "heavy"] as const) {
      for (let i = 0; i <= 1 + 1e-9; i += 0.05) {
        const m = mood({ character, sure: 0.8, intensity: i, slow: 0.8 });
        const flowing = LIVE_LOOKS.filter((l) => suits(l, m));
        expect(flowing.length, `a slow ${character} song at ${i.toFixed(2)}`).toBeGreaterThanOrEqual(3);
        for (const l of flowing) expect(l.suits.flows, l.id).toBe(true);
      }
    }
    // No bars or waveforms: the spectrums but the cover don't flow.
    expect(LIVE_LOOKS.filter((l) => l.kind === "spectrum" && l.suits.flows).map((l) => l.id)).toEqual(["album"]);
    // Minimal ones, for a slow song's start and between.
    expect(LIVE_LOOKS.filter((l) => l.suits.minimal && l.suits.flows).length).toBeGreaterThanOrEqual(3);
  });

  it("picks a look that suits the moment, and one for the moment asked for", () => {
    const random = seededRandom("pick");
    for (const character of SONG_CHARACTERS) {
      for (let i = 0; i <= 1; i += 0.1) {
        const m = mood({ character, sure: 0.8, intensity: i });
        const look = pickLook(LIVE_LOOKS, m, [], random);
        if (LIVE_LOOKS.some((l) => suits(l, m))) expect(suits(look, m), `${character} ${i}: ${look.id}`).toBe(true);
      }
    }
    expect(pickLook(LIVE_LOOKS, mood({ intensity: 0.1 }), [], random, "minimal").suits.minimal).toBe(true);
    // A drop wants an intense look even before the intensity has caught up.
    const drop = pickLook(LIVE_LOOKS, mood({ character: "hype", sure: 0.8, intensity: 0.45 }), [], random, "intense");
    expect(outOfRange(drop, 0.7)).toBeLessThanOrEqual(MARGIN);
  });

  it("doesn't pick what was shown lately while there's another", () => {
    const random = seededRandom("recent");
    const m = mood({ character: "hype", sure: 0.8, intensity: 0.85 });
    const suiting = LIVE_LOOKS.filter((l) => suits(l, m)).map((l) => l.id);
    const recent = suiting.slice(0, -1);
    for (let i = 0; i < 20; i++) expect(recent).not.toContain(pickLook(LIVE_LOOKS, m, recent, random).id);
  });
});

describe("following the music", () => {
  const SONGS: [SongCharacter, number, number][] = [
    ["chill", 0.12, 0.5],
    ["groove", 0.2, 0.7],
    ["hype", 0.25, 0.9],
    ["heavy", 0.2, 0.95],
  ];

  for (const [character, calm, loud] of SONGS) {
    for (const seed of ["a", "b", "c"]) {
      it(`a ${character} song (${seed}): no look plays out of its range for long, each choice says why`, () => {
        const { shown, timeline, bar } = follow(character, SHAPED(calm, loud), seed);
        // Out of its range (and margin): never longer than a phrase; far out, never longer than a couple of bars.
        let outSince: number | null = null;
        let farSince: number | null = null;
        for (const { time, mood: m, look } of timeline) {
          const l = LIVE_LOOKS.find((x) => x.id === look)!;
          const off = outOfRange(l, m.intensity);
          // A build-up keeps its look (it rises to the drop).
          const building = m.section === "build";
          outSince = off > MARGIN && !building ? (outSince ?? time) : null;
          farSince = off > FAR && !building ? (farSince ?? time) : null;
          if (outSince !== null) expect(time - outSince, `${look} at ${time.toFixed(1)} s (${m.intensity.toFixed(2)})`).toBeLessThanOrEqual(PHRASE_BARS * bar + 0.5);
          if (farSince !== null) expect(time - farSince, `${look} far off at ${time.toFixed(1)} s`).toBeLessThanOrEqual(2 * bar + 0.5);
        }
        for (const s of shown) expect(s.why.length).toBeGreaterThan(10);
      });
    }
  }

  it("starts a song minimal, then once its kind is known plays looks for it", () => {
    const { shown, timeline } = follow("heavy", SHAPED(0.2, 0.9));
    expect(LIVE_LOOKS.find((l) => l.id === shown[0].look)!.suits.minimal).toBe(true);
    // Twenty seconds on, whatever plays suits a heavy song.
    for (const { time, look } of timeline) if (time > 20 && time < 30) expect(LIVE_LOOKS.find((l) => l.id === look)!.suits.characters).toContain("heavy");
  });

  it("cuts on the drop's kick as soon as it's heard, and keeps its look through a build-up", () => {
    const { shown } = follow("hype", SHAPED(0.25, 0.9));
    // The first drop's kick is at 30 s, heard 20 ms on: a cut placed on it, chosen the frame it's heard.
    const onDrop = shown.find((s) => s.time >= 30 && s.time < 30.5);
    expect(onDrop).toMatchObject({ how: "cut", reason: "drop", at: 30 });
    expect(onDrop!.time).toBeLessThan(30.15);
    expect(onDrop?.why).toContain("the drop");
    // Nothing changes in the build-ups (16-30 s, 80-92 s), but a far-off look... none is let be far off, so none.
    expect(shown.filter((s) => (s.time > 16.5 && s.time < 30) || (s.time > 80.5 && s.time < 92)).filter((s) => s.how !== "mutate" && s.how !== "vary")).toEqual([]);
  });

  it("a slow song, however loud: only looks that flow (once it's known slow), every change blended, its drop too", () => {
    const { shown, timeline, bar } = follow("chill", SHAPED(0.45, 0.85), "slow", { slow: 0.85, bpm: 72 });
    // Its first look (before it's known slow) is changed within a couple of bars of knowing.
    for (const { time, look } of timeline) if (time > 8 + 2 * bar + 0.5) expect(LIVE_LOOKS.find((l) => l.id === look)!.suits.flows, `${look} at ${time.toFixed(1)}`).toBe(true);
    expect(shown.filter((s) => s.how === "cut")).toEqual([]);
    const drop = shown.find((s) => s.reason === "drop");
    expect(drop).toMatchObject({ how: "now" });
    expect(drop!.why).toContain("blended in");
    // Its loudness isn't taken for intensity: no look is changed for being out of range at 0.85.
    expect(shown.filter((s) => s.why.includes("far from the music"))).toEqual([]);
    expect(SLOW_MOST).toBeLessThan(0.85);
  });

  it("plays slow motion from a slow song on, until it's clearly not (no flicker on the line)", () => {
    let on = false;
    const seen: boolean[] = [];
    for (const slow of [0.2, 0.49, 0.5, 0.45, 0.42, 0.5, 0.39, 0.45]) seen.push((on = slowMotionOn({ slow }, on)));
    expect(seen).toEqual([false, false, true, true, true, true, false, false]);
  });

  it("goes minimal between songs (a long quiet)", () => {
    const { shown } = follow("hype", [
      { section: "drop", seconds: 20, from: 0.85 },
      { section: "steady", seconds: 6, from: 0.02 },
    ]);
    const quiet = shown.find((s) => s.why.startsWith("quiet"));
    expect(quiet && LIVE_LOOKS.find((l) => l.id === quiet.look)!.suits.minimal).toBe(true);
  });

  it("mutates a chaos look each phrase and changes it after 32 bars; keeps another (its effects evolve it) and changes it after 16", () => {
    const chooser = new LookChooser(LIVE_LOOKS, seededRandom("phrase"));
    const bar = 2;
    const phrase = PHRASE_BARS * bar;
    const m = mood({ character: "hype", sure: 0.8, intensity: 0.8 });
    // Each phrase's end as the view sees it: the choice made, and shown again.
    const at = (look: string, start: number, phrases: number) => {
      chooser.shown(look, start, bar);
      const made = [];
      for (let i = 1; i <= phrases; i++) {
        const choice = chooser.follow({ time: start + i * phrase + 0.1, mood: m, bar });
        made.push(choice);
        if (choice) chooser.shown(choice.look, start + i * phrase + 0.1, bar);
      }
      return made;
    };
    const chaos = at("chaos-stargate", 0, 4);
    expect(chaos.slice(0, 3).map((c) => c?.how)).toEqual(["mutate", "mutate", "mutate"]);
    expect(chaos[3]).toMatchObject({ how: "bar" });
    expect(chaos[3]!.look).not.toBe("chaos-stargate");
    const other = at("cyberspace", 1000, 2);
    expect(other[0]).toBeNull();
    expect(other[1]!.look).not.toBe("cyberspace");
  });
});
