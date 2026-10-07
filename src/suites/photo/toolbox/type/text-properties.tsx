/**
 * A text layer's Character and Paragraph sections in Properties (Photoshop's panels, the whole layer's setting:
 * docs/photo/tools/type.md): family (hovered: shown on the layer first), style, size, colour, and the Character
 * panel's leading, tracking, kerning, scales and type buttons (`character.tsx`); alignment, point or paragraph text,
 * and the box's size. Each change is one undo step (while it's typed: part of that step).
 */
import type { TextLayer } from "@shared/photo/types";
import { ColorSwatchPicker } from "@/components/color-picker";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { NumberField } from "../../panels/fields";
import { CharacterControls } from "./character";
import { FontFamilyPicker, FontStylePicker, faceFields } from "./font-picker";
import { ALIGNMENTS, familyPatch } from "./options-bar";
import { beginStyling, endStyling, previewText, styleText } from "./session";

const round = (n: number) => Math.round(n * 100) / 100;

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2" data-text-section={title}>
      <header className="flex h-6 items-center">
        <h3 className="min-w-0 flex-1 truncate text-xs font-medium uppercase tracking-wide text-muted-foreground">{title}</h3>
      </header>
      {children}
    </section>
  );
}

export function TextProperties({ layer }: { layer: TextLayer }) {
  const set = (patch: Parameters<typeof styleText>[0]) => styleText(patch, [layer.id]);
  const { font } = layer;
  return (
    <>
      <Section title="Character">
        <div className="flex flex-col gap-2" data-character-properties>
          <FontFamilyPicker value={font.family} onChoose={(family) => set(familyPatch(family, font))} onPreview={(family) => previewText(family ? familyPatch(family, font) : null, [layer.id])} className="h-7 w-full" />
          <div className="grid grid-cols-[1fr_auto] items-end gap-2">
            <FontStylePicker family={font.family} value={font.style} onChoose={(face) => set({ font: faceFields(face) })} className="h-7 w-full" />
            <ColorSwatchPicker value={layer.colour} label="Text colour" className="size-7" edit={{ begin: beginStyling, set: (colour) => styleText({ colour }, [layer.id]), end: endStyling }} />
          </div>
          <CharacterControls values={layer} set={set} withSize />
        </div>
      </Section>
      <Section title="Paragraph">
        <div className="flex flex-col gap-2" data-paragraph-properties>
          <div className="flex items-center gap-2">
            <ToggleGroup type="single" size="sm" variant="outline" value={layer.align} onValueChange={(v) => v && set({ align: v as TextLayer["align"] })} aria-label="Alignment">
              {ALIGNMENTS.map(({ align, label, Icon }) => (
                <ToggleGroupItem key={align} value={align} aria-label={label} title={label} disabled={align === "justify" && !layer.box}>
                  <Icon />
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
            <ToggleGroup
              type="single"
              size="sm"
              variant="outline"
              value={layer.box ? "paragraph" : "point"}
              onValueChange={(v) => {
                if (v === "point") set({ box: null, ...(layer.align === "justify" ? { align: "left" } : {}) });
                else if (v === "paragraph") set({ box: { width: Math.ceil(layer.size.width), height: Math.ceil(layer.size.height) } });
              }}
              aria-label="Kind of text"
              className="ml-auto"
            >
              <ToggleGroupItem value="point" title="Point text: lines grow from where it was clicked">
                Point
              </ToggleGroupItem>
              <ToggleGroupItem value="paragraph" title="Paragraph text: words wrap in a box">
                Box
              </ToggleGroupItem>
            </ToggleGroup>
          </div>
          {layer.box && (
            <div className="grid grid-cols-2 gap-2">
              <NumberField label="Box W" value={round(layer.box.width)} onCommit={(width) => set({ box: { width: Math.max(1, width), height: layer.box!.height } })} suffix="px" />
              <NumberField label="Box H" value={round(layer.box.height)} onCommit={(height) => set({ box: { width: layer.box!.width, height: Math.max(1, height) } })} suffix="px" />
            </div>
          )}
        </div>
      </Section>
    </>
  );
}
