/**
 * The photo editor's menus, in its menu row (`SuiteMenuBar`), Photoshop's: Image, Layer, Select and Filter its own.
 * Every item is a command its keys, the Layers panel's and the canvas's right-click menus run too.
 */
import type { ReactNode } from "react";
import { SuiteMenuBar } from "@/components/home/menu-bar";
import { DropdownMenuCheckboxItem, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuShortcut } from "@/components/ui/dropdown-menu";
import { actualPixels, fitToCanvas, zoomBy } from "./canvas/canvas-panel";
import { EditMenuItems } from "./edit-menu";
import { FilterMenuItems } from "./filters";
import { ImageMenuItems } from "./image-menu";
import { layerActions } from "./layer-actions";
import { usePhotoPreferences } from "./preferences";
import { SelectMenuItems } from "./select-commands";
import { usePhotoDoc } from "./store";
import { usePhotoUi } from "./ui";

/** `window`: the Window menu's items (the dock's panels, which the workspace keeps). */
export function PhotoMenus({ window }: { window: ReactNode }) {
  const snap = usePhotoPreferences((s) => s.snap);
  return (
    <SuiteMenuBar
      file={
        <DropdownMenuItem onSelect={() => usePhotoUi.getState().setExportOpen(true)}>
          Export… <DropdownMenuShortcut>⇧⌘E</DropdownMenuShortcut>
        </DropdownMenuItem>
      }
      edit={<EditMenuItems />}
      view={
        <>
          <DropdownMenuItem onSelect={() => zoomBy(2)}>
            Zoom In <DropdownMenuShortcut>⌘+</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => zoomBy(0.5)}>
            Zoom Out <DropdownMenuShortcut>⌘−</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={fitToCanvas}>
            Fit on Screen <DropdownMenuShortcut>⌘0</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={actualPixels}>
            100% <DropdownMenuShortcut>⌘1</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuCheckboxItem checked={snap} onCheckedChange={(on) => usePhotoPreferences.getState().setSnap(on)}>
            Snap <DropdownMenuShortcut>⇧⌘;</DropdownMenuShortcut>
          </DropdownMenuCheckboxItem>
        </>
      }
      menus={[
        { label: "Image", items: <ImageMenuItems /> },
        { label: "Layer", items: <LayerMenuItems /> },
        { label: "Select", items: <SelectMenuItems /> },
        { label: "Filter", items: <FilterMenuItems /> },
      ]}
      window={window}
    />
  );
}

/** Photoshop's Layer menu: the Layers panel's commands, on the selected layers. */
function LayerMenuItems() {
  const count = usePhotoUi((s) => s.selectedLayerIds.length);
  const total = usePhotoDoc((d) => d.layers.length);
  return (
    <>
      <DropdownMenuItem onSelect={() => layerActions.newLayer()}>
        New Layer <DropdownMenuShortcut>⇧⌘N</DropdownMenuShortcut>
      </DropdownMenuItem>
      <DropdownMenuItem disabled={count === 0} onSelect={layerActions.duplicate}>
        Duplicate {count > 1 ? "Layers" : "Layer"} <DropdownMenuShortcut>⌘J</DropdownMenuShortcut>
      </DropdownMenuItem>
      <DropdownMenuItem disabled={count === 0} onSelect={layerActions.delete}>
        Delete {count > 1 ? "Layers" : "Layer"} <DropdownMenuShortcut>⌫</DropdownMenuShortcut>
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem disabled={count === 0} onSelect={() => layerActions.blendingOptions()}>
        Layer Style…
      </DropdownMenuItem>
      <DropdownMenuItem disabled={count === 0} onSelect={() => void layerActions.addMask()}>
        Add Layer Mask
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem disabled={count === 0} onSelect={() => void layerActions.merge()}>
        {count > 1 ? "Merge Layers" : "Merge Down"} <DropdownMenuShortcut>⌘E</DropdownMenuShortcut>
      </DropdownMenuItem>
      <DropdownMenuItem disabled={total < 2} onSelect={() => void layerActions.mergeVisible()}>
        Merge Visible
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem disabled={count === 0} onSelect={() => layerActions.arrange("top")}>
        Bring to Front
      </DropdownMenuItem>
      <DropdownMenuItem disabled={count === 0} onSelect={() => layerActions.shift(1)}>
        Bring Forward <DropdownMenuShortcut>⌘]</DropdownMenuShortcut>
      </DropdownMenuItem>
      <DropdownMenuItem disabled={count === 0} onSelect={() => layerActions.shift(-1)}>
        Send Backward <DropdownMenuShortcut>⌘[</DropdownMenuShortcut>
      </DropdownMenuItem>
      <DropdownMenuItem disabled={count === 0} onSelect={() => layerActions.arrange("bottom")}>
        Send to Back
      </DropdownMenuItem>
    </>
  );
}
