/**
 * The send row at the foot of the mixer, for every selected track at once (Logic's, Bitwig's): each
 * selected track is a source; every other track's switch says whether they send to it (all of them, some,
 * or none) and whether they can (no loop). Pure, so it's tested.
 */
import { MASTER_TRACK_ID } from "@shared/music/project";
import type { Mixer } from "@shared/music/types";

/** What a track's send switch shows, for the selected tracks (the ones sends are made from). */
export type SendState =
  /** It's one of the selected tracks: a source. */
  | { kind: "source" }
  /**
   * Selected tracks send to it. `level` is `owner`'s send (the current track's if it's one of them, else
   * the first sending), the one its knob shows; `partial`: some that could send here don't.
   */
  | { kind: "sending"; level: number; owner: string; partial: boolean; preFader: boolean }
  /** A click makes the selected tracks send to it. */
  | { kind: "available" }
  /** No selected track can send to it: its sound reaches them already (a loop), or they're the master. */
  | { kind: "unavailable" };

/** The tracks whose sound reaches `id` (through sends), `id` included. */
export function feeding(mixer: Mixer, id: string): Set<string> {
  const into = new Map<string, string[]>();
  for (const track of mixer.tracks) for (const send of track.sends) into.set(send.to, [...(into.get(send.to) ?? []), track.id]);
  const found = new Set<string>([id]);
  const stack = [id];
  while (stack.length) for (const from of into.get(stack.pop()!) ?? []) if (!found.has(from)) found.add(from), stack.push(from);
  return found;
}

/** Every track's send switch for `sources` (the selected tracks, the current one first), by id. */
export function sendStates(mixer: Mixer, sources: readonly string[]): Map<string, SendState> {
  const tracks = new Map(mixer.tracks.map((t) => [t.id, t]));
  const from = sources.filter((id) => tracks.has(id));
  const isSource = new Set(from);
  // The master sends nowhere; a track can't send to one that feeds it.
  const senders = from.filter((id) => id !== MASTER_TRACK_ID).map((id) => ({ id, feeds: feeding(mixer, id), sends: new Map(tracks.get(id)!.sends.map((s) => [s.to, s])) }));
  return new Map(
    mixer.tracks.map((t): [string, SendState] => {
      if (isSource.has(t.id)) return [t.id, { kind: "source" }];
      const allowed = senders.filter((s) => s.sends.has(t.id) || !s.feeds.has(t.id));
      const sending = allowed.filter((s) => s.sends.has(t.id));
      if (!sending.length) return [t.id, allowed.length ? { kind: "available" } : { kind: "unavailable" }];
      const owner = sending[0];
      const send = owner.sends.get(t.id)!;
      return [t.id, { kind: "sending", level: send.level, owner: owner.id, partial: sending.length < allowed.length, preFader: !!send.preFader }];
    }),
  );
}

/**
 * What a click on a track's send switch does: removes the selected tracks' sends to it when they all send
 * there, else makes the ones that don't (and can) send there. `remove`: the tracks to stop sending; `add`:
 * the tracks to start.
 */
export function sendToggle(mixer: Mixer, sources: readonly string[], to: string): { remove: string[]; add: string[] } {
  const state = sendStates(mixer, sources).get(to);
  if (!state || state.kind === "source" || state.kind === "unavailable") return { remove: [], add: [] };
  const tracks = new Map(mixer.tracks.map((t) => [t.id, t]));
  const sending = sources.filter((id) => tracks.get(id)?.sends.some((s) => s.to === to));
  if (state.kind === "sending" && !state.partial) return { remove: sending, add: [] };
  const add = sources.filter((id) => id !== MASTER_TRACK_ID && tracks.has(id) && !sending.includes(id) && !feeding(mixer, id).has(to));
  return { remove: [], add };
}
