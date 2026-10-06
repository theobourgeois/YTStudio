/**
 * The canvas's right-click menu with a selection tool, or whenever there's a selection (Photoshop's): what's done
 * to and with the selection (Deselect, Select Inverse, Feather, Select Subject; Layer via Copy and Cut; Fill and
 * Clear; a mask from it), and with none, Select All and Select Subject.
 */
import type { ReactNode } from "react";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuShortcut, ContextMenuTrigger } from "@/components/ui/context-menu";
import { useColours } from "../colours";
import { editActions } from "../edit-actions";
import { layerActions } from "../layer-actions";
import { keys, runSelectSubject, useFeather } from "../select-commands";
import { selectActions } from "../selecting";
import { useSelection } from "../store";
import { type PhotoTool, isSelectionTool, usePhotoUi } from "../ui";

export function SelectionMenu({ tool, children }: { tool: PhotoTool; children: ReactNode }) {
  const selection = useSelection();
  const enabled = isSelectionTool(tool) || !!selection;
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild disabled={!enabled}>
        {children}
      </ContextMenuTrigger>
      <SelectionMenuItems />
    </ContextMenu>
  );
}

function SelectionMenuItems() {
  const selection = useSelection();
  const layerId = usePhotoUi((s) => s.selectedLayerId);
  if (!selection) {
    return (
      <ContextMenuContent className="w-56" data-selection-menu="none">
        <ContextMenuItem onSelect={selectActions.all}>
          Select All <ContextMenuShortcut>{keys("⌘A", "Ctrl+A")}</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => void runSelectSubject()}>Select Subject</ContextMenuItem>
      </ContextMenuContent>
    );
  }
  return (
    <ContextMenuContent className="w-60" data-selection-menu="selection">
      <ContextMenuItem onSelect={selectActions.deselect}>
        Deselect <ContextMenuShortcut>{keys("⌘D", "Ctrl+D")}</ContextMenuShortcut>
      </ContextMenuItem>
      <ContextMenuItem onSelect={selectActions.inverse}>
        Select Inverse <ContextMenuShortcut>{keys("⇧⌘I", "Shift+Ctrl+I")}</ContextMenuShortcut>
      </ContextMenuItem>
      <ContextMenuItem onSelect={() => useFeather.setState({ open: true })}>
        Feather… <ContextMenuShortcut>{keys("⇧F6", "Shift+F6")}</ContextMenuShortcut>
      </ContextMenuItem>
      <ContextMenuItem onSelect={() => void runSelectSubject("add")}>Add Subject</ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem disabled={!layerId} onSelect={() => void editActions.layerVia(false)}>
        Layer via Copy <ContextMenuShortcut>{keys("⌘J", "Ctrl+J")}</ContextMenuShortcut>
      </ContextMenuItem>
      <ContextMenuItem disabled={!layerId} onSelect={() => void editActions.layerVia(true)}>
        Layer via Cut <ContextMenuShortcut>{keys("⇧⌘J", "Shift+Ctrl+J")}</ContextMenuShortcut>
      </ContextMenuItem>
      <ContextMenuItem disabled={!layerId} onSelect={() => void layerActions.addMask(layerId, { replace: true })}>
        Mask from Selection
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem disabled={!layerId} onSelect={() => void editActions.fill(useColours.getState().foreground)}>
        Fill with Foreground <ContextMenuShortcut>{keys("⌥⌫", "Alt+Del")}</ContextMenuShortcut>
      </ContextMenuItem>
      <ContextMenuItem disabled={!layerId} onSelect={() => void editActions.fill(useColours.getState().background)}>
        Fill with Background <ContextMenuShortcut>{keys("⌘⌫", "Ctrl+Del")}</ContextMenuShortcut>
      </ContextMenuItem>
      <ContextMenuItem disabled={!layerId} onSelect={() => void editActions.fill(null)}>
        Clear <ContextMenuShortcut>⌫</ContextMenuShortcut>
      </ContextMenuItem>
    </ContextMenuContent>
  );
}
