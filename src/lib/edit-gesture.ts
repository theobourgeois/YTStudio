import type { Project } from "@shared/types";
import { useEditor } from "@/stores/editor";

/**
 * A continuous edit (slider drag, scrubbing a value, dragging on the canvas)
 * recorded as one undo step: `begin`, `apply` any number of times, then `end`
 * or `cancel`. Outside a gesture (or once another edit has ended it), `apply`
 * commits on its own, so keyboard changes work with the same code.
 */
export class EditGesture {
  private id: number | null = null;

  /** This gesture is still the editor's active one. */
  get active(): boolean {
    const editor = useEditor.getState();
    return this.id !== null && editor.gestureId === this.id && editor.gestureBase !== null;
  }

  begin() {
    this.id = useEditor.getState().beginGesture();
  }

  apply(update: (p: Project) => Project) {
    if (this.active) useEditor.getState().preview(update);
    else useEditor.getState().commit(update);
  }

  end() {
    if (this.id === null) return;
    useEditor.getState().endGesture(this.id);
    this.id = null;
  }

  cancel() {
    if (this.id === null) return;
    useEditor.getState().cancelGesture(this.id);
    this.id = null;
  }
}
