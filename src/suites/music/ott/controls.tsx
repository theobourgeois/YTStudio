/** OTT's knob, in our look: its name over it (or, inline, a letter beside it), automatable. */
import type { ReactNode } from "react";
import { cn } from "cn";
import type { AutomationTarget, MusicProject } from "@shared/music/types";
import { type ValueUnit, SongKnob } from "../knob";

/** A small engraved caption (Xfer's labels, ours). */
export function Caption({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn("text-[9px] leading-none font-semibold tracking-[0.08em] text-muted-foreground uppercase", className)}>{children}</span>;
}

interface OttKnobProps {
  label: string;
  /** What's printed with it (its label by default). */
  caption?: string;
  value: number;
  min: number;
  max: number;
  defaultValue: number;
  format: (value: number) => string;
  unit: ValueUnit;
  bipolar?: boolean;
  size?: number;
  target: AutomationTarget;
  /** It turns by its automation's fraction (Time's taper). */
  fraction?: boolean;
  edit: (song: MusicProject, value: number) => MusicProject;
  /** Its caption beside it rather than over it (the H / M / L gains). */
  inline?: boolean;
}

export function OttKnob({ caption, size = 40, inline, label, ...knob }: OttKnobProps) {
  return (
    <div className={cn("flex items-center", inline ? "flex-row gap-1" : "flex-col gap-1")} data-testid={`ott-knob-${label.toLowerCase().replace(/[^a-z]+/g, "-")}`}>
      {caption !== "" && <Caption className="text-foreground/80">{caption ?? label}</Caption>}
      <SongKnob size={size} label={label} {...knob} />
    </div>
  );
}
