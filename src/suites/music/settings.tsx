import { useEffect, useState } from "react";
import { errorMessage } from "@shared/errors";
import type { EngineDevices, SetDeviceRequest } from "@shared/music/engine";
import { STRETCH_MODE_NAMES, isStretchMode } from "@shared/music/stretch";
import { STRETCH_MODES } from "@shared/music/types";
import { SettingsGroup, SettingsRow } from "@/components/settings/settings-ui";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { musicApi } from "./api";
import { EnginePanel } from "./engine-panel";
import { useMusicPreferences } from "./preferences";
import { askMicrophone, microphoneAccess } from "@/lib/desktop";
import { useInputs } from "./inputs";
import { ResamplingSelect } from "./resampling-select";
import { useTransport } from "./transport";

/**
 * The music editor's section of Settings, FL Studio's Audio settings (`docs/fl-studio/settings.md`): the
 * output device, its buffer and sample rate, then the engine and the plugin bench. Loaded on first use.
 */
export default function MusicSettings() {
  return (
    <>
      <DeviceSettings />
      <QualitySettings />
      <TransportSettings />
      <SettingsGroup title="Engine and plugins" description="The audio engine's state, a test tone, and your plugins on a test bench." bare>
        <EnginePanel />
      </SettingsGroup>
    </>
  );
}

/** FL's two Resampling settings: how samples are read when pitched or at another rate, playing and exporting. */
function QualitySettings() {
  const resampling = useMusicPreferences((s) => s.resampling);
  const exportResampling = useMusicPreferences((s) => s.exportResampling);
  const set = useMusicPreferences((s) => s.setResampling);
  return (
    <SettingsGroup
      title="Quality"
      description="How samplers and audio clips are read when they're pitched or at another rate than the song. Better methods sound cleaner (no faint whistles on bright sounds) and cost more. Plugins aren't affected."
    >
      <SettingsRow title="Resampling while playing" description="Hermite is clean and cheap. Sinc is the cleanest, but costly with many voices at once.">
        <ResamplingSelect value={resampling} onChange={(value) => set({ resampling: value })} label="Resampling while playing" />
      </SettingsRow>
      <SettingsRow title="Resampling in exports" description="Exports aren't played live, so the cleanest costs only a little time.">
        <ResamplingSelect value={exportResampling} onChange={(value) => set({ exportResampling: value })} label="Resampling in exports" />
      </SettingsRow>
      <StretchModeRow />
    </SettingsGroup>
  );
}

/** FL's "Reset plugins on transport": whether a single stop silences the effects' tails. */
function TransportSettings() {
  const resetOnStop = useMusicPreferences((s) => s.resetOnStop);
  const setResetOnStop = useMusicPreferences((s) => s.setResetOnStop);
  return (
    <SettingsGroup title="Playback">
      <SettingsRow
        title="Reset plugins on stop"
        description="Stopping silences delays, reverbs and every other tail at once. Off, they ring out after a stop, and pressing Stop again silences them."
      >
        <Switch checked={resetOnStop} onCheckedChange={setResetOnStop} aria-label="Reset plugins on stop" />
      </SettingsRow>
    </SettingsGroup>
  );
}

/** The mode a clip with no stretch is stretched in, in the Playlist's Stretch mode (FL always Resamples). */
function StretchModeRow() {
  const mode = useMusicPreferences((s) => s.stretchMode);
  const setMode = useMusicPreferences((s) => s.setStretchMode);
  return (
    <SettingsRow
      title="Stretch mode"
      description="How an audio clip that isn't stretched yet is stretched when you drag its edge with the Playlist's Stretch on (Shift+M). Stretch keeps its pitch; Resample makes it higher when faster, as a record does."
    >
      <Select value={mode} onValueChange={(value) => isStretchMode(value) && setMode(value)}>
        <SelectTrigger size="sm" className="w-44" aria-label="Stretch mode">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {STRETCH_MODES.map((m) => (
            <SelectItem key={m} value={m}>
              {STRETCH_MODE_NAMES[m]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </SettingsRow>
  );
}

function DeviceSettings() {
  const [devices, setDevices] = useState<EngineDevices | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** macOS's answer for the microphone (the desktop app), or null where it can't be asked. */
  const [microphone, setMicrophone] = useState<string | null>(null);

  useEffect(() => {
    musicApi.devices().then((next) => {
      setDevices(next);
      useInputs.getState().take(next);
    }, (err) => setError(errorMessage(err)));
    void microphoneAccess()?.then(setMicrophone);
  }, []);

  const change = async (body: SetDeviceRequest) => {
    try {
      // Opening an input: Vaudio asks for the microphone first (macOS asks the app, not the engine).
      if (body.input) {
        const answer = await askMicrophone();
        if (answer !== undefined) setMicrophone(answer);
      }
      const next = await musicApi.setDevice(body);
      setDevices(next);
      useInputs.getState().take(next);
      setError(null);
      useTransport.setState({ latencyMs: next.status.outputLatencyMs });
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  if (!devices) {
    return (
      <SettingsGroup title="Audio">
        <SettingsRow title="Output" description={error ? <span className="text-destructive">{error}</span> : "Starting the audio engine…"} />
      </SettingsGroup>
    );
  }
  const { status } = devices;
  // Core Audio offers every size in steps of 32: the powers of two are the ones anyone picks.
  const bufferSizes = devices.bufferSizes.filter((size) => (size & (size - 1)) === 0 || size === status.bufferSize);
  const bufferMs = status.sampleRate > 0 ? (status.bufferSize / status.sampleRate) * 1000 : 0;
  return (
    <>
    <SettingsGroup title="Audio" description="Where the sound goes, and what's recorded. The engine plays through these devices whichever song is open." data-testid="device-settings">
      <SettingsRow title="Output device">
        <Select value={devices.output ?? ""} onValueChange={(output) => void change({ output })}>
          <SelectTrigger size="sm" className="w-64" aria-label="Output device">
            <SelectValue placeholder="No output device" />
          </SelectTrigger>
          <SelectContent>
            {devices.outputs.map((name) => (
              <SelectItem key={name} value={name}>
                {name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </SettingsRow>
      <SettingsRow
        title="Input device"
        description={
          // An engine built before recording knows nothing of inputs (the server keeps the engine it started).
          !devices.inputs ? (
            <span className="text-destructive">The audio engine is older than the app and can't record: run `pnpm engine:build`, then restart `pnpm dev`.</span>
          ) : microphone === "denied" || microphone === "restricted" ? (
            <span className="text-destructive">Vaudio can't hear your microphone: allow it in System Settings → Privacy &amp; Security → Microphone, then choose the input again.</span>
          ) : devices.input ? (
            `What mixer tracks record (their Input, in the Mixer): ${status.inputChannels ?? 0} input${status.inputChannels === 1 ? "" : "s"}, ${(status.inputLatencyMs ?? 0).toFixed(0)} ms late as the device reports it.`
          ) : (
            "To record: an audio interface, or the Mac's microphone (with headphones, so the song isn't recorded too)."
          )
        }
      >
        <Select value={devices.input ?? "none"} disabled={!devices.inputs} onValueChange={(input) => void change({ input: input === "none" ? "" : input })}>
          <SelectTrigger size="sm" className="w-64" aria-label="Input device">
            <SelectValue placeholder="No input" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">No input</SelectItem>
            {(devices.inputs ?? []).map((name) => (
              <SelectItem key={name} value={name}>
                {name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </SettingsRow>
      <SettingsRow
        title="Buffer length"
        description={`A smaller buffer answers faster but works the computer harder: ${bufferMs.toFixed(1)} ms of buffer, ${status.outputLatencyMs.toFixed(0)} ms until a sound is heard on this device.`}
      >
        <Select value={String(status.bufferSize)} onValueChange={(size) => void change({ bufferSize: Number(size) })}>
          <SelectTrigger size="sm" className="w-32" aria-label="Buffer size">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {bufferSizes.map((size) => (
              <SelectItem key={size} value={String(size)}>
                {size} samples
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </SettingsRow>
      <SettingsRow title="Sample rate" description="44.1 or 48 kHz suits most work; higher rates work the computer harder.">
        <Select value={String(status.sampleRate)} onValueChange={(rate) => void change({ sampleRate: Number(rate) })}>
          <SelectTrigger size="sm" className="w-32" aria-label="Sample rate">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {devices.sampleRates.map((rate) => (
              <SelectItem key={rate} value={String(rate)}>
                {rate / 1000} kHz
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </SettingsRow>
      {error && <p className="px-4 py-2 text-xs text-destructive">{error}</p>}
    </SettingsGroup>
    <MidiSettings devices={devices} change={change} />
    </>
  );
}

/**
 * MIDI keyboards (`docs/fl-studio/midi.md`): every one plugged in plays the channel selected in the
 * rack, unless it's turned off here (FL's MIDI settings, without its Enable step).
 */
function MidiSettings({ devices, change }: { devices: EngineDevices; change: (body: SetDeviceRequest) => Promise<void> }) {
  const inputs = devices.midiInputs;
  return (
    <SettingsGroup
      title="MIDI inputs"
      description="Keyboards and pads play the channel selected in the rack, and Record keeps what you play. Ctrl+T plays from the computer's keyboard instead."
      data-testid="midi-settings"
    >
      {!inputs ? (
        <SettingsRow title="No MIDI" description={<span className="text-destructive">The audio engine is older than the app: run `pnpm engine:build`, then restart `pnpm dev`.</span>} />
      ) : !inputs.length ? (
        <SettingsRow title="No MIDI keyboard" description="Plug one in: it's used at once, no need to come back here." />
      ) : (
        inputs.map((input) => (
          <SettingsRow key={input.id} title={input.name} description={input.enabled ? (input.open ? "Playing the selected channel." : "Couldn't be opened: another app may have it.") : "Turned off."}>
            <Switch checked={input.enabled} aria-label={`Use ${input.name}`} onCheckedChange={(enabled) => void change({ midiInput: { name: input.name, enabled } })} />
          </SettingsRow>
        ))
      )}
    </SettingsGroup>
  );
}
