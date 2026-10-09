import { create } from "zustand";
import { errorMessage } from "@shared/errors";
import { type SerumPresetEntry, type SerumSound, randomSerumPreset, stepSerumPreset } from "@shared/music/serum-presets";
import { fxParam, fxStored, SERUM_EFFECTS, type SerumChainEntry, type SerumFxRackId } from "@shared/music/serum-effects";
import { type SerumSolo, type SerumSoundEdit, soloOscillator, withControl } from "@shared/music/serum-sound";
import { musicApi } from "../api";
import { useMusic } from "../store";
import { serumWindow, useMusicWindows } from "../ui";

/** One Serum channel's player: what its Serum has on, and what's being done to it. */
export interface SerumChannel {
  sound: SerumSound | null;
  /** The preset file it has on: the one loaded here, else the one Serum says it came from. */
  path: string | null;
  /** A preset being loaded (its path), while it is. */
  loading: string | null;
  /** An edit, undo or redo Serum is loading, while it is. */
  busy: boolean;
  error: string | null;
  /** The destinations a route can have in its sound, once asked (the add and change pickers). */
  destinations: string[] | null;
  /** An oscillator soloed, and how they all were before (put back when it ends). */
  solo: SerumSolo | null;
}

const EMPTY: SerumChannel = { sound: null, path: null, loading: null, busy: false, error: null, destinations: null, solo: null };

/** An effect of the channel's sound, by its rack and place. */
export function effectAt(sound: SerumSound | null | undefined, rack: SerumFxRackId, position: number) {
  return sound?.effects.find((r) => r.rack === rack)?.effects.find((e) => e.position === position) ?? null;
}

interface SerumUi {
  /** The Serum channels whose players are open. */
  openIds: string[];
  /** Serum's library (every preset), once read; null before. */
  presets: SerumPresetEntry[] | null;
  /** False: there's no Serum 2 preset folder on this computer. */
  available: boolean;
  libraryError: string | null;
  channels: Record<string, SerumChannel>;
  /** Each open player's list as it shows it (its search and filters): what ↑ ↓ step through. */
  shown: Record<string, string[]>;
  /** Serum's saved effects and racks (`Effect Chains`), once asked for (+ Add's menu). */
  chains: SerumChainEntry[] | null;

  open: (channelId: string) => void;
  close: (channelId: string) => void;
  toggle: (channelId: string) => void;
  /** Read the library again (the files that changed). */
  loadLibrary: () => Promise<void>;
  /** Ask the channel's Serum what it has on now. */
  refresh: (channelId: string) => Promise<void>;
  /** Load a preset onto the channel's Serum. */
  load: (channelId: string, entry: SerumPresetEntry) => Promise<void>;
  /** The next (1) or previous (-1) preset in the player's list. */
  step: (channelId: string, by: number) => Promise<void>;
  /** A random preset of the player's list as its search and filters leave it (never the one on, if there's another). */
  shuffle: (channelId: string) => Promise<void>;
  setShown: (channelId: string, paths: string[]) => void;
  /** Serum's stars for a preset (0 takes them away). */
  rate: (entry: SerumPresetEntry, rating: number) => Promise<void>;
  /** A macro turned (its control's value, 0 to 1); a drag says when it begins and ends. */
  setMacro: (channelId: string, param: string, value: number, gesture?: "begin" | "end") => void;
  /**
   * One of Serum's live controls moved (a macro, a mod amount, an envelope's or LFO's), 0 to 1: set as it moves, an
   * undo step (`label`) when its drag ends. Without a gesture it's set outright: a step of its own.
   */
  setControl: (channelId: string, param: string, value: number, gesture: "begin" | "drag" | "end" | "set", label: string) => void;
  /** Several of them moved by one drag (an envelope's point: its decay and sustain): one undo step. */
  setControls: (channelId: string, values: Record<string, number>, gesture: "begin" | "drag" | "end" | "set", label: string) => void;
  /** Changes Serum loads as a new state (`SerumSoundEdit`): one undo step. Rejects with the server's reason. */
  edit: (channelId: string, edits: SerumSoundEdit[], label?: string) => Promise<void>;
  undo: (channelId: string) => Promise<void>;
  redo: (channelId: string) => Promise<void>;
  /** Ask which destinations a route of the channel's sound can have (once a preset is loaded). */
  loadDestinations: (channelId: string) => Promise<void>;
  /** An oscillator turned off (muted) or back on: Serum's own switch, live, one undo step. */
  muteOscillator: (channelId: string, index: number) => void;
  /** An oscillator soloed (the others off), or its solo ended (all put back as they were): one undo step. */
  soloOscillator: (channelId: string, index: number) => void;
  /**
   * An effect's control set (0 to 1): live through its rack's slot when it's linked to one (a drag: begun, moved,
   * ended), else Serum loads it as a new state when it's let go (`gesture` "end" or "set"). One undo step.
   */
  setEffectControl: (channelId: string, rack: SerumFxRackId, position: number, key: string, value: number, gesture: "begin" | "drag" | "end" | "set") => void;
  /** Read Serum's saved effects and racks (once). */
  loadChains: () => Promise<void>;
}

const projectId = () => useMusic.getState().projectId;

/** Setting a control while a drag moves it: one request at a time, the latest value next (a drag sends dozens a second). */
const sending = new Map<string, { value: number; gesture?: "begin" | "end" } | null>();
function sendControl(channelId: string, param: string, value: number, gesture?: "begin" | "end") {
  const key = `${channelId}\n${param}`;
  if (sending.has(key) && !gesture) {
    sending.set(key, { value });
    return;
  }
  sending.set(key, null);
  void musicApi
    .engine("setParameter", { owner: "channel", ownerId: channelId, param, value, ...(gesture ? { gesture } : {}) })
    .catch(() => {})
    .finally(() => {
      const next = sending.get(key);
      sending.delete(key);
      if (next) sendControl(channelId, param, next.value, next.gesture);
    });
}

/** An oscillator as the player names it: "Osc A", "Noise", "Sub". */
export const oscillatorLabel = (name: string) => (name === "Noise" || name === "Sub" ? name : `Osc ${name}`);

/** Where each control being dragged started (channel and parameter), for its undo step. */
const dragStarts = new Map<string, number>();

/** Where a control of the channel's sound is now, as the player shows it. */
function controlValue(sound: SerumSound | null | undefined, param: string): number | undefined {
  if (!sound) return undefined;
  const all = [
    ...sound.macros.map((m) => ({ param: m.param, value: m.value })),
    ...(sound.modulation ?? []).map((r) => r.amount),
    ...sound.envelopes.flatMap((e) => Object.values(e.controls)),
    ...sound.lfos.flatMap((l) => Object.values(l.controls)),
    ...sound.oscillators.flatMap((o) => [o.enabled, o.level]),
    ...sound.effects.flatMap((r) => r.effects.flatMap((e) => [...(e.enabled ? [e.enabled] : []), ...e.controls])).flatMap((c) => (c.param ? [{ param: c.param, value: c.value }] : [])),
  ];
  return all.find((c) => c.param === param)?.value;
}

export const useSerumUi = create<SerumUi>((set, get) => {
  const patch = (channelId: string, change: Partial<SerumChannel>) =>
    set((s) => ({ channels: { ...s.channels, [channelId]: { ...(s.channels[channelId] ?? EMPTY), ...change } } }));
  async function historyStep(channelId: string, redo: boolean) {
    const project = projectId();
    const now = get().channels[channelId];
    if (!project || now?.busy || !(redo ? now?.sound?.history.redo : now?.sound?.history.undo)) return;
    patch(channelId, { busy: true, error: null });
    try {
      const sound = await musicApi.undoSerum(project, channelId, redo);
      // An undone load puts back the preset before it: the file it came from if Serum says, else the one listed by its name.
      const named = get().presets?.find((p) => p.path === now.path)?.name === sound.preset?.name;
      patch(channelId, { sound, busy: false, path: sound.preset?.path ?? (named ? now.path : null), destinations: null, solo: null });
    } catch (err) {
      patch(channelId, { busy: false, error: errorMessage(err) });
    }
  }
  return {
    openIds: [],
    presets: null,
    available: true,
    libraryError: null,
    channels: {},
    shown: {},
    chains: null,

    open(channelId) {
      useMusicWindows.getState().focus(serumWindow(channelId));
      if (!get().openIds.includes(channelId)) set({ openIds: [...get().openIds, channelId] });
      // (What its Serum has on is asked once it's loaded: the window does.)
      void get().loadLibrary();
    },
    close(channelId) {
      const { [channelId]: _, ...shown } = get().shown;
      set({ openIds: get().openIds.filter((id) => id !== channelId), shown });
    },
    toggle(channelId) {
      if (get().openIds.includes(channelId)) get().close(channelId);
      else get().open(channelId);
    },
    async loadLibrary() {
      try {
        const { available, presets } = await musicApi.serumPresets();
        set({ available, presets, libraryError: null });
      } catch (err) {
        set({ libraryError: errorMessage(err) });
      }
    },
    async refresh(channelId) {
      const project = projectId();
      if (!project) return;
      try {
        const sound = await musicApi.serumSound(project, channelId);
        const now = get().channels[channelId] ?? EMPTY;
        patch(channelId, { sound, path: sound.preset?.path ?? now.path, error: null });
      } catch (err) {
        patch(channelId, { error: errorMessage(err) });
      }
    },
    async load(channelId, entry) {
      const project = projectId();
      if (!project) return;
      patch(channelId, { loading: entry.path, error: null });
      try {
        const sound = await musicApi.loadSerumPreset(project, channelId, entry.path);
        // Another preset asked for meanwhile (arrows held): that one's answer is the one kept.
        if (get().channels[channelId]?.loading !== entry.path) return;
        patch(channelId, { sound, path: entry.path, loading: null, destinations: null, solo: null });
      } catch (err) {
        if (get().channels[channelId]?.loading === entry.path) patch(channelId, { loading: null, error: errorMessage(err) });
      }
    },
    async step(channelId, by) {
      const presets = get().presets ?? [];
      const byPath = new Map(presets.map((p) => [p.path, p]));
      const list = (get().shown[channelId] ?? []).flatMap((p) => byPath.get(p) ?? []);
      const now = get().channels[channelId];
      const next = stepSerumPreset(list, now?.loading ?? now?.path ?? null, by);
      if (next && next.path !== (now?.loading ?? now?.path)) await get().load(channelId, next);
    },
    async shuffle(channelId) {
      const byPath = new Map((get().presets ?? []).map((p) => [p.path, p]));
      const list = (get().shown[channelId] ?? []).flatMap((p) => byPath.get(p) ?? []);
      const now = get().channels[channelId];
      const next = randomSerumPreset(list, now?.loading ?? now?.path ?? null);
      if (next) await get().load(channelId, next);
    },
    setShown(channelId, paths) {
      set((s) => ({ shown: { ...s.shown, [channelId]: paths } }));
    },
    async rate(entry, rating) {
      const before = entry.rating;
      const put = (r: number) => set((s) => ({ presets: s.presets?.map((p) => (p.hash === entry.hash ? { ...p, rating: r } : p)) ?? null }));
      put(rating);
      try {
        await musicApi.rateSerumPreset(entry.hash, rating);
      } catch (err) {
        put(before);
        set({ libraryError: errorMessage(err) });
      }
    },
    setMacro(channelId, param, value, gesture) {
      const name = get().channels[channelId]?.sound?.macros.find((m) => m.param === param)?.name ?? "a macro";
      get().setControl(channelId, param, value, gesture ?? "drag", `Turn ${name}`);
    },
    setControl(channelId, param, value, gesture, label) {
      get().setControls(channelId, { [param]: value }, gesture, label);
    },
    setControls(channelId, values, gesture, label) {
      const changes: { param: string; before: number; after: number }[] = [];
      for (const [param, value] of Object.entries(values)) {
        const key = `${channelId}\n${param}`;
        const now = get().channels[channelId];
        if (gesture === "begin" || gesture === "set") dragStarts.set(key, controlValue(now?.sound, param) ?? value);
        if (now?.sound) patch(channelId, { sound: withControl(now.sound, param, value) });
        // Set outright, it's touched and let go at once, as the macros' knobs always did (automation recording sees it).
        if (gesture === "set") sendControl(channelId, param, value, "begin");
        sendControl(channelId, param, value, gesture === "begin" ? "begin" : gesture === "drag" ? undefined : "end");
        if (gesture !== "end" && gesture !== "set") continue;
        const before = dragStarts.get(key);
        dragStarts.delete(key);
        if (before !== undefined) changes.push({ param, before, after: value });
      }
      const project = projectId();
      if (!project || !changes.some((c) => c.before !== c.after)) return;
      void musicApi
        .serumStep(project, channelId, changes, label)
        .then((history) => {
          const sound = get().channels[channelId]?.sound;
          if (sound) patch(channelId, { sound: { ...sound, history } });
        })
        .catch(() => {});
    },
    async edit(channelId, edits, label) {
      const project = projectId();
      if (!project) return;
      patch(channelId, { busy: true, error: null });
      try {
        const sound = await musicApi.editSerumSound(project, channelId, edits, label);
        patch(channelId, { sound, busy: false });
      } catch (err) {
        patch(channelId, { busy: false, error: errorMessage(err) });
        throw err;
      }
    },
    async undo(channelId) {
      await historyStep(channelId, false);
    },
    async redo(channelId) {
      await historyStep(channelId, true);
    },
    muteOscillator(channelId, index) {
      const osc = get().channels[channelId]?.sound?.oscillators.find((o) => o.index === index);
      if (!osc) return;
      const on = osc.enabled.value >= 0.5;
      get().setControl(channelId, osc.enabled.param, on ? 0 : 1, "set", `${on ? "Mute" : "Unmute"} ${oscillatorLabel(osc.name)}`);
    },
    soloOscillator(channelId, index) {
      const now = get().channels[channelId];
      const oscillators = now?.sound?.oscillators;
      const osc = oscillators?.find((o) => o.index === index);
      if (!oscillators || !osc) return;
      const { values, solo } = soloOscillator(oscillators, index, now.solo);
      get().setControls(channelId, values, "set", `${solo ? "Solo" : "Unsolo"} ${oscillatorLabel(osc.name)}`);
      patch(channelId, { solo });
    },
    setEffectControl(channelId, rack, position, key, value, gesture) {
      const effect = effectAt(get().channels[channelId]?.sound, rack, position);
      const param = effect?.effect ? fxParam(effect.effect, key) : undefined;
      if (!effect?.effect || !param) return;
      const control = key === "kParamEnable" ? effect.enabled : effect.controls.find((c) => c.key === key);
      const name = SERUM_EFFECTS[effect.effect].name;
      const label = key === "kParamEnable" ? `${value >= 0.5 ? "Turn on" : "Bypass"} ${name}` : `${name} ${(control?.name ?? param.label).toLowerCase()}`;
      if (control?.param) return get().setControl(channelId, control.param, value, gesture, label);
      // Not on a slot: Serum takes it as a new state, once it's let go.
      if (gesture !== "end" && gesture !== "set") return;
      const settings = key === "kParamEnable" ? undefined : { [param.spec]: fxStored(param.scale, value) };
      const edit: SerumSoundEdit = { kind: "effect", rack, position, ...(settings ? { settings } : { enabled: value >= 0.5 }) };
      void get()
        .edit(channelId, [edit], label)
        .catch(() => {});
    },
    async loadChains() {
      if (get().chains) return;
      try {
        set({ chains: await musicApi.serumChains() });
      } catch {
        // No saved effects to offer: the menu says so.
      }
    },
    async loadDestinations(channelId) {
      const project = projectId();
      if (!project) return;
      try {
        patch(channelId, { destinations: await musicApi.serumDestinations(project, channelId) });
      } catch {
        // No sound yet: the picker says so.
      }
    },
  };
});

// Another song: its own channels.
useMusic.subscribe((state, prev) => {
  if (state.projectId !== prev.projectId) useSerumUi.setState({ openIds: [], channels: {}, shown: {} });
});
