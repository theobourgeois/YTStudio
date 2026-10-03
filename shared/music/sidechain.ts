/**
 * Keys (`docs/sidechain.md`): an effect hearing another mixer track's sound, as a compressor ducking to a
 * kick. Any slot can have one (`MixerEffect.sidechain`); Pro-C's External trigger, Pro-Q's external dynamic
 * bands and a plugin's sidechain input read it. A key orders the tracks as a send does (its source runs
 * first), so it never makes a loop through sends and other keys. Pure, returning the same song when nothing
 * changes, like `mixer.ts`.
 */
import { MASTER_TRACK_ID, reaches, routeOf } from "./project.ts";
import { PRO_C_PLUGIN } from "./pro-c-presets.ts";
import { PRO_Q_PLUGIN } from "./pro-q-presets.ts";
import type { MixerEffect, MixerTrack, MusicProject, Sidechain, SidechainTap } from "./types.ts";

/** What each tap is called in menus. */
export const SIDECHAIN_TAP_NAMES: Record<SidechainTap, string> = { preFx: "Before its effects", postFx: "After its effects", postFader: "After its fader" };
/** The tap a new key takes: after the source's effects, before its fader (so its fader and mute don't change the ducking). */
export const DEFAULT_TAP: SidechainTap = "postFx";

/** Ours that can't hear a key (their originals have no side chain). */
const KEYLESS = new Set(["vaudio:gross-beat", "vaudio:echo-boy", "vaudio:auto-tune", "vaudio:ott", "vaudio:panman", "vaudio:pitch-wheel"]);

/**
 * Whether an effect can hear a key: Pro-C, Pro-Q (its dynamic bands), or a plugin (which hears it only if
 * it has a sidechain input: `hasInput`, the engine's word once it's loaded; unknown until then).
 */
export function takesKey(effect: Pick<MixerEffect, "plugin">, hasInput?: boolean): boolean {
  if (effect.plugin.id === PRO_C_PLUGIN.id || effect.plugin.id === PRO_Q_PLUGIN.id) return true;
  if (KEYLESS.has(effect.plugin.id)) return false;
  return hasInput !== false;
}

/** An effect of the song by id, with its track and slot. */
export function findSlot(song: Pick<MusicProject, "mixer">, effectId: string): { track: MixerTrack; slot: number; effect: MixerEffect } | null {
  for (const track of song.mixer.tracks) {
    const slot = track.effects.findIndex((e) => e?.id === effectId);
    if (slot >= 0) return { track, slot, effect: track.effects[slot]! };
  }
  return null;
}

/** The tracks with this effect's own key left out (so it can be checked against the rest). */
const without = (tracks: readonly MixerTrack[], effectId: string) =>
  tracks.map((t) => (t.effects.some((e) => e?.id === effectId) ? { ...t, effects: t.effects.map((e) => (e?.id === effectId ? { ...e, sidechain: undefined } : e)) } : t));

/**
 * Whether `from` can key an effect on track `to`: both exist, they differ, the master keys nothing (it runs
 * last), and `to`'s sound doesn't reach `from` through sends and other keys (a loop). `effectId`: the effect
 * whose key it would replace, left out of the check.
 */
export function canKey(song: Pick<MusicProject, "mixer">, from: string, to: string, effectId?: string): boolean {
  const tracks = song.mixer.tracks;
  if (from === to || from === MASTER_TRACK_ID || !tracks.some((t) => t.id === from) || !tracks.some((t) => t.id === to)) return false;
  return !reaches(routeOf(effectId ? without(tracks, effectId) : tracks), to, from);
}

/** Replace one effect, keeping the song when it's the same. */
function withEffect(song: MusicProject, effectId: string, change: (effect: MixerEffect) => MixerEffect): MusicProject {
  const found = findSlot(song, effectId);
  if (!found) return song;
  const next = change(found.effect);
  if (next === found.effect) return song;
  const effects = found.track.effects.map((e, i) => (i === found.slot ? next : e));
  return { ...song, mixer: { ...song.mixer, tracks: song.mixer.tracks.map((t) => (t === found.track ? { ...t, effects } : t)) } };
}

/**
 * Key an effect from a track (`source`; null: no key), taken at `tap` (the key's own, else `DEFAULT_TAP`).
 * Refused (the same song) when `canKey` refuses it. A Pro-C keyed turns its External trigger on, as picking
 * a source in its window does.
 */
export function setSidechain(song: MusicProject, effectId: string, source: string | null, tap?: SidechainTap): MusicProject {
  const found = findSlot(song, effectId);
  if (!found) return song;
  if (source === null)
    return withEffect(song, effectId, (effect) => {
      if (!effect.sidechain) return effect;
      const { sidechain: _, ...rest } = effect;
      return rest;
    });
  if (!canKey(song, source, found.track.id, effectId)) return song;
  const key: Sidechain = { track: source, tap: tap ?? found.effect.sidechain?.tap ?? DEFAULT_TAP };
  return withEffect(song, effectId, (effect) => {
    const same = effect.sidechain?.track === key.track && effect.sidechain.tap === key.tap;
    const external = effect.proC && effect.proC.sidechain.trigger !== "external" ? { ...effect.proC, sidechain: { ...effect.proC.sidechain, trigger: "external" as const } } : effect.proC;
    if (same && external === effect.proC) return effect;
    return { ...effect, sidechain: key, ...(external && { proC: external }) };
  });
}

/** Change where an effect's key is taken (nothing without a key). */
export function setSidechainTap(song: MusicProject, effectId: string, tap: SidechainTap): MusicProject {
  return withEffect(song, effectId, (effect) => (!effect.sidechain || effect.sidechain.tap === tap ? effect : { ...effect, sidechain: { ...effect.sidechain, tap } }));
}

/** The effects a track keys: each with its track and slot. */
export function keyedBy(song: Pick<MusicProject, "mixer">, trackId: string): { track: MixerTrack; slot: number; effect: MixerEffect }[] {
  return song.mixer.tracks.flatMap((track) => track.effects.flatMap((effect, slot) => (effect?.sidechain?.track === trackId ? [{ track, slot, effect }] : [])));
}

/** Each pair of tracks a key joins (the source, the keyed track), once: the Mixer's sidechain cables. */
export function sidechainLinks(song: Pick<MusicProject, "mixer">): { from: string; to: string }[] {
  const seen = new Set<string>();
  const links: { from: string; to: string }[] = [];
  for (const track of song.mixer.tracks)
    for (const effect of track.effects) {
      const from = effect?.sidechain?.track;
      if (!from || seen.has(`${from}>${track.id}`)) continue;
      seen.add(`${from}>${track.id}`);
      links.push({ from, to: track.id });
    }
  return links;
}

/**
 * The song with every key that's no longer possible taken off: its track gone, now its own track (the
 * effect moved there), or round a loop (in order: the first ones stay). The same song when all are fine.
 */
export function withValidKeys(song: MusicProject): MusicProject {
  if (!song.mixer.tracks.some((t) => t.effects.some((e) => e?.sidechain))) return song;
  let next = song;
  for (const track of song.mixer.tracks)
    for (const effect of track.effects) {
      const key = effect?.sidechain;
      if (!effect || !key) continue;
      const owner = findSlot(next, effect.id)!.track;
      if (!canKey(next, key.track, owner.id, effect.id)) next = setSidechain(next, effect.id, null);
    }
  return next;
}

/** A track as a key's source in a menu: its number and name, and whether it can key the effect (not a loop). */
export interface KeyChoice {
  id: string;
  number: number;
  name: string;
  color: string | null;
  possible: boolean;
}

/** The tracks an effect can be keyed by (every insert but its own; the master keys nothing), in the mixer's order. */
export function keyChoices(song: Pick<MusicProject, "mixer">, effectId: string): KeyChoice[] {
  const own = findSlot(song, effectId)?.track;
  if (!own) return [];
  const route = routeOf(without(song.mixer.tracks, effectId));
  return song.mixer.tracks.flatMap((t, number) =>
    number === 0 || t === own ? [] : [{ id: t.id, number, name: t.name ?? `Insert ${number}`, color: t.color, possible: !reaches(route, own.id, t.id) }],
  );
}
