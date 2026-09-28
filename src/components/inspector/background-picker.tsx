import { useEffect, useRef } from "react";
import { Pipette } from "lucide-react";
import { cn } from "@/lib/utils";
import { useEditor } from "@/stores/editor";

const SWATCHES = [
  { value: "#000000", name: "Black" },
  { value: "#ffffff", name: "White" },
  { value: "#27272a", name: "Graphite" },
  { value: "#1e3a5f", name: "Navy" },
  { value: "#f3ede2", name: "Cream" },
  { value: "#e11d48", name: "Rose" },
];

const swatchClass =
  "relative size-7 shrink-0 rounded-full border border-black/10 outline-none transition-shadow focus-visible:ring-2 focus-visible:ring-ring dark:border-white/15";
const selectedClass = "ring-2 ring-brand ring-offset-2 ring-offset-card";

/** Canvas background: preset swatches plus the native colour picker. */
export function BackgroundPicker() {
  const background = useEditor((s) => s.project.settings.background);
  const inputRef = useRef<HTMLInputElement>(null);
  const isPreset = SWATCHES.some((s) => s.value === background.toLowerCase());

  // Dragging inside the native picker fires `input` continuously; treat it as one
  // gesture that ends on `change` (picker closed) or blur.
  const gesture = useRef<number | null>(null);
  const endPicking = () => {
    if (gesture.current === null) return;
    useEditor.getState().endGesture(gesture.current);
    gesture.current = null;
  };
  useEffect(() => {
    const input = inputRef.current!;
    input.addEventListener("change", endPicking);
    return () => {
      input.removeEventListener("change", endPicking);
      endPicking();
    };
  }, []);

  const pick = (value: string) => {
    const editor = useEditor.getState();
    // (Re)start our gesture if we don't own the active one — another edit may have ended it.
    if (gesture.current === null || editor.gestureId !== gesture.current || !editor.gestureBase) {
      gesture.current = editor.beginGesture();
    }
    useEditor.getState().preview((p) => ({ ...p, settings: { ...p.settings, background: value } }));
  };

  return (
    <div className="flex items-center gap-2">
      {SWATCHES.map((s) => (
        <button
          key={s.value}
          type="button"
          title={s.name}
          aria-label={`${s.name} background`}
          aria-pressed={s.value === background.toLowerCase()}
          className={cn(swatchClass, s.value === background.toLowerCase() && selectedClass)}
          style={{ background: s.value }}
          onClick={() => useEditor.getState().updateSettings({ background: s.value })}
        />
      ))}
      <label
        title="Custom colour"
        className={cn(
          swatchClass,
          "flex cursor-pointer items-center justify-center focus-within:ring-2 focus-within:ring-ring",
          !isPreset && selectedClass,
        )}
        style={{
          background: isPreset
            ? "conic-gradient(from 180deg, #f43f5e, #f59e0b, #84cc16, #06b6d4, #6366f1, #d946ef, #f43f5e)"
            : background,
        }}
      >
        {isPreset && <Pipette className="size-3.5 text-white drop-shadow" />}
        <input
          ref={inputRef}
          type="color"
          aria-label="Custom background colour"
          className="absolute inset-0 size-full cursor-pointer opacity-0"
          value={background}
          onChange={(e) => pick(e.target.value)}
          onBlur={endPicking}
        />
      </label>
    </div>
  );
}
