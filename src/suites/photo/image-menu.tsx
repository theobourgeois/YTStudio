/**
 * Photoshop's Image menu, in the header: its Adjustments, each a window on the active layer that stays editable (a
 * filter on it, or an adjustment layer's settings).
 */
import { PiCaretDown } from "react-icons/pi";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuShortcut, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { hueSaturationActions } from "./hue-saturation/actions";
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
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
