import { useRef, useState, type ReactNode } from "react";
import { Popover as PopoverPrimitive } from "radix-ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent } from "@/components/ui/popover";
import { ColorSwatches } from "./color-swatches";

/** Name and colour are one edit. Enter/click-away saves; Escape/Cancel discards both. */
export function NameColorEditor({ name, color, label, children, onSave, onClose }: {
  name: string; color: string | null; label: string; children: ReactNode;
  onSave: (name: string, color: string | null) => void; onClose: () => void;
}) {
  const [value, setValue] = useState(name);
  const [swatch, setSwatch] = useState(color);
  const finished = useRef(false);
  const done = (save: boolean) => {
    if (finished.current) return;
    finished.current = true;
    if (save) onSave(value, swatch);
    onClose();
  };
  return (
    <Popover open onOpenChange={(open) => !open && done(true)}>
      <PopoverPrimitive.Anchor asChild>{children}</PopoverPrimitive.Anchor>
      <PopoverContent side="right" align="start" className="w-60" aria-label="Rename and color"
        onPointerDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}
        onEscapeKeyDown={() => done(false)}>
        <form onSubmit={(e) => { e.preventDefault(); done(true); }} onKeyDown={(e) => e.stopPropagation()}>
          <label className="mb-2 block text-xs font-medium">{label}
            <Input autoFocus aria-label={label} value={value} onChange={(e) => setValue(e.currentTarget.value)}
              className="mt-2 h-8 bg-surface-1 text-xs" onFocus={(e) => e.currentTarget.select()} />
          </label>
          <span className="mb-1 block text-xs text-muted-foreground">Color</span>
          <ColorSwatches value={swatch} onPick={setSwatch} />
          <div className="mt-3 flex justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => done(false)}>Cancel</Button>
            <Button type="submit" size="sm">Save</Button>
          </div>
        </form>
      </PopoverContent>
    </Popover>
  );
}
