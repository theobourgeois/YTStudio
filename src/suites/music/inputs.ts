import { create } from "zustand";
import type { EngineDevices } from "@shared/music/engine";
import type { MixerInput } from "@shared/music/types";
import { musicApi } from "./api";

/** One of the device's inputs a mixer track can take (FL's Input menu): a pair, or one alone. */
export interface InputChoice {
  input: MixerInput;
  label: string;
}

/**
 * FL Studio's Input menu, from the device's channels' names: the stereo pairs first ("In 1 - In 2",
 * "In 3 - In 4"...), then each input alone (heard on both sides).
 */
export function inputChoices(channels: readonly string[]): InputChoice[] {
  const pairs: InputChoice[] = [];
  for (let channel = 0; channel + 1 < channels.length; channel += 2)
    pairs.push({ input: { channel, stereo: true }, label: `${channels[channel]} - ${channels[channel + 1]}` });
  return [...pairs, ...channels.map((name, channel) => ({ input: { channel, stereo: false }, label: name }))];
}

/** What a track's input is called on this device, or by its number when the device doesn't have it. */
export function inputLabel(input: MixerInput, channels: readonly string[]): string {
  const name = (channel: number) => channels[channel] ?? `Input ${channel + 1}`;
  return input.stereo ? `${name(input.channel)} - ${name(input.channel + 1)}` : name(input.channel);
}

/** A choice's key, for menus' values ("m0", "s2"). */
export const inputKey = (input: MixerInput | null) => (input ? `${input.stereo ? "s" : "m"}${input.channel}` : "none");

/** The audio device's input as the engine has it open: its name and its channels' names (empty: none). */
interface InputsState {
  device: string | null;
  channels: string[];
  loaded: boolean;
  load: () => Promise<void>;
  /** What the engine said of its devices (Settings changed them). */
  take: (devices: EngineDevices) => void;
}

export const useInputs = create<InputsState>((set, get) => ({
  device: null,
  channels: [],
  loaded: false,
  async load() {
    try {
      get().take(await musicApi.devices());
    } catch {
      set({ loaded: true });
    }
  },
  take: (devices) => set({ device: devices.input ?? null, channels: devices.inputChannels ?? [], loaded: true }),
}));
