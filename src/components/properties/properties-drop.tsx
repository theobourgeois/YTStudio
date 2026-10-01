import { type DragEvent, type ReactNode, useRef, useState } from "react";
import { PiSparkle } from "react-icons/pi";
import { dragKind, getEffectDragData, getPresetDragData } from "@/lib/dnd";
import { useEditor } from "@/stores/editor";

/**
 * The Properties panel as a drop target: a video effect or an effect preset dragged from the Effects
 * panel onto it goes on the clips it shows (the selection), as it would dropped on one of them on the
 * timeline or the canvas. (Transitions go on cuts, so they aren't taken here.)
 */
export function PropertiesDrop({ children }: { children: ReactNode }) {
  const count = useEditor((s) => (s.selectedTransition ? 0 : s.selectedClipIds.length));
  const [over, setOver] = useState(false);
  // dragenter/dragleave fire for every child crossed: count them to know when the drag really leaves.
  const depth = useRef(0);
  const takes = (e: DragEvent) => count > 0 && dragKind(e.dataTransfer) === "effect";

  return (
    <div
      className="relative flex min-h-0 flex-1 flex-col"
      data-properties-drop
      onDragEnter={(e) => {
        if (!takes(e)) return;
        depth.current += 1;
        setOver(true);
      }}
      onDragOver={(e) => {
        if (!takes(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
      }}
      onDragLeave={(e) => {
        if (!takes(e)) return;
        depth.current = Math.max(0, depth.current - 1);
        if (depth.current === 0) setOver(false);
      }}
      onDrop={(e) => {
        depth.current = 0;
        setOver(false);
        if (!takes(e)) return;
        e.preventDefault();
        const editor = useEditor.getState();
        const ids = editor.selectedClipIds;
        const preset = getPresetDragData(e.dataTransfer);
        const type = getEffectDragData(e.dataTransfer);
        if (preset) editor.addPresetAt(preset, { clipIds: ids });
        else if (type) editor.addEffectTo(ids, type);
      }}
    >
      {children}
      {over && (
        <div className="pointer-events-none absolute inset-1.5 z-30 flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-brand bg-brand/10 text-brand backdrop-blur-[2px]" data-testid="properties-drop">
          <PiSparkle className="size-6" />
          <span className="text-sm font-medium">{count === 1 ? "Drop to add to this clip" : `Drop to add to these ${count} clips`}</span>
        </div>
      )}
    </div>
  );
}
