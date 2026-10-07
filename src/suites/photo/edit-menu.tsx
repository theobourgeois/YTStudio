/**
 * Photoshop's Edit menu, in the header: undo, the clipboard, what fills the selection (Content-Aware Fill first,
 * then the colours and Clear), and Transform's flips and turns of the selected layers. Every item is a command the
 * keys and the canvas's right-click menu run too.
 */
import { PiCaretDown } from "react-icons/pi";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ORIENTATIONS, ORIENTATION_LABELS, type Orientation } from "@shared/photo/orient";
import { useColours } from "./colours";
import { runContentAwareFill, useContentAwareFill } from "./content-aware-fill";
import { editActions, hasPhotoClipboard } from "./edit-actions";
import { keys } from "./select-commands";
import { usePhoto, useSelection } from "./store";
import { transformActions } from "./transform-actions";
import type { TransformMode } from "./canvas/handles";
import { freeTransform } from "./free-transform";

/** Edit › Transform's modes: Free Transform started in each (its options bar switches between them). */
const TRANSFORM_MODES: [TransformMode, string][] = [
  ["scale", "Scale"],
  ["skew", "Skew"],
  ["distort", "Distort"],
  ["perspective", "Perspective"],
];
import { usePhotoUi } from "./ui";

/** The flips' keys (Théo's; Photoshop leaves them unset). */
const ORIENTATION_KEYS: Partial<Record<Orientation, string>> = { "flip-horizontal": keys("⌘H", "Ctrl+H"), "flip-vertical": keys("⌥⌘H", "Ctrl+Alt+H") };

export function EditMenu() {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" variant="ghost" data-edit-menu>
          Edit <PiCaretDown className="size-3 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-60">
        <EditMenuItems />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Read when the menu opens (what can be pasted isn't a store's). */
function EditMenuItems() {
  const selection = useSelection();
  const canUndo = usePhoto((s) => (s.history?.past.length ?? 0) > 0);
  const canRedo = usePhoto((s) => (s.history?.future.length ?? 0) > 0);
  const filling = useContentAwareFill((s) => s.running);
  const layers = usePhotoUi((s) => s.selectedLayerIds.length > 0);
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
      <DropdownMenuSeparator />
      <DropdownMenuItem disabled={!layers} onSelect={() => freeTransform.start()} data-free-transform-item>
        Free Transform <DropdownMenuShortcut>{keys("⌘T", "Ctrl+T")}</DropdownMenuShortcut>
      </DropdownMenuItem>
      <DropdownMenuSub>
        <DropdownMenuSubTrigger disabled={!layers} data-transform-menu>
          Transform
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent className="w-64">
          {TRANSFORM_MODES.map(([mode, label]) => (
            <DropdownMenuItem key={mode} onSelect={() => freeTransform.setMode(mode)} data-transform-mode-item={mode}>
              {label}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          {ORIENTATIONS.map((o) => (
            <div key={o}>
              {o === "flip-horizontal" && <DropdownMenuSeparator />}
              <DropdownMenuItem onSelect={() => transformActions.layers(o)} data-orient-layers={o}>
                {ORIENTATION_LABELS[o]}
                {ORIENTATION_KEYS[o] && <DropdownMenuShortcut>{ORIENTATION_KEYS[o]}</DropdownMenuShortcut>}
              </DropdownMenuItem>
            </div>
          ))}
        </DropdownMenuSubContent>
      </DropdownMenuSub>
    </>
  );
}
