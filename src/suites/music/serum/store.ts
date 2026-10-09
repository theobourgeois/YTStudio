import { create } from "zustand";
import { errorMessage } from "@shared/errors";
import { type SerumPresetEntry, type SerumSound, stepSerumPreset } from "@shared/music/serum-presets";
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
  error: string | null;
}

const EMPTY: SerumChannel = { sound: null, path: null, loading: null, error: null };

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
  setShown: (channelId: string, paths: string[]) => void;
  /** Serum's stars for a preset (0 takes them away). */
  rate: (entry: SerumPresetEntry, rating: number) => Promise<void>;
  /** A macro turned (its control's value, 0 to 1); a drag says when it begins and ends. */
  setMacro: (channelId: string, param: string, value: number, gesture?: "begin" | "end") => void;
}

const projectId = () => useMusic.getState().projectId;

/** Setting a macro while a drag moves it: one request at a time, the latest value next (a drag sends dozens a second). */
const sending = new Map<string, { value: number; gesture?: "begin" | "end" } | null>();
function sendMacro(channelId: string, param: string, value: number, gesture?: "begin" | "end") {
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
      if (next) sendMacro(channelId, param, next.value, next.gesture);
    });
}

export const useSerumUi = create<SerumUi>((set, get) => {
  const patch = (channelId: string, change: Partial<SerumChannel>) =>
    set((s) => ({ channels: { ...s.channels, [channelId]: { ...(s.channels[channelId] ?? EMPTY), ...change } } }));
  return {
    openIds: [],
    presets: null,
    available: true,
    libraryError: null,
    channels: {},
    shown: {},

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
        patch(channelId, { sound, path: entry.path, loading: null });
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
      const now = get().channels[channelId];
      if (now?.sound)
        patch(channelId, {
          sound: { ...now.sound, macros: now.sound.macros.map((m) => (m.param === param ? { ...m, value, text: `${Math.round(value * 100)}%` } : m)) },
        });
      sendMacro(channelId, param, value, gesture);
    },
  };
});

// Another song: its own channels.
useMusic.subscribe((state, prev) => {
  if (state.projectId !== prev.projectId) useSerumUi.setState({ openIds: [], channels: {}, shown: {} });
});
