/**
 * Photoshop's Edit menu, in the menu bar: undo, the clipboard, and what fills the selection (Content-Aware Fill first,
 * then the colours and Clear). Every item is a command the keys and the canvas's right-click menu run too.
 */
import { DropdownMenuItem, DropdownMenuSeparator, DropdownMenuShortcut } from "@/components/ui/dropdown-menu";
import { useColours } from "./colours";
import { runContentAwareFill, useContentAwareFill } from "./content-aware-fill";
import { editActions, hasPhotoClipboard } from "./edit-actions";
import { keys } from "./select-commands";
import { usePhoto, useSelection } from "./store";

/** Read when the menu opens (what can be pasted isn't a store's). */
export function EditMenuItems() {
  const selection = useSelection();
  const canUndo = usePhoto((s) => (s.history?.past.length ?? 0) > 0);
  const canRedo = usePhoto((s) => (s.history?.future.length ?? 0) > 0);
  const filling = useContentAwareFill((s) => s.running);
  return (
    <>
      <DropdownMenuItem disabled={!canUndo} onSelect={() => usePhoto.getState().undo()}>
        Undo <DropdownMenuShortcut>{keys("⌘Z", "Ctrl+Z")}</DropdownMenuShortcut>
      </DropdownMenuItem>
      <DropdownMenuItem disabled={!canRedo} onSelect={() => usePhoto.getState().redo()}>
        Redo <DropdownMenuShortcut>{keys("⇧⌘Z", "Ctrl+Y")}</DropdownMenuShortcut>
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem onSelect={() => void editActions.cut()}>
        Cut <DropdownMenuShortcut>{keys("⌘X", "Ctrl+X")}</DropdownMenuShortcut>
      </DropdownMenuItem>
      <DropdownMenuItem onSelect={() => void editActions.copy()}>
        Copy <DropdownMenuShortcut>{keys("⌘C", "Ctrl+C")}</DropdownMenuShortcut>
      </DropdownMenuItem>
      <DropdownMenuItem disabled={!hasPhotoClipboard()} onSelect={() => void editActions.paste()}>
        Paste <DropdownMenuShortcut>{keys("⌘V", "Ctrl+V")}</DropdownMenuShortcut>
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem disabled={!selection || filling} onSelect={() => void runContentAwareFill()} data-content-aware-fill>
        Content-Aware Fill <DropdownMenuShortcut>{keys("⇧⌫", "Shift+Del")}</DropdownMenuShortcut>
      </DropdownMenuItem>
      <DropdownMenuItem disabled={!selection} onSelect={() => void editActions.fill(useColours.getState().foreground)}>
        Fill with Foreground <DropdownMenuShortcut>{keys("⌥⌫", "Alt+Del")}</DropdownMenuShortcut>
      </DropdownMenuItem>
      <DropdownMenuItem disabled={!selection} onSelect={() => void editActions.fill(useColours.getState().background)}>
        Fill with Background <DropdownMenuShortcut>{keys("⌘⌫", "Ctrl+Del")}</DropdownMenuShortcut>
      </DropdownMenuItem>
      <DropdownMenuItem disabled={!selection} onSelect={() => void editActions.fill(null)}>
        Clear <DropdownMenuShortcut>⌫</DropdownMenuShortcut>
      </DropdownMenuItem>
    </>
  );
}
