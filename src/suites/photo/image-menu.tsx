/**
 * Photoshop's Image menu, in the menu bar: its Adjustments, each a window on the active layer that stays editable (a
 * filter on it, or an adjustment layer's settings).
 */
import { DropdownMenuItem, DropdownMenuLabel, DropdownMenuShortcut } from "@/components/ui/dropdown-menu";
import { hueSaturationActions } from "./hue-saturation/actions";
import { usePhotoUi } from "./ui";

export function ImageMenuItems() {
  const selected = usePhotoUi((s) => s.selectedLayerId !== null);
  return (
    <>
      <DropdownMenuLabel className="text-xs text-muted-foreground">Adjustments</DropdownMenuLabel>
      <DropdownMenuItem disabled={!selected} onSelect={() => hueSaturationActions.open()} data-hue-saturation-item>
        Hue/Saturation…
        <DropdownMenuShortcut>⌘U</DropdownMenuShortcut>
      </DropdownMenuItem>
    </>
  );
}
