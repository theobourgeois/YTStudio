import { useRef, useState } from "react";
import { PiSpeakerHigh } from "react-icons/pi";
import { updateChannel } from "@shared/music/edits";
import { DEFAULT_ENVELOPE } from "@shared/music/project";
import type { Channel, Envelope } from "@shared/music/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { SongKnob, percent, seconds, semitones } from "./knob";
import { useMusic } from "./store";
import { useTransport } from "./transport";

/** The envelope's knobs go to 3 s; the document allows more (for the assistant, or typed values later). */
const ENVELOPE_MAX = 3;
/** The pitch knob's reach, in semitones. */
const PITCH_RANGE = 24;

const ENVELOPE_KNOBS: { key: Exclude<keyof Envelope, "enabled">; label: string; max: number; format: (v: number) => string }[] = [
  { key: "attack", label: "Attack", max: ENVELOPE_MAX, format: seconds },
  { key: "decay", label: "Decay", max: ENVELOPE_MAX, format: seconds },
  { key: "sustain", label: "Sustain", max: 1, format: percent },
  { key: "release", label: "Release", max: ENVELOPE_MAX, format: seconds },
];

/** A sampler channel's settings (FL Studio's channel window), shown from its button in the rack. */
export function ChannelSettings({ channel }: { channel: Channel }) {
  const sampleName = useMusic((s) => s.assets.find((a) => a.id === channel.sampleId)?.name ?? null);
  const unreadable = useTransport((s) => s.unreadable.includes(channel.id));
  const [name, setName] = useState(channel.name);
  const file = useRef<HTMLInputElement>(null);
  const commit = useMusic.getState().commit;

  return (
    <div className="flex flex-col gap-3" data-testid="channel-settings">
      <div className="grid gap-1.5">
        <Label htmlFor={`name-${channel.id}`}>Name</Label>
        <Input
          id={`name-${channel.id}`}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => commit((song) => updateChannel(song, channel.id, { name }))}
          onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
        />
      </div>

      <div className="grid gap-1.5">
        <Label>Sample</Label>
        <div className="flex items-center gap-2">
          <p className="min-w-0 flex-1 truncate text-[13px] text-muted-foreground" title={sampleName ?? undefined}>
            {sampleName ?? "None"}
            {unreadable && <span className="text-destructive"> (can't be read)</span>}
          </p>
          <Button variant="outline" size="sm" disabled={!channel.sampleId} onClick={() => useTransport.getState().audition(channel.id)}>
            <PiSpeakerHigh />
            Hear
          </Button>
          <Button variant="outline" size="sm" onClick={() => file.current?.click()}>
            Replace
          </Button>
          <input
            ref={file}
            type="file"
            accept="audio/*"
            className="hidden"
            onChange={(e) => {
              const picked = e.target.files?.[0];
              if (picked) void useMusic.getState().replaceSample(channel.id, picked);
              e.target.value = "";
            }}
          />
        </div>
      </div>

      <div className="flex items-center gap-3">
        <SongKnob
          size={30}
          label="Pitch"
          value={channel.pitch}
          min={-PITCH_RANGE}
          max={PITCH_RANGE}
          defaultValue={0}
          bipolar
          format={semitones}
          // Whole semitones as the knob turns; Shift (a fine drag) keeps the cents.
          edit={(song, value) => updateChannel(song, channel.id, { pitch: Math.round(value) })}
        />
        <div className="text-[13px]">
          <p className="font-medium">Pitch</p>
          <p className="text-muted-foreground tabular-nums">{semitones(channel.pitch)}</p>
        </div>
      </div>

      <div className="rounded-lg border p-3">
        <label className="flex items-center gap-2 text-[13px] font-medium">
          <Switch
            checked={channel.envelope.enabled}
            onCheckedChange={(enabled) => commit((song) => updateChannel(song, channel.id, { envelope: { enabled } }))}
          />
          Volume envelope
        </label>
        <p className="mt-1 text-xs text-muted-foreground">
          {channel.envelope.enabled ? "A note sounds for its own length, then fades." : "Off: every note plays the whole sample."}
        </p>
        <div className="mt-3 flex justify-between" aria-disabled={!channel.envelope.enabled}>
          {ENVELOPE_KNOBS.map(({ key, label, max, format }) => (
            <div key={key} className={channel.envelope.enabled ? "flex flex-col items-center gap-1" : "pointer-events-none flex flex-col items-center gap-1 opacity-40"}>
              <SongKnob
                size={28}
                label={label}
                value={Math.min(channel.envelope[key], max)}
                min={0}
                max={max}
                defaultValue={DEFAULT_ENVELOPE[key]}
                format={format}
                edit={(song, value) => updateChannel(song, channel.id, { envelope: { [key]: value } })}
              />
              <span className="text-[10px] text-muted-foreground">{label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
