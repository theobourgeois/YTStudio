import type { ReactNode } from "react";
import { addTrack } from "@shared/timeline";
import { useSaveToLibrary } from "@/components/library/library-dialogs";
import { SuiteMenuBar } from "@/components/home/menu-bar";
import { DockMenuItems } from "@/components/dock/dock-area";
import {
  DropdownMenuCheckboxItem,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
} from "@/components/ui/dropdown-menu";
import { SHORTCUT_KEYS, type ShortcutAction } from "@/hooks/shortcuts";
import { runShortcut } from "@/hooks/use-shortcuts";
import { useCaptions } from "@/stores/captions";
import { useEditor } from "@/stores/editor";
import { VIDEO_WORKSPACES, useVideoDock } from "@/stores/video-dock";
import { useOpenVideoWindows } from "@/stores/video-windows";
import { VIDEO_PANEL_DEFS } from "./video-panels";

/** An item that runs a shortcut's action (`runShortcut`), showing its keys: the menu and the key are one command. */
function Action({ action, disabled, children }: { action: ShortcutAction; disabled?: boolean; children: ReactNode }) {
  return (
    <DropdownMenuItem disabled={disabled} onSelect={() => runShortcut(action)}>
      {children} <DropdownMenuShortcut>{SHORTCUT_KEYS[action]}</DropdownMenuShortcut>
    </DropdownMenuItem>
  );
}

const editor = () => useEditor.getState();

/** The video editor's menus, in the tab strip (`SuiteMenuBar`), Premiere's: Clip, Sequence and Markers its own. */
export function VideoMenus() {
  const canUndo = useEditor((s) => s.past.length > 0 && !s.gestureBase);
  const canRedo = useEditor((s) => s.future.length > 0 && !s.gestureBase);
  const selected = useEditor((s) => s.selectedClipIds.length > 0);
  const empty = useEditor((s) => s.document.clips.length === 0);
  const snapping = useEditor((s) => s.snapping);
  const autoRipple = useEditor((s) => s.autoRipple);

  return (
    <SuiteMenuBar
      file={
        <>
          <DropdownMenuItem disabled={empty} onSelect={() => useOpenVideoWindows.getState().show("export")}>
            Export…
          </DropdownMenuItem>
          <DropdownMenuItem disabled={!selected} onSelect={() => useSaveToLibrary.getState().open(editor().selectedClipIds)}>
            Save to Library…
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => useOpenVideoWindows.getState().show("settings")}>Video Settings…</DropdownMenuItem>
        </>
      }
      edit={
        <>
          <Action action="undo" disabled={!canUndo}>
            Undo
          </Action>
          <Action action="redo" disabled={!canRedo}>
            Redo
          </Action>
          <DropdownMenuSeparator />
          <Action action="cut" disabled={!selected}>
            Cut
          </Action>
          <Action action="copy">Copy</Action>
          <Action action="paste">Paste</Action>
          <Action action="duplicate" disabled={!selected}>
            Duplicate
          </Action>
          <Action action="delete">Delete</Action>
          <Action action="rippleDelete" disabled={!selected}>
            Ripple Delete
          </Action>
          <DropdownMenuSeparator />
          <Action action="selectAll">Select All</Action>
          <Action action="deselect">Deselect</Action>
        </>
      }
      view={
        <>
          <Action action="zoomIn">Zoom In</Action>
          <Action action="zoomOut">Zoom Out</Action>
          <Action action="zoomFit">Zoom to Fit</Action>
          <DropdownMenuSeparator />
          <DropdownMenuCheckboxItem checked={snapping} onCheckedChange={() => editor().toggleSnapping()}>
            Snapping <DropdownMenuShortcut>{SHORTCUT_KEYS.toggleSnapping}</DropdownMenuShortcut>
          </DropdownMenuCheckboxItem>
          <DropdownMenuCheckboxItem checked={autoRipple} onCheckedChange={() => editor().toggleAutoRipple()}>
            Auto Ripple
          </DropdownMenuCheckboxItem>
        </>
      }
      menus={[
        {
          label: "Clip",
          items: (
            <>
              <Action action="split">Split at Playhead</Action>
              <Action action="speed" disabled={!selected}>
                Speed/Duration…
              </Action>
              <Action action="nest" disabled={!selected}>
                Nest
              </Action>
              <DropdownMenuSeparator />
              <Action action="addTransition" disabled={!selected}>
                Add Transition
              </Action>
              <Action action="copyEffects" disabled={!selected}>
                Copy Effects
              </Action>
              <Action action="pasteEffects" disabled={!selected}>
                Paste Effects
              </Action>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => useCaptions.getState().openDialog()}>Auto Captions…</DropdownMenuItem>
            </>
          ),
        },
        {
          label: "Sequence",
          items: (
            <>
              <DropdownMenuItem onSelect={() => editor().commit((p) => addTrack(p, "video").project)}>Add Video Track</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => editor().commit((p) => addTrack(p, "audio").project)}>Add Audio Track</DropdownMenuItem>
              <DropdownMenuSeparator />
              <Action action="newAdjustmentLayer">New Adjustment Layer</Action>
              <Action action="newSolid">New Solid</Action>
              <Action action="newCamera">New Camera</Action>
              <DropdownMenuSeparator />
              <Action action="markIn">Mark In</Action>
              <Action action="markOut">Mark Out</Action>
              <Action action="clearMarks">Clear In and Out</Action>
            </>
          ),
        },
        {
          label: "Markers",
          items: (
            <>
              <Action action="addMarker">Add Marker</Action>
              <Action action="nextMarker">Go to Next Marker</Action>
              <Action action="prevMarker">Go to Previous Marker</Action>
              <Action action="deleteMarker">Clear Marker</Action>
            </>
          ),
        },
      ]}
      window={<DockMenuItems dock={useVideoDock} panels={VIDEO_PANEL_DEFS} workspaces={VIDEO_WORKSPACES} />}
    />
  );
}
