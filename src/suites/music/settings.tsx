import { useEffect, useState } from "react";
import { errorMessage } from "@shared/errors";
import type { EngineDevices, SetDeviceRequest } from "@shared/music/engine";
import { SettingsGroup, SettingsRow } from "@/components/settings/settings-ui";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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
    </SettingsGroup>
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
          microphone === "denied" || microphone === "restricted" ? (
            <span className="text-destructive">Vaudio can't hear your microphone: allow it in System Settings → Privacy &amp; Security → Microphone, then choose the input again.</span>
          ) : devices.input ? (
            `What mixer tracks record (their Input, in the Mixer): ${status.inputChannels} input${status.inputChannels === 1 ? "" : "s"}, ${status.inputLatencyMs.toFixed(0)} ms late as the device reports it.`
          ) : (
            "To record: an audio interface, or the Mac's microphone (with headphones, so the song isn't recorded too)."
          )
        }
      >
        <Select value={devices.input ?? "none"} onValueChange={(input) => void change({ input: input === "none" ? "" : input })}>
          <SelectTrigger size="sm" className="w-64" aria-label="Input device">
            <SelectValue placeholder="No input" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">No input</SelectItem>
            {devices.inputs.map((name) => (
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
  );
}
