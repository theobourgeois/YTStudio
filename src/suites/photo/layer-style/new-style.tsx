/**
 * New Style… (Photoshop's; dialog.md, "Styles presets"): the active layer's style kept as one of this computer's,
 * with a Name, Include Layer Effects and Include Layer Blending Options, and the style's swatch. A popover over the
 * button that opens it: the Styles panel's +, or the Layer Style window's New Style… (which keeps what it shows).
 */
import { useState } from "react";
import { toast } from "sonner";
import type { PhotoLayer } from "@shared/photo/types";
import { presetFrom } from "@shared/photo/style/presets";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { StyleSwatch } from "../panels/styles-panel";
import { usePhoto } from "../store";
import { newStyle, useStyles } from "./styles";

export function NewStyleForm({ open, onOpenChange, layer, children }: { open: boolean; onOpenChange: (open: boolean) => void; layer: () => PhotoLayer | null; children: React.ReactNode }) {
  const [name, setName] = useState("");
  const [effects, setEffects] = useState(true);
  const [blending, setBlending] = useState(false);
  const shown = open ? layer() : null;
  const save = async () => {
    const doc = usePhoto.getState().history?.doc.doc;
    if (!doc || !shown) return;
    try {
      const kept = await newStyle(doc, shown, name || `Style ${useStyles.getState().mine.length + 1}`, blending, effects);
      toast.success(`Kept the style “${kept.name}”`, { description: "It's in the Styles panel, on this computer." });
      onOpenChange(false);
      setName("");
    } catch (error) {
      toast.error("Couldn't keep the style", { description: error instanceof Error ? error.message : String(error) });
    }
  };
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent align="end" className="w-64 p-3 text-sm" data-new-style>
        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <span className="font-medium">New Style</span>
          <div className="flex items-start gap-2">
            {shown && <StyleSwatch preset={presetFrom("preview", name, shown, blending, effects)} size={48} />}
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" aria-label="Style name" className="h-7" autoFocus />
              <label className="flex items-center gap-1.5 text-xs">
                <input type="checkbox" checked={effects} onChange={(e) => setEffects(e.target.checked)} className="accent-[var(--brand)]" />
                Include Layer Effects
              </label>
              <label className="flex items-center gap-1.5 text-xs">
                <input type="checkbox" checked={blending} onChange={(e) => setBlending(e.target.checked)} className="accent-[var(--brand)]" />
                Include Layer Blending Options
              </label>
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" size="sm" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={!shown || (!effects && !blending)}>
              OK
            </Button>
          </div>
        </form>
      </PopoverContent>
    </Popover>
  );
}
