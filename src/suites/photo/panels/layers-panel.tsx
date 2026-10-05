/**
 * The Layers panel (ux.md, "Workspace"): the stack, top first; click selects, the eye shows and hides, a
 * double-click renames. Missing and unreadable images are said so. Its footer places images, duplicates, moves and
 * deletes. Every change is an undoable edit.
 */
import { useRef, useState } from "react";
import { cn } from "cn";
import { PiArrowDown, PiArrowUp, PiCopy, PiEye, PiEyeSlash, PiImage, PiPlus, PiTrash, PiWarningCircle } from "react-icons/pi";
import { createId } from "@shared/ids";
import { duplicateLayer, moveLayer, removeLayer, updateLayer } from "@shared/photo/edits";
import type { PhotoLayer } from "@shared/photo/types";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useSourceStates } from "../live";
import { usePhoto, usePhotoDoc } from "../store";
import { usePhotoUi } from "../ui";

export function LayersPanel() {
  const layers = usePhotoDoc((d) => d.layers);
  const selected = usePhotoUi((s) => s.selectedLayerId);
  const input = useRef<HTMLInputElement>(null);
  const commit = usePhoto((s) => s.commit);
  const index = layers.findIndex((l) => l.id === selected);

  return (
    <div className="flex min-h-0 flex-1 flex-col text-sm" data-layers-panel>
      <ul className="min-h-0 flex-1 overflow-y-auto py-1">
        {[...layers].reverse().map((l) => (
          <LayerRow key={l.id} layer={l} selected={l.id === selected} />
        ))}
        {layers.length === 0 && <li className="px-3 py-6 text-center text-xs text-muted-foreground">No layers: place an image.</li>}
      </ul>
      <div className="flex shrink-0 items-center gap-0.5 border-t border-line px-1.5 py-1">
        <FooterButton label="Place an image…" onClick={() => input.current?.click()}>
          <PiPlus />
        </FooterButton>
        <input
          ref={input}
          type="file"
          multiple
          accept="image/png,image/jpeg,image/webp"
          className="hidden"
          data-place-input
          onChange={(e) => {
            const files = [...(e.target.files ?? [])];
            e.target.value = "";
            void usePhoto.getState().placeFiles(files).then((ids) => ids.length && usePhotoUi.getState().select(ids.at(-1)!));
          }}
        />
        <div className="flex-1" />
        <FooterButton label="Move up" disabled={index < 0 || index === layers.length - 1} onClick={() => selected && commit((d) => moveLayer(d, selected, index + 1))}>
          <PiArrowUp />
        </FooterButton>
        <FooterButton label="Move down" disabled={index <= 0} onClick={() => selected && commit((d) => moveLayer(d, selected, index - 1))}>
          <PiArrowDown />
        </FooterButton>
        <FooterButton
          label="Duplicate (⌘J)"
          disabled={index < 0}
          onClick={() => {
            if (!selected) return;
            const id = createId("layer");
            commit((d) => duplicateLayer(d, selected, id));
            usePhotoUi.getState().select(id);
          }}
        >
          <PiCopy />
        </FooterButton>
        <FooterButton label="Delete" disabled={index < 0} onClick={() => selected && commit((d) => removeLayer(d, selected))}>
          <PiTrash />
        </FooterButton>
      </div>
    </div>
  );
}

function FooterButton({ label, disabled, onClick, children }: { label: string; disabled?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={label} disabled={disabled} onClick={onClick}>
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

function LayerRow({ layer, selected }: { layer: PhotoLayer; selected: boolean }) {
  const asset = usePhoto((s) => s.assets.find((a) => a.id === layer.mediaId));
  const source = useSourceStates((s) => s.states[layer.mediaId]);
  const [renaming, setRenaming] = useState(false);
  const commit = usePhoto((s) => s.commit);
  return (
    <li
      className={cn("group flex h-9 cursor-default items-center gap-2 border-l-2 px-2", selected ? "border-brand bg-accent" : "border-transparent hover:bg-surface-2")}
      onPointerDown={() => usePhotoUi.getState().select(layer.id)}
      data-layer={layer.id}
      data-source={source?.state ?? "loading"}
      aria-selected={selected}
    >
      <button
        type="button"
        className="grid size-6 shrink-0 place-items-center rounded text-muted-foreground hover:text-foreground"
        aria-label={layer.visible ? "Hide" : "Show"}
        aria-pressed={layer.visible}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={() => commit((d) => updateLayer(d, layer.id, { visible: !layer.visible }))}
      >
        {layer.visible ? <PiEye /> : <PiEyeSlash />}
      </button>
      {asset?.poster ? (
        <img src={asset.poster} alt="" draggable={false} className="size-7 shrink-0 rounded-sm bg-surface-2 object-contain" />
      ) : (
        <PiImage className="size-7 shrink-0 text-muted-foreground" />
      )}
      {renaming ? (
        <input
          autoFocus
          defaultValue={layer.name}
          onFocus={(e) => e.currentTarget.select()}
          className="min-w-0 flex-1 rounded border border-line bg-surface-0 px-1 text-sm"
          onPointerDown={(e) => e.stopPropagation()}
          onBlur={(e) => {
            commit((d) => updateLayer(d, layer.id, { name: e.currentTarget.value }));
            setRenaming(false);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
            if (e.key === "Escape") setRenaming(false);
          }}
        />
      ) : (
        <span className={cn("min-w-0 flex-1 truncate", !layer.visible && "text-muted-foreground")} onDoubleClick={() => setRenaming(true)}>
          {layer.name}
        </span>
      )}
      {(!asset || source?.state === "failed") && (
        <Tooltip>
          <TooltipTrigger asChild>
            <PiWarningCircle className="shrink-0 text-destructive" aria-label={asset ? "Image unreadable" : "Image missing"} />
          </TooltipTrigger>
          <TooltipContent>{asset ? `Its image couldn't be read: ${source?.state === "failed" ? source.error : ""}` : "Its image isn't in the project any more."}</TooltipContent>
        </Tooltip>
      )}
    </li>
  );
}
