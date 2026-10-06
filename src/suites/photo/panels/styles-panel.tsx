/**
 * The Styles panel (Photoshop's Window › Styles; docs/photo/layer-style/dialog.md, "Styles presets"): the built-in
 * styles, then this computer's own, each a swatch the real renderer draws. Hovering one shows it on the selected
 * layers (nothing in undo); a click applies it, replacing their style, and ⇧-click adds its effects to theirs (one
 * undo step). + is New Style… from the active layer; the user's own rename and delete from their menu.
 */
import { useRef, useState } from "react";
import { PiPlus } from "react-icons/pi";
import { cn } from "cn";
import { type StylePreset, presetStyle } from "@shared/photo/style/presets";
import { findLayer } from "@shared/photo/edits";
import type { PhotoProject } from "@shared/photo/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from "@/components/ui/context-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { BUILT_IN_STYLES } from "@shared/photo/style/presets";
import { NewStyleForm } from "../layer-style/new-style";
import { applyStyle, materialise, styleEdit, useStyles } from "../layer-style/styles";
import { photoGesture, usePhoto } from "../store";
import { usePhotoUi } from "../ui";
import { useRendered } from "./thumbnails";

/** A style's swatch: its effects on a rounded square, drawn by the renderer. */
export function StyleSwatch({ preset, size = 44, className }: { preset: StylePreset; size?: number; className?: string }) {
  const url = useRendered(
    true,
    async (renderer) => {
      const patterns = await materialise(preset);
      return renderer.stylePicture(presetStyle(preset), preset.blending ?? {}, patterns, size * 2);
    },
    // By what it draws (a preview's preset is made afresh each render).
    [JSON.stringify([preset.effects, preset.blending ?? null, preset.patterns?.map((p) => p.png.length) ?? null, size])],
  );
  return <span className={cn("block shrink-0 rounded-sm bg-white bg-cover", className)} style={{ width: size, height: size, backgroundImage: url ? `url(${url})` : undefined }} aria-hidden />;
}

/** Hover previews: a gesture over the selected layers while the pointer is on the swatches, cancelled when it leaves. */
function useStylePreview() {
  const gesture = useRef(photoGesture());
  const base = useRef<PhotoProject | null>(null);
  const targets = () => usePhotoUi.getState().selectedLayerIds;
  return {
    preview(preset: StylePreset | null, add: boolean) {
      const g = gesture.current;
      // A style that carries patterns of its own previews once they're in the photo (applying brings them).
      if (!preset || preset.patterns?.length || !targets().length) {
        if (g.active && base.current) g.apply(() => base.current!);
        return;
      }
      if (!g.active) {
        g.begin();
        base.current = usePhoto.getState().history?.doc.doc ?? null;
      }
      const from = base.current;
      if (from) g.apply(() => styleEdit(preset, targets(), add, [])(from));
    },
    leave() {
      if (gesture.current.active) gesture.current.cancel();
      base.current = null;
    },
    async choose(preset: StylePreset, add: boolean) {
      if (gesture.current.active) gesture.current.cancel();
      base.current = null;
      await applyStyle(preset, targets(), add);
    },
  };
}

export function StylesPanel() {
  const mine = useStyles((s) => s.mine);
  const selected = usePhotoUi((s) => s.selectedLayerIds.length);
  const preview = useStylePreview();
  const [making, setMaking] = useState(false);
  const [renaming, setRenaming] = useState<StylePreset | null>(null);
  const all = [...BUILT_IN_STYLES, ...mine];
  return (
    <div className="flex h-full min-h-0 flex-col" data-styles-panel>
      <div className="flex min-h-0 flex-1 flex-wrap content-start gap-1.5 overflow-y-auto p-2" onPointerLeave={() => preview.leave()}>
        {all.map((preset) => {
          const own = !preset.id.startsWith("builtin:");
          const swatch = (
            <button
              type="button"
              aria-label={preset.name}
              data-style-preset={preset.id}
              disabled={!selected}
              className="rounded-sm border border-line p-px outline-none hover:border-brand focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-50"
              onPointerEnter={(e) => preview.preview(preset, e.shiftKey)}
              onClick={(e) => void preview.choose(preset, e.shiftKey)}
            >
              <StyleSwatch preset={preset} />
            </button>
          );
          return (
            <Tooltip key={preset.id}>
              <TooltipTrigger asChild>
                {own ? (
                  <span>
                    <ContextMenu>
                      <ContextMenuTrigger asChild>{swatch}</ContextMenuTrigger>
                      <ContextMenuContent>
                        <ContextMenuItem onSelect={() => setRenaming(preset)}>Rename Style…</ContextMenuItem>
                        <ContextMenuItem onSelect={() => useStyles.getState().remove(preset.id)}>Delete Style</ContextMenuItem>
                      </ContextMenuContent>
                    </ContextMenu>
                  </span>
                ) : (
                  swatch
                )}
              </TooltipTrigger>
              <TooltipContent side="bottom">
                {preset.name}
                <span className="block text-muted-foreground">Click: replace the style. ⇧-click: add its effects.</span>
              </TooltipContent>
            </Tooltip>
          );
        })}
      </div>
      {renaming && (
        <form
          className="flex items-center gap-1 border-t border-line p-1"
          onSubmit={(e) => {
            e.preventDefault();
            const name = new FormData(e.currentTarget).get("name");
            if (typeof name === "string") useStyles.getState().rename(renaming.id, name);
            setRenaming(null);
          }}
        >
          <Input name="name" defaultValue={renaming.name} aria-label="Style name" className="h-7 flex-1" autoFocus onKeyDown={(e) => e.key === "Escape" && setRenaming(null)} />
          <Button type="submit" size="sm" className="h-7">
            Rename
          </Button>
        </form>
      )}
      <div className="flex items-center gap-1 border-t border-line p-1">
        <span className="flex-1 px-1 text-xs text-muted-foreground">{selected ? "" : "Select a layer to style it."}</span>
        <NewStyleForm
          open={making}
          onOpenChange={setMaking}
          layer={() => {
            const ui = usePhotoUi.getState();
            const doc = usePhoto.getState().history?.doc.doc;
            return doc && ui.selectedLayerId ? (findLayer(doc, ui.selectedLayerId) ?? null) : null;
          }}
        >
          <Button variant="ghost" size="icon-sm" aria-label="New Style" disabled={!selected}>
            <PiPlus />
          </Button>
        </NewStyleForm>
      </div>
    </div>
  );
}
