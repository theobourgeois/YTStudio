import { cn } from "cn";
import { useRecording } from "../recording";
import { Led } from "./led";

/**
 * A mixer track's arm switch (FL Studio's small dot under the fader): lit red while it's armed, when
 * Record and Play record it. A track with no input can't be armed: a press says so.
 */
export function ArmButton({ trackId, name, size = 11, className }: { trackId: string; name: string; size?: number; className?: string }) {
  const armed = useRecording((s) => s.armed.includes(trackId));
  return (
    <button
      type="button"
      aria-label={armed ? `Disarm ${name}` : `Arm ${name} to record`}
      aria-pressed={armed}
      title={armed ? "Armed: Record and Play record its input (click to disarm)" : "Arm to record (its input: the Mixer's inspector)"}
      className={cn("group grid shrink-0 place-items-center rounded-full", className)}
      style={{ "--mixer-led": "var(--mixer-arm)" } as React.CSSProperties}
      onClick={() => useRecording.getState().arm(trackId)}
    >
      <Led on={armed} size={size} />
    </button>
  );
}
