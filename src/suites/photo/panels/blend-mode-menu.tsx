/**
 * The blend-mode menu (docs/photo/layer-style/README.md, phase L1): Photoshop's modes in its groups, and its live
 * preview: the mode under the pointer (or reached with the arrow keys) shows on the canvas at once, choosing one
 * keeps it, and closing without choosing puts back what was there (measured in Photoshop 27.11:
 * photoshop-measurements.md, "The Layers panel's mode menu"). The Layers panel and the Layer Style window use it.
 */
import { Fragment, useRef } from "react";
import { cn } from "cn";
import { PiCaretDown, PiCheck } from "react-icons/pi";
import { BLEND_MODES, blendModeInfo } from "@shared/photo/blending";
import type { BlendMode, PhotoProject } from "@shared/photo/types";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { photoGesture } from "../store";

export interface BlendModeMenuProps {
  value: BlendMode;
  label?: string;
  disabled?: boolean;
  className?: string;
  /** The menu opened (true) or closed (false); `chosen` is the mode picked, if one was. */
  onOpenChange?: (open: boolean, chosen: BlendMode | null) => void;
  /** The mode to show while it's under the pointer, or null when none is (the value shows again). */
  onPreview: (mode: BlendMode | null) => void;
  onChoose: (mode: BlendMode) => void;
}

export function BlendModeMenu({ value, label = "Blend mode", disabled, className, onOpenChange, onPreview, onChoose }: BlendModeMenuProps) {
  const chosen = useRef<BlendMode | null>(null);
  return (
    <DropdownMenu
      modal={false}
      onOpenChange={(open) => {
        if (open) chosen.current = null;
        else onPreview(null);
        onOpenChange?.(open, chosen.current);
      }}
    >
      <DropdownMenuTrigger asChild disabled={disabled}>
        <button
          type="button"
          aria-label={label}
          className={cn(
            "flex h-7 min-w-0 items-center justify-between gap-1 rounded border border-line bg-surface-0 px-2 text-left text-sm disabled:opacity-50 data-[state=open]:border-brand",
            className,
          )}
          data-blend-mode={value}
        >
          <span className="truncate">{blendModeInfo(value).label}</span>
          <PiCaretDown className="shrink-0 text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-[min(36rem,var(--radix-dropdown-menu-content-available-height))] w-52 overflow-y-auto" onPointerLeave={() => onPreview(null)} data-blend-menu>
        {BLEND_MODES.map((m, i) => (
          <Fragment key={m.id}>
            {i > 0 && BLEND_MODES[i - 1].group !== m.group && <DropdownMenuSeparator />}
            <DropdownMenuItem
              onFocus={() => onPreview(m.id)}
              onSelect={() => {
                chosen.current = m.id;
                onChoose(m.id);
              }}
              data-mode={m.id}
            >
              <PiCheck className={cn("shrink-0", m.id !== value && "invisible")} />
              {m.label}
            </DropdownMenuItem>
          </Fragment>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * The menu's preview on the open photo as one gesture: opening it begins one, each mode hovered previews on the
 * layers `ids`, choosing ends it (one undo step) and closing without a choice cancels it.
 */
export function useBlendModePreview(ids: () => readonly string[], edit: (ids: readonly string[], mode: BlendMode) => (doc: PhotoProject) => PhotoProject) {
  const gesture = useRef(photoGesture());
  const original = useRef<BlendMode | null>(null);
  return {
    onOpenChange(open: boolean, chosen: BlendMode | null, value: BlendMode) {
      if (open) {
        original.current = value;
        gesture.current.begin();
      } else if (!chosen) gesture.current.cancel();
    },
    onPreview(mode: BlendMode | null) {
      const shown = mode ?? original.current;
      if (shown && gesture.current.active) gesture.current.apply(edit(ids(), shown));
    },
    onChoose(mode: BlendMode) {
      gesture.current.apply(edit(ids(), mode));
      gesture.current.end();
    },
  };
}
