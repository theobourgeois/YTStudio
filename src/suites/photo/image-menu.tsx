/**
 * Photoshop's Image menu, in the header: its Adjustments, each a window on the active layer that stays editable (a
 * filter on it, or an adjustment layer's settings), and Image Rotation (the whole canvas flipped or turned).
 */
import { PiCaretDown } from "react-icons/pi";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ORIENTATIONS, canvasOrientationLabel } from "@shared/photo/orient";
import { hueSaturationActions } from "./hue-saturation/actions";
import { transformActions } from "./transform-actions";
import { usePhotoUi } from "./ui";

const MAC = typeof navigator !== "undefined" && /Mac/.test(navigator.platform);

export function ImageMenu() {
  const selected = usePhotoUi((s) => s.selectedLayerId !== null);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" variant="ghost" data-image-menu>
          Image <PiCaretDown className="size-3 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuLabel className="text-xs text-muted-foreground">Adjustments</DropdownMenuLabel>
        <DropdownMenuItem disabled={!selected} onSelect={() => hueSaturationActions.open()} data-hue-saturation-item>
          Hue/Saturation…
          <DropdownMenuShortcut>{MAC ? "⌘U" : "Ctrl+U"}</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuSub>
          <DropdownMenuSubTrigger data-image-rotation-menu>Image Rotation</DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-52">
            {ORIENTATIONS.map((o) => (
              <div key={o}>
                {o === "flip-horizontal" && <DropdownMenuSeparator />}
                <DropdownMenuItem onSelect={() => void transformActions.canvas(o)} data-orient-canvas={o}>
                  {canvasOrientationLabel(o)}
                </DropdownMenuItem>
              </div>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
