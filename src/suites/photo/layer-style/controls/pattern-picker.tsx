/**
 * A Layer Style page's Pattern row (docs/photo/layer-style/stroke-satin-overlays.md, "Pattern Overlay"): the
 * pattern's swatch, which opens the patterns (the built-in set, then the photo's own: Define Pattern makes them,
 * from the Layers menu), and Snap to Origin, which puts the pattern back where it starts. A pattern of the photo's
 * that no effect uses can be deleted from its menu.
 */
import { useEffect, useState } from "react";
import { PiCaretDown, PiTrash } from "react-icons/pi";
import { cn } from "cn";
import { BUILT_IN_PATTERNS, type PatternImage, builtInPatternLevels, patternFromLinear } from "@shared/photo/style/patterns";
import type { PhotoPattern } from "@shared/photo/types";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { usePhoto } from "../../store";
import { readSurface } from "../../surface-pixels";
import { uploadsFor } from "../../uploads";

/** A pattern's pixels as an image (encoded: patterns are kept premultiplied encoded). */
function patternUrl(p: PatternImage): string {
  const canvas = document.createElement("canvas");
  canvas.width = p.width;
  canvas.height = p.height;
  const image = new ImageData(p.width, p.height);
  for (let i = 0; i < p.width * p.height; i++) {
    const a = p.data[i * 4 + 3];
    for (let c = 0; c < 3; c++) image.data[i * 4 + c] = a > 0 ? Math.round((p.data[i * 4 + c] / a) * 255) : 0;
    image.data[i * 4 + 3] = Math.round(a * 255);
  }
  canvas.getContext("2d")!.putImageData(image, 0, 0);
  return canvas.toDataURL();
}

const swatches = new Map<string, Promise<string>>();

/** A pattern's swatch image: a built-in one's at once, a photo's once its pixels are read. */
function swatchOf(id: string, pattern: PhotoPattern | undefined): Promise<string> | null {
  const key = pattern ? `${pattern.surface}|${pattern.size.width}x${pattern.size.height}` : id;
  let made = swatches.get(key);
  if (!made) {
    const builtIn = builtInPatternLevels(id);
    const projectId = usePhoto.getState().projectId;
    if (builtIn) made = Promise.resolve(patternUrl(builtIn[0]));
    else if (pattern && projectId) made = readSurface(uploadsFor(projectId), pattern.surface, pattern.size.width, pattern.size.height).then((linear) => patternUrl(patternFromLinear(pattern.size.width, pattern.size.height, linear)));
    else return null;
    swatches.set(key, made);
  }
  return made;
}

export function PatternSwatch({ id, pattern, size = 32, className }: { id: string; pattern?: PhotoPattern; size?: number; className?: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void swatchOf(id, pattern)
      ?.then((u) => live && setUrl(u))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [id, pattern]);
  return (
    <span
      className={cn("block shrink-0 bg-surface-3", className)}
      style={{ width: size, height: size, backgroundImage: url ? `url(${url})` : undefined, backgroundSize: "auto", imageRendering: "pixelated" }}
      aria-hidden
    />
  );
}

export function PatternPicker({
  value,
  patterns,
  onChange,
  onSnap,
  onDelete,
  inUse,
  disabled,
}: {
  value: string;
  /** The photo's own patterns. */
  patterns: readonly PhotoPattern[];
  onChange: (id: string) => void;
  /** Snap to Origin: its phase back to 0. */
  onSnap?: () => void;
  /** Deletes a pattern of the photo's that nothing uses. */
  onDelete?: (id: string) => void;
  inUse?: readonly string[];
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const all = [...BUILT_IN_PATTERNS.map((p) => ({ id: p.id, name: p.name, pattern: undefined as PhotoPattern | undefined })), ...patterns.map((p) => ({ id: p.id, name: p.name, pattern: p }))];
  const current = all.find((p) => p.id === value);
  return (
    <span className="flex items-center gap-2" data-pattern-picker>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild disabled={disabled}>
          <button
            type="button"
            aria-label={`Pattern: ${current?.name ?? "missing"}. Choose a pattern`}
            className={cn("inline-flex shrink-0 overflow-hidden rounded-sm border border-line outline-none focus-visible:ring-2 focus-visible:ring-ring/50", disabled && "opacity-50")}
          >
            <PatternSwatch id={value} pattern={current?.pattern} />
            <span className="grid w-4 place-items-center border-l border-line bg-surface-2 text-muted-foreground">
              <PiCaretDown className="size-3" />
            </span>
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-auto max-w-80 p-1.5" onOpenAutoFocus={(e) => e.preventDefault()}>
          <div role="listbox" aria-label="Patterns" className="grid grid-cols-6 gap-1">
            {all.map((p) => (
              <Tooltip key={p.id}>
                <TooltipTrigger asChild>
                  <span className="group relative">
                    <button
                      type="button"
                      role="option"
                      aria-selected={p.id === value}
                      aria-label={p.name}
                      className={cn("block rounded-sm border p-px outline-none hover:border-brand focus-visible:ring-2 focus-visible:ring-ring/50", p.id === value ? "border-brand" : "border-line")}
                      onClick={() => {
                        onChange(p.id);
                        setOpen(false);
                      }}
                    >
                      <PatternSwatch id={p.id} pattern={p.pattern} size={30} />
                    </button>
                    {p.pattern && onDelete && !inUse?.includes(p.id) && (
                      <button
                        type="button"
                        aria-label={`Delete ${p.name}`}
                        className="absolute -top-1 -right-1 hidden size-4 place-items-center rounded-full bg-surface-3 text-muted-foreground group-hover:grid hover:text-foreground"
                        onClick={() => onDelete(p.id)}
                      >
                        <PiTrash className="size-2.5" />
                      </button>
                    )}
                  </span>
                </TooltipTrigger>
                <TooltipContent side="bottom">{p.name}</TooltipContent>
              </Tooltip>
            ))}
          </div>
          {!patterns.length && <p className="mt-1.5 max-w-60 px-0.5 text-xs text-muted-foreground">Define Pattern (the Layers menu) makes one from a layer's pixels in the selection.</p>}
        </PopoverContent>
      </Popover>
      <span className="truncate text-xs text-muted-foreground">{current?.name ?? "Missing pattern"}</span>
      {onSnap && (
        <Button size="sm" variant="outline" className="ml-auto h-6 px-2 text-xs" onClick={onSnap} disabled={disabled}>
          Snap to Origin
        </Button>
      )}
    </span>
  );
}
