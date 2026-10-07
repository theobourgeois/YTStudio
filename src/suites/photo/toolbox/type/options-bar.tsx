/**
 * The Type tool's options bar (Photoshop's, left to right: family, style, size, alignment, colour, the Character
 * panel; while typing, ✕ and ✓). It shows the text being typed, else the active text layer, else what new text is made
 * with; a change restyles the text typed, else every selected text layer (one undo step), else sets what new text is
 * made with (`session.ts`, `styleText`). The family hovered in its list shows on that text first (`previewText`).
 */
import { PiCheck, PiTextAa, PiTextAlignCenter, PiTextAlignJustify, PiTextAlignLeft, PiTextAlignRight, PiX } from "react-icons/pi";
import { cn } from "cn";
import { MAX_FONT_SIZE, MIN_FONT_SIZE, type TextPatch } from "@shared/photo/text";
import type { TextAlign, TextFont, TextLayer } from "@shared/photo/types";
import { ColorSwatchPicker } from "@/components/color-picker";
import { ScrubNumber } from "@/components/scrub-number";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useColours } from "../../colours";
import { usePhotoDoc } from "../../store";
import { usePhotoUi } from "../../ui";
import { CharacterControls } from "./character";
import { focusTypeEditor } from "./editor";
import { FontFamilyPicker, FontStylePicker, closestFace, faceFields } from "./font-picker";
import { useTypeOptions } from "./options";
import { beginStyling, cancelText, commitText, endStyling, previewText, styleText, useTypeSession } from "./session";

/** The text the options show: the one typed, else the active layer when it's text (null: none). */
export function useShownText(): TextLayer | null {
  const editing = useTypeSession((s) => s.editing?.layerId ?? null);
  const active = usePhotoUi((s) => s.selectedLayerId);
  const id = editing ?? active;
  const layer = usePhotoDoc((d) => d.layers.find((l) => l.id === id));
  return layer?.kind === "text" ? layer : null;
}

const SIZE = { min: MIN_FONT_SIZE, max: MAX_FONT_SIZE, step: 1, decimals: 1, unit: "px" };

export const ALIGNMENTS: { align: TextAlign; label: string; Icon: typeof PiTextAlignLeft }[] = [
  { align: "left", label: "Left align text", Icon: PiTextAlignLeft },
  { align: "center", label: "Centre text", Icon: PiTextAlignCenter },
  { align: "right", label: "Right align text", Icon: PiTextAlignRight },
  { align: "justify", label: "Justify (paragraph text; last line left)", Icon: PiTextAlignJustify },
];

/** A change from the bar: applied, then the keyboard back in the text being typed. */
const restyle = (patch: TextPatch) => {
  styleText(patch);
  focusTypeEditor();
};

/** A new family, keeping the style nearest the one there was. */
export const familyPatch = (family: string, font: TextFont): TextPatch => ({ font: { family, ...faceFields(closestFace(family, font)) } });

export function TypeOptionsBar() {
  const shown = useShownText();
  const defaults = useTypeOptions();
  const foreground = useColours((s) => s.foreground);
  const editing = useTypeSession((s) => s.editing !== null);
  const font = shown?.font ?? defaults.font;
  const align = shown?.align ?? defaults.align;
  const colour = shown?.colour ?? foreground;
  const values = shown ?? { font: defaults.font, leading: defaults.leading, tracking: defaults.tracking, ...defaults.character };
  return (
    <div className="flex shrink-0 items-center gap-3 text-xs whitespace-nowrap" data-tool-options="type">
      <span className="flex items-center gap-1.5">
        <FontFamilyPicker value={font.family} onChoose={(family) => restyle(familyPatch(family, font))} onPreview={(family) => previewText(family ? familyPatch(family, font) : null)} className="w-44" />
        <FontStylePicker family={font.family} value={font.style} onChoose={(face) => restyle({ font: faceFields(face) })} className="w-32" />
      </span>
      <span className="flex items-center gap-0.5" data-option="Size">
        <span className="text-muted-foreground">Size</span>
        <ScrubNumber label="Font size" value={font.size} display={SIZE} onBegin={beginStyling} onChange={(size) => styleText({ font: { size } })} onEnd={() => (endStyling(), focusTypeEditor())} />
      </span>
      <div className="flex items-center" role="group" aria-label="Alignment">
        {ALIGNMENTS.map(({ align: a, label, Icon }) => (
          <Tooltip key={a}>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={label}
                aria-pressed={align === a}
                disabled={a === "justify" && !!shown && !shown.box}
                className={cn(align === a && "bg-accent text-foreground")}
                onPointerDown={(e) => e.preventDefault()}
                onClick={() => restyle({ align: a })}
                data-text-align={a}
              >
                <Icon className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{label}</TooltipContent>
          </Tooltip>
        ))}
      </div>
      <span className="flex items-center gap-1" data-option="Colour">
        <span className="text-muted-foreground">Colour</span>
        <ColorSwatchPicker value={colour} label="Text colour" className="size-5" edit={{ begin: beginStyling, set: (hex) => styleText({ colour: hex }), end: () => (endStyling(), focusTypeEditor()) }} />
      </span>
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label="Character" title="Character: leading, tracking, kerning, scale, faux styles, caps, underline" data-option="Character">
            <PiTextAa className="size-4" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          className="w-80 p-2.5 text-xs"
          onOpenAutoFocus={(e) => e.preventDefault()}
          // Back to the words being typed, if they are.
          onCloseAutoFocus={(e) => {
            if (!useTypeSession.getState().editing) return;
            e.preventDefault();
            focusTypeEditor();
          }}
          data-character-popover
        >
          <CharacterControls values={values} set={(patch) => styleText(patch)} />
        </PopoverContent>
      </Popover>
      {editing && (
        <div className="flex items-center gap-0.5 border-l border-line pl-2">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label="Cancel the current edit" onPointerDown={(e) => e.preventDefault()} onClick={cancelText} data-type-cancel>
                <PiX className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Cancel the current edit</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label="Commit the current edit" onPointerDown={(e) => e.preventDefault()} onClick={commitText} data-type-commit>
                <PiCheck className="size-4 text-brand" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Commit the current edit (Esc, ⌘Enter)</TooltipContent>
          </Tooltip>
        </div>
      )}
    </div>
  );
}
