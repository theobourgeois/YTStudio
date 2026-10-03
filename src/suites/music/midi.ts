import { create } from "zustand";
import type { MidiPlayed } from "@shared/music/engine";
import type { MusicProject } from "@shared/music/types";
import { musicApi } from "./api";
import { usePiano } from "./piano/store";
import { useMusic } from "./store";
import { DEFAULT_TYPING_OCTAVE, MAX_TYPING_OCTAVE, MIN_TYPING_OCTAVE, TYPING_VELOCITY, resolveTypingKey } from "./typing-keyboard";
import { useMusicUi } from "./ui";

/**
 * MIDI keyboards in the tab (`docs/fl-studio/midi.md`): which channel they play (the rack's selected
 * one, told to the engine), the keys held as the engine says they were played (the Piano roll lights
 * them), and FL's typing keyboard, whose notes go to the engine as a keyboard's would (`midiIn`), so
 * they're played, lit and recorded the same way. None of it is the song's.
 */
interface MidiState {
  /** The typing keyboard to piano keyboard (Ctrl+T): letter keys play notes. */
  typing: boolean;
  /** The octave its bottom row starts in (`[` and `]`). */
  octave: number;
  /** Keys held now, by channel, as the engine played them. */
  held: Readonly<Record<string, readonly number[]>>;
  /** When a note was last played (`performance.now()`): the toolbar's MIDI light. */
  lastNoteAt: number;
  setTyping: (on: boolean) => void;
  /** What the engine said was played (`midi` events). */
  played: (notes: readonly MidiPlayed[]) => void;
}

const NONE: Readonly<Record<string, readonly number[]>> = {};

/** The typing keyboard's keys down, by key code, and the note each plays (an octave change mid-press ends the right one). */
const typingDown = new Map<string, number>();

function send(messages: number[][]) {
  void musicApi.engine("midiIn", { messages }).catch(() => {});
}

/** Let go of every typing keyboard key held (it's turned off, or the page lost the keyboard). */
export function releaseTyping() {
  if (!typingDown.size) return;
  send([...typingDown.values()].map((pitch) => [0x80, pitch, 0]));
  typingDown.clear();
}

export const useMidi = create<MidiState>((set, get) => ({
  typing: false,
  octave: DEFAULT_TYPING_OCTAVE,
  held: NONE,
  lastNoteAt: 0,
  setTyping(typing) {
    if (!typing) releaseTyping();
    set({ typing });
  },
  played(notes) {
    let held = get().held;
    let last = get().lastNoteAt;
    for (const note of notes) {
      if (!note.channel) continue;
      const keys = held[note.channel] ?? [];
      const next = note.on ? (keys.includes(note.key) ? keys : [...keys, note.key]) : keys.filter((k) => k !== note.key);
      if (next !== keys) held = { ...held, [note.channel]: next };
      if (note.on) last = performance.now();
    }
    if (held !== get().held || last !== get().lastNoteAt) set({ held, lastNoteAt: last });
  },
}));

/** The keys held on a channel now (none: a shared empty list). */
export const heldKeys = (channelId: string | null): readonly number[] => (channelId ? (useMidi.getState().held[channelId] ?? EMPTY) : EMPTY);
const EMPTY: readonly number[] = [];

/**
 * A key pressed or let go while the typing keyboard is on: true if it was the typing keyboard's (a note,
 * or an octave), so the page's own shortcut doesn't run.
 */
export function typingKey(e: Pick<KeyboardEvent, "code" | "metaKey" | "ctrlKey" | "altKey"> & { repeat?: boolean }, down: boolean): boolean {
  const { typing, octave } = useMidi.getState();
  if (!typing) return false;
  if (!down) {
    const pitch = typingDown.get(e.code);
    if (pitch === undefined) return false;
    typingDown.delete(e.code);
    send([[0x80, pitch, 0]]);
    return true;
  }
  const action = resolveTypingKey(e, octave);
  if (!action) return false;
  if (action.type === "consume") return true;
  if (action.type === "octave") {
    useMidi.setState({ octave: Math.min(MAX_TYPING_OCTAVE, Math.max(MIN_TYPING_OCTAVE, octave + action.direction)) });
    return true;
  }
  // A key held repeats: it's one note.
  if (e.repeat || typingDown.has(e.code)) return true;
  typingDown.set(e.code, action.pitch);
  send([[0x90, action.pitch, TYPING_VELOCITY]]);
  return true;
}

/** The channel MIDI keyboards play: the first selected in the rack, else the Piano roll's. */
export function midiTarget(song: MusicProject | undefined): string | null {
  if (!song) return null;
  const exists = (id: string | null | undefined): id is string => !!id && song.channels.some((c) => c.id === id);
  const selected = useMusicUi.getState().selectedChannelIds.find(exists);
  if (selected) return selected;
  const piano = usePiano.getState().channelId;
  return exists(piano) ? piano : null;
}

/**
 * Keep the engine's MIDI target on the selected channel (sent when it changes, and again when the
 * engine restarts: `resend`), and let go of the typing keyboard when the page loses the keyboard.
 * Returns how to stop.
 */
export function startMidiSync(): { stop: () => void; resend: () => void } {
  let sent: string | null | undefined;
  const sync = (force = false) => {
    const target = midiTarget(useMusic.getState().history?.doc);
    if (target === sent && !force) return;
    sent = target;
    void musicApi.engine("midiTarget", { channel: target }).catch(() => {});
  };
  const stops = [
    useMusicUi.subscribe((s, p) => s.selectedChannelIds !== p.selectedChannelIds && sync()),
    usePiano.subscribe((s, p) => s.channelId !== p.channelId && sync()),
    useMusic.subscribe((s, p) => (s.history?.doc.channels !== p.history?.doc.channels || s.projectId !== p.projectId) && sync()),
  ];
  const blur = () => releaseTyping();
  window.addEventListener("blur", blur);
  const syncTyping = () => {
    void musicApi.engine("typingKeyboard", { on: useMidi.getState().typing }).catch(() => {});
  };
  stops.push(useMidi.subscribe((s, p) => s.typing !== p.typing && syncTyping()));
  sync(true);
  syncTyping();
  return {
    stop() {
      for (const stop of stops) stop();
      window.removeEventListener("blur", blur);
      releaseTyping();
      void musicApi.engine("typingKeyboard", { on: false }).catch(() => {});
      useMidi.setState({ held: NONE });
    },
    resend: () => { sync(true); syncTyping(); },
  };
}
