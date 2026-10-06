/**
 * New photo (ux.md, "New photo"), Photoshop's New Document: asked before the photo is made
 * (`ClientSuite.NewProject`). Its presets show their shape, any size can be typed in, and the background is
 * white, black or transparent; or it opens an image, the canvas taking the image's size. Closing it makes nothing.
 */
import { type CSSProperties, type FormEvent, useRef, useState } from "react";
import { cn } from "cn";
import { PiImage } from "react-icons/pi";
import { CANVAS_PRESETS } from "@shared/photo/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FloatingWindow, WindowFooter, centredOnDesktop } from "@/components/windows/floating-window";
import type { NewProjectWindowProps } from "../types";
import { parseSide, presetOf, ratioOf, shapeBox } from "./new-photo";
import { newPhotoOptions, usePhotoPreferences } from "./preferences";

const WIDTH = 780;

/** Transparency as the canvas shows it (the renderer's light greys), whatever the theme. */
const CHECKER: CSSProperties = { background: "repeating-conic-gradient(#c8c8c8 0 25%, #f2f2f2 0 50%) 0 0 / 10px 10px" };

const BACKGROUNDS = [
  { id: "white", label: "White", colour: "#ffffff" },
  { id: "black", label: "Black", colour: "#000000" },
  { id: "transparent", label: "Transparent", colour: null },
] as const;
type Background = (typeof BACKGROUNDS)[number];

const isImage = (file: File) => file.type.startsWith("image/") || /\.(png|jpe?g|webp)$/i.test(file.name);

export default function NewPhotoWindow({ create, close }: NewProjectWindowProps) {
  const [initial] = useState(() => centredOnDesktop(WIDTH, 440, "app"));
  // It starts at the size new photos start at (Settings › Photo), the last preset made.
  const [width, setWidth] = useState(() => String(newPhotoOptions().width));
  const [height, setHeight] = useState(() => String(newPhotoOptions().height));
  const [background, setBackground] = useState<Background>(BACKGROUNDS[0]);
  const widthField = useRef<HTMLInputElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const w = parseSide(width);
  const h = parseSide(height);
  // While a side is being typed, the shapes keep the last whole size.
  const lastSize = useRef({ width: w ?? 1080, height: h ?? 1920 });
  if (w !== null && h !== null) lastSize.current = { width: w, height: h };
  const size = lastSize.current;
  const valid = w !== null && h !== null;
  const preset = valid ? presetOf(w, h) : undefined;

  const choose = (next: { width: number; height: number }) => {
    setWidth(String(next.width));
    setHeight(String(next.height));
  };
  const orient = (portrait: boolean) => {
    if (portrait !== size.height > size.width && size.width !== size.height) choose({ width: size.height, height: size.width });
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!valid) return;
    if (preset) usePhotoPreferences.getState().setPresetId(preset.id);
    create({ options: { width: w, height: h, background: background.colour } });
  };

  return (
    <FloatingWindow id="new-project" title="New photo" initial={initial} keepsKeys onClose={close} className="max-w-full">
      <form className="flex min-h-0 flex-col" onSubmit={submit} data-new-photo>
        <div className="flex min-h-0 gap-5 overflow-y-auto p-5" style={{ width: WIDTH }}>
          <section className="flex min-w-0 flex-1 flex-col gap-2.5" aria-label="Presets">
            <h3 className="text-xs font-medium text-muted-foreground">Presets</h3>
            <div className="grid grid-cols-4 gap-2" role="radiogroup" aria-label="Size">
              {CANVAS_PRESETS.map((p) => (
                <SizeCard key={p.id} label={p.label} width={p.width} height={p.height} checked={preset?.id === p.id} onClick={() => choose(p)} />
              ))}
              <SizeCard
                label="Custom"
                width={size.width}
                height={size.height}
                checked={!preset}
                dashed
                onClick={() => {
                  widthField.current?.focus();
                  widthField.current?.select();
                }}
              />
            </div>
          </section>

          <section className="flex w-56 shrink-0 flex-col gap-3.5 border-l border-line pl-5 text-[13px]" aria-label="Details">
            <h3 className="text-xs font-medium text-muted-foreground">Details</h3>
            <div className="sunken grid h-32 place-items-center rounded-md" aria-hidden>
              <div
                className="shadow-md outline outline-line"
                style={{ ...shapeBox(size.width, size.height, 104), ...(background.colour ? { background: background.colour } : CHECKER) }}
                data-new-photo-preview={`${size.width}x${size.height}`}
              />
            </div>
            <div className="grid grid-cols-[auto_1fr_auto] items-center gap-x-2 gap-y-1.5">
              <label htmlFor="new-photo-width">Width</label>
              <Input
                ref={widthField}
                id="new-photo-width"
                inputMode="numeric"
                value={width}
                onChange={(e) => setWidth(e.target.value)}
                aria-invalid={w === null || undefined}
                className="h-7 tabular-nums"
                data-autofocus
              />
              <span className="text-muted-foreground">px</span>
              <label htmlFor="new-photo-height">Height</label>
              <Input id="new-photo-height" inputMode="numeric" value={height} onChange={(e) => setHeight(e.target.value)} aria-invalid={h === null || undefined} className="h-7 tabular-nums" />
              <span className="text-muted-foreground">px</span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span>Orientation</span>
              <div className="flex gap-1" role="radiogroup" aria-label="Orientation">
                <OrientationButton portrait checked={size.height > size.width} onClick={() => orient(true)} />
                <OrientationButton portrait={false} checked={size.width > size.height} onClick={() => orient(false)} />
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <span>Background</span>
              <div className="grid grid-cols-3 gap-1" role="radiogroup" aria-label="Background">
                {BACKGROUNDS.map((b) => (
                  <button
                    key={b.id}
                    type="button"
                    role="radio"
                    aria-checked={background.id === b.id}
                    onClick={() => setBackground(b)}
                    className={cn(
                      "flex flex-col items-center gap-1 rounded-md px-1 py-1.5 text-[11px] outline-none",
                      background.id === b.id ? "pressed text-foreground" : "raised text-muted-foreground hover:raised-hover",
                    )}
                  >
                    <span className="size-4 rounded-sm outline outline-line" style={b.colour ? { background: b.colour } : CHECKER} />
                    {b.label}
                  </button>
                ))}
              </div>
            </div>
          </section>
        </div>

        <WindowFooter className="border-t border-line px-5 py-3 sm:justify-between">
          <Button type="button" variant="outline" onClick={() => fileInput.current?.click()}>
            <PiImage /> Open an image…
          </Button>
          <input
            ref={fileInput}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            data-new-photo-input
            onChange={(e) => {
              const files = [...(e.target.files ?? [])].filter(isImage);
              e.target.value = "";
              if (files.length) create({ files: files.slice(0, 1) });
            }}
          />
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <Button type="button" variant="outline" onClick={close}>
              Cancel
            </Button>
            <Button type="submit" disabled={!valid}>
              Create
            </Button>
          </div>
        </WindowFooter>
      </form>
    </FloatingWindow>
  );
}

/** A size as Photoshop's New Document shows it: its shape, its name, its pixels and ratio. */
function SizeCard({ label, width, height, checked, dashed, onClick }: { label: string; width: number; height: number; checked: boolean; dashed?: boolean; onClick: () => void }) {
  const ratio = ratioOf(width, height);
  // Custom says its size only while it's the one chosen.
  const sized = !dashed || checked;
  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      aria-label={label}
      onClick={onClick}
      className={cn("flex flex-col items-center gap-1 rounded-md px-2 pt-3 pb-2 text-center outline-none", checked ? "pressed border-brand!" : "raised hover:raised-hover")}
      data-size-card={label}
    >
      <span className="grid h-16 place-items-center">
        <span
          className={cn("rounded-[2px] border-[1.5px]", dashed && "border-dashed", checked ? "border-brand bg-brand/15" : "border-foreground/55 bg-foreground/6")}
          style={sized ? shapeBox(width, height, 56, 6) : { width: 44, height: 44 }}
        />
      </span>
      <span className="w-full truncate text-[13px] font-medium">{label}</span>
      <span className="text-[11px] whitespace-nowrap text-muted-foreground tabular-nums">
        {sized ? (
          <>
            {width} × {height}
            {ratio && <span className="opacity-70"> · {ratio}</span>}
          </>
        ) : (
          "Any size"
        )}
      </span>
    </button>
  );
}

function OrientationButton({ portrait, checked, onClick }: { portrait: boolean; checked: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      aria-label={portrait ? "Portrait" : "Landscape"}
      onClick={onClick}
      className={cn("grid size-7 place-items-center rounded-md outline-none", checked ? "pressed text-brand" : "raised text-muted-foreground hover:raised-hover")}
    >
      <span className={cn("rounded-[1.5px] border-[1.5px] border-current", portrait ? "h-3.5 w-2.5" : "h-2.5 w-3.5")} />
    </button>
  );
}
