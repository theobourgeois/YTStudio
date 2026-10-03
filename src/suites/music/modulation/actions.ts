/**
 * What the Modulate menu and the Modulators window do (`docs/sidechain.md`): each one undo step.
 */
import { createId } from "@shared/ids";
import { DEFAULT_AMOUNT, addModulator, linkControl, modulationOf, unlinkControl } from "@shared/music/modulation";
import type { AutomationTarget, Modulator, ModulatorSource, MusicProject } from "@shared/music/types";
import { useMusic } from "../store";
import { useModulationUi } from "./store";

const sameSource = (a: ModulatorSource, b: ModulatorSource) =>
  a.kind === "track" && b.kind === "track" ? a.track === b.track && a.tap === b.tap : a.kind === "notes" && b.kind === "notes" && a.channel === b.channel;

/** The song's modulator following `source`, if it has one. */
export const modulatorFollowing = (song: MusicProject, source: ModulatorSource): Modulator | undefined => song.modulators.find((m) => sameSource(m.source, source));

/**
 * Modulate a control by a source (the knob menu's Modulate ▸ Follow track / Follow notes): linked to the
 * modulator already following it, or a new one, `amount` (a duck by default), its window shown.
 */
export function modulateWith(target: AutomationTarget, source: ModulatorSource, amount = DEFAULT_AMOUNT) {
  let id: string | null = null;
  useMusic.getState().commit((song) => {
    const existing = modulatorFollowing(song, source);
    id = existing?.id ?? createId("mod");
    const withIt = existing ? song : addModulator(song, source, id);
    if (!withIt) {
      id = null;
      return song;
    }
    return linkControl(withIt, id, target, amount);
  });
  if (id) useModulationUi.getState().show(id);
}

/** Link a control to a modulator the song has (keeping its amount if it's linked there already). */
export function linkTo(modulatorId: string, target: AutomationTarget) {
  useMusic.getState().commit((song) => {
    const found = modulationOf(song, target);
    return linkControl(song, modulatorId, target, found?.modulator.id === modulatorId ? found.link.amount : DEFAULT_AMOUNT);
  });
  useModulationUi.getState().show(modulatorId);
}

export const unlink = (target: AutomationTarget) => useMusic.getState().commit((song) => unlinkControl(song, target));

/** A new modulator following `source` (no links yet), shown. */
export function newModulator(source: ModulatorSource) {
  const id = createId("mod");
  let made = false;
  useMusic.getState().commit((song) => {
    const next = addModulator(song, source, id);
    made = !!next;
    return next ?? song;
  });
  if (made) useModulationUi.getState().show(id);
}
