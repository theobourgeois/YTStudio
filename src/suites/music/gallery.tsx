import { useState } from "react";
import { ContextMenuItem } from "@/components/ui/context-menu";
import type { GallerySection } from "@/gallery/types";
import { Knob, PERCENT, SEMITONES, panText, percent, semitones } from "./knob";
import { Lcd } from "./lcd";
import { Fader } from "./mixer/fader";
import { ModeLights } from "./mode-switch";

/** A knob with a value of its own (nothing in the song). */
function LooseKnob(props: Omit<React.ComponentProps<typeof Knob>, "value" | "onBegin" | "onDrag" | "onEnd" | "onCancel" | "onSet"> & { initial: number }) {
  const { initial, ...knob } = props;
  const [value, setValue] = useState(initial);
  const noop = () => {};
  return <Knob {...knob} value={value} onBegin={noop} onDrag={setValue} onEnd={noop} onCancel={noop} onSet={setValue} />;
}

function LooseLcd({ initial, derived }: { initial: number; derived?: boolean }) {
  const [value, setValue] = useState(initial);
  const noop = () => {};
  return (
    <Lcd
      value={value}
      min={1}
      max={64}
      label="Pattern length"
      derived={derived}
      menu={<ContextMenuItem>Auto</ContextMenuItem>}
      onBegin={noop}
      onChange={setValue}
      onEnd={noop}
      onCancel={noop}
    />
  );
}

/** A fader with a value of its own. */
function LooseFader({ initial, selected }: { initial: number; selected?: boolean }) {
  const [value, setValue] = useState(initial);
  const noop = () => {};
  return <Fader className="h-28" label="Volume" value={value} selected={selected} onBegin={noop} onDrag={setValue} onEnd={noop} onCancel={noop} onSet={setValue} />;
}

function LooseModeLights() {
  const [mode, setMode] = useState<"pattern" | "song">("song");
  return <ModeLights mode={mode} onChange={setMode} />;
}

function Controls() {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-4">
        <span className="w-28 text-xs text-muted-foreground">knobs</span>
        <LooseKnob initial={0.78} min={0} max={1} defaultValue={0.78} label="Volume" format={percent} unit={PERCENT} />
        <LooseKnob initial={-0.4} min={-1} max={1} defaultValue={0} label="Pan" format={panText} unit={PERCENT} bipolar />
        <LooseKnob initial={0} min={-24} max={24} defaultValue={0} label="Pitch" format={semitones} unit={SEMITONES} bipolar />
        <LooseKnob initial={0.3} min={0} max={1} defaultValue={0} label="Big" format={percent} unit={PERCENT} size={36} />
      </div>
      <div className="flex items-center gap-4">
        <span className="w-28 text-xs text-muted-foreground">LCDs</span>
        <LooseLcd initial={16} />
        <LooseLcd initial={4} derived />
      </div>
      <div className="flex items-center gap-4">
        <span className="w-28 text-xs text-muted-foreground">PAT / SONG</span>
        <LooseModeLights />
      </div>
      <div className="flex items-center gap-4">
        <span className="w-28 text-xs text-muted-foreground">mixer faders</span>
        <LooseFader initial={0.8} />
        <LooseFader initial={0.4} selected />
        <LooseFader initial={1} />
      </div>
    </div>
  );
}

/** The music suite's controls, for the component gallery (`src/gallery/`). */
export const MUSIC_SECTIONS: GallerySection[] = [
  { id: "music-controls", title: "Music: knobs, LCDs, PAT / SONG and faders", source: "suites/music/knob.tsx, lcd.tsx, mode-switch.tsx, mixer/fader.tsx", render: () => <Controls /> },
];
