/** A text layer's thumbnail in Layers: a T, as Photoshop shows a type layer (double-clicked, it edits the words). */
import { PiTextT } from "react-icons/pi";

export function TextThumb() {
  return (
    <span className="grid size-8 shrink-0 place-items-center rounded-sm bg-surface-2 text-foreground" title="Text layer: double-click to edit its words" data-thumbnail="text">
      <PiTextT className="size-4.5" />
    </span>
  );
}
