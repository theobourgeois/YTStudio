/**
 * Modulators (`docs/sidechain.md`): FL's Peak Controller, generalised. A modulator follows a track's level
 * (or a channel's notes) and moves the controls it's linked to from where they are, by an amount of their
 * range: Bitwig's way (added to the control, automation included), not FL's (which replaces it). Pure
 * edits returning the same song when nothing changes, the follower's maths (`followerCoefficient`,
 * `shapeLevel`: what the engine runs) and what a linked control is at a level (`modulatedFraction`).
 */
import { clamp } from "../math.ts";
import { controlOf, targetKey } from "./automation.ts";
import { DEFAULT_TAP } from "./sidechain.ts";
import type { AutomationTarget, ModulationLink, Modulator, ModulatorSource, MusicProject } from "./types.ts";

import { MAX_LINKS, MAX_MODULATORS, MODULATOR_RANGES } from "./project.ts";

export { MAX_LINKS, MAX_MODULATORS, MODULATOR_RANGES };
/** A new one: quick to rise (2 ms), a beat's pump to fall (150 ms), as FL's Peak Controller ducks a bass. */
export const DEFAULT_MODULATOR: Omit<Modulator, "id" | "source" | "links"> = { name: null, attack: 0.002, release: 0.15, gain: 0, tension: 0 };
/** The amount a new link moves its control: down by 60% of its range at full level (a duck). */
export const DEFAULT_AMOUNT = -0.6;

type Knobs = Pick<Modulator, "attack" | "release" | "gain" | "tension">;
export type ModulatorPatch = Partial<Knobs & Pick<Modulator, "name" | "source">>;

// ---------------------------------------------------------------------------
// The follower (the engine runs the same)
// ---------------------------------------------------------------------------

/** A one-pole's step towards its target each sample, for `seconds` to get most of the way (0: at once). */
export const followerCoefficient = (seconds: number, sampleRate: number) => (seconds <= 0 ? 1 : 1 - Math.exp(-1 / (seconds * sampleRate)));

/** The follower's level (0..1) bent by `tension`: 0 straight, towards 1 slower to rise, towards -1 quicker. */
export const shapeLevel = (level: number, tension: number) => {
  const x = clamp(level, 0, 1);
  return tension === 0 ? x : x ** 4 ** tension;
};

/** Where a linked control is (a fraction of its range) at a modulator's level: from `own`, by `amount`, kept in range. */
export const modulatedFraction = (own: number, amount: number, level: number) => clamp(own + amount * level, 0, 1);

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export const findModulator = (song: Pick<MusicProject, "modulators">, id: string) => song.modulators.find((m) => m.id === id) ?? null;

/** The modulator moving a control, and its link: null when none does. */
export function modulationOf(song: Pick<MusicProject, "modulators">, target: AutomationTarget): { modulator: Modulator; link: ModulationLink } | null {
  const key = targetKey(target);
  for (const modulator of song.modulators) {
    const link = modulator.links.find((l) => targetKey(l.target) === key);
    if (link) return { modulator, link };
  }
  return null;
}

/** Each modulated control's modulator and link, by `targetKey` (made once per modulator list). */
const linkIndexes = new WeakMap<Modulator[], Map<string, { modulator: Modulator; index: number; link: ModulationLink }>>();
export function modulationIndex(song: Pick<MusicProject, "modulators">) {
  const known = linkIndexes.get(song.modulators);
  if (known) return known;
  const index = new Map<string, { modulator: Modulator; index: number; link: ModulationLink }>();
  song.modulators.forEach((modulator, i) => {
    for (const link of modulator.links) if (!index.has(targetKey(link.target))) index.set(targetKey(link.target), { modulator, index: i, link });
  });
  linkIndexes.set(song.modulators, index);
  return index;
}

/** What a modulator follows, said: "Kick (after its effects)", "the notes of Kick". */
export function sourceText(song: Pick<MusicProject, "mixer" | "channels">, source: ModulatorSource): string {
  if (source.kind === "notes") return `the notes of ${song.channels.find((c) => c.id === source.channel)?.name ?? "a deleted channel"}`;
  const number = song.mixer.tracks.findIndex((t) => t.id === source.track);
  if (number < 0) return "a deleted track";
  return song.mixer.tracks[number].name ?? (number === 0 ? "Master" : `Insert ${number}`);
}

/** What a modulator is called: its name, or its source's ("Kick level", "Kick notes"). */
export function modulatorName(song: Pick<MusicProject, "mixer" | "channels">, modulator: Modulator): string {
  if (modulator.name) return modulator.name;
  return modulator.source.kind === "notes" ? `${sourceText(song, modulator.source).replace(/^the notes of /, "")} notes` : `${sourceText(song, modulator.source)} level`;
}

/** Whether a control can be modulated: anything automation can drive, but the tempo. */
export const canModulate = (target: AutomationTarget) => target.kind !== "tempo";

// ---------------------------------------------------------------------------
// Edits
// ---------------------------------------------------------------------------

const withModulators = (song: MusicProject, modulators: Modulator[]): MusicProject => ({ ...song, modulators });

/** A source as the song can have it (the tap defaulted), or null. */
function tidySource(song: MusicProject, source: ModulatorSource): ModulatorSource | null {
  if (source.kind === "notes") return song.channels.some((c) => c.id === source.channel) ? { kind: "notes", channel: source.channel } : null;
  return song.mixer.tracks.some((t) => t.id === source.track) ? { kind: "track", track: source.track, tap: source.tap ?? DEFAULT_TAP } : null;
}

const tidyKnobs = (m: Knobs): Knobs => ({
  attack: Math.round(clamp(m.attack, ...MODULATOR_RANGES.attack) * 1e5) / 1e5,
  release: Math.round(clamp(m.release, ...MODULATOR_RANGES.release) * 1e5) / 1e5,
  gain: Math.round(clamp(m.gain, ...MODULATOR_RANGES.gain) * 100) / 100,
  tension: Math.round(clamp(m.tension, ...MODULATOR_RANGES.tension) * 1000) / 1000,
});

/** A new modulator following `source` (no links yet). Null when the source isn't in the song or there's no room. */
export function addModulator(song: MusicProject, source: ModulatorSource, id: string, patch: ModulatorPatch = {}): MusicProject | null {
  const tidy = tidySource(song, source);
  if (!tidy || song.modulators.length >= MAX_MODULATORS || findModulator(song, id)) return null;
  const knobs = tidyKnobs({ ...DEFAULT_MODULATOR, ...patch });
  return withModulators(song, [...song.modulators, { id, name: patch.name?.trim() || null, source: tidy, ...knobs, links: [] }]);
}

/** Change a modulator's source, name or knobs (the same song when nothing changes). */
export function updateModulator(song: MusicProject, id: string, patch: ModulatorPatch): MusicProject {
  const modulator = findModulator(song, id);
  if (!modulator) return song;
  const source = patch.source ? tidySource(song, patch.source) : modulator.source;
  if (!source) return song;
  const name = patch.name === undefined ? modulator.name : patch.name?.trim() || null;
  const next: Modulator = { ...modulator, ...tidyKnobs({ ...modulator, ...patch }), name, source };
  if (JSON.stringify(next) === JSON.stringify(modulator)) return song;
  return withModulators(song, song.modulators.map((m) => (m.id === id ? next : m)));
}

export function removeModulator(song: MusicProject, id: string): MusicProject {
  return findModulator(song, id) ? withModulators(song, song.modulators.filter((m) => m.id !== id)) : song;
}

/**
 * Link a control to a modulator by `amount` (-1..1 of its range at full level), taking it from any other
 * modulator that moved it (a control has one at most). `amount` null unlinks it. The same song when nothing
 * changes, the modulator isn't there, or the control can't be modulated (the tempo).
 */
export function linkControl(song: MusicProject, modulatorId: string, target: AutomationTarget, amount: number | null): MusicProject {
  if (!findModulator(song, modulatorId) || !canModulate(target)) return song;
  const key = targetKey(target);
  const rounded = amount === null ? null : Math.round(clamp(amount, -1, 1) * 1000) / 1000;
  let changed = false;
  const modulators = song.modulators.map((m) => {
    const at = m.links.findIndex((l) => targetKey(l.target) === key);
    if (m.id === modulatorId) {
      if (rounded === null) {
        if (at < 0) return m;
        changed = true;
        return { ...m, links: m.links.filter((_, i) => i !== at) };
      }
      if (at >= 0 && m.links[at].amount === rounded) return m;
      if (at < 0 && m.links.length >= MAX_LINKS) return m;
      changed = true;
      return { ...m, links: at >= 0 ? m.links.map((l, i) => (i === at ? { ...l, amount: rounded } : l)) : [...m.links, { target, amount: rounded }] };
    }
    // Another moved it: no longer (only when it's being linked here).
    if (at < 0 || rounded === null) return m;
    changed = true;
    return { ...m, links: m.links.filter((_, i) => i !== at) };
  });
  return changed ? withModulators(song, modulators) : song;
}

/** Take a control off whatever modulator moves it. */
export function unlinkControl(song: MusicProject, target: AutomationTarget): MusicProject {
  const found = modulationOf(song, target);
  return found ? linkControl(song, found.modulator.id, target, null) : song;
}

/** "−60%": an amount as its knob says it. */
export const amountText = (amount: number) => `${amount > 0 ? "+" : amount < 0 ? "−" : ""}${Math.round(Math.abs(amount) * 100)}%`;

/** A link's range said in its control's own words: "80% → 20%". */
export function linkRangeText(song: MusicProject, link: ModulationLink): string {
  const info = controlOf(song, link.target);
  const own = info.own ?? 0.5;
  return `${info.format(own)} → ${info.format(modulatedFraction(own, link.amount, 1))}`;
}
