import { PiSlidersHorizontal } from "react-icons/pi";
import type { AspectRatio } from "@shared/types";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useEditor } from "@/stores/editor";

const RATIOS: { value: AspectRatio; label: string }[] = [
  { value: "9:16", label: "Vertical" },
  { value: "16:9", label: "Landscape" },
  { value: "1:1", label: "Square" },
  { value: "4:5", label: "Portrait" },
];
const FRAME_RATES: { value: number; label: string }[] = [
  { value: 24, label: "Film" },
  { value: 25, label: "PAL" },
  { value: 30, label: "Standard" },
  { value: 60, label: "Smooth" },
];

const optionClass =
  "group h-auto flex-col gap-1 rounded-lg border border-input px-0 py-2.5 text-muted-foreground hover:bg-accent/60 hover:text-foreground data-[state=on]:border-brand data-[state=on]:bg-brand/10 data-[state=on]:text-foreground data-[state=on]:ring-1 data-[state=on]:ring-brand";

/** Header button showing the video's format; opens the (live-applying) settings dialog. */
export function SettingsDialog() {
  const settings = useEditor((s) => s.project.settings);
  const { updateSettings } = useEditor.getState();
  // Keep an unusual rate (e.g. from an older project) selectable.
  const frameRates = FRAME_RATES.some((r) => r.value === settings.fps)
    ? FRAME_RATES
    : [...FRAME_RATES, { value: settings.fps, label: "Custom" }].sort((a, b) => a.value - b.value);

  return (
    <Dialog>
      <Tooltip>
        <TooltipTrigger asChild>
          <DialogTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              aria-label="Video settings"
              className="gap-1.5 px-2 text-xs font-normal text-muted-foreground tabular-nums hover:text-foreground"
            >
              <PiSlidersHorizontal className="size-3.5" />
              {settings.aspectRatio} · {settings.fps} fps
            </Button>
          </DialogTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom">Video settings</TooltipContent>
      </Tooltip>

      <DialogContent className="gap-5 sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Video settings</DialogTitle>
          <DialogDescription>Applies to the preview and to exports.</DialogDescription>
        </DialogHeader>

        <div className="grid gap-2">
          <Label>Aspect ratio</Label>
          <ToggleGroup
            type="single"
            spacing={2}
            value={settings.aspectRatio}
            onValueChange={(v) => v && updateSettings({ aspectRatio: v as AspectRatio })}
            className="grid w-full grid-cols-4"
            aria-label="Aspect ratio"
          >
            {RATIOS.map((r) => (
              <ToggleGroupItem key={r.value} value={r.value} aria-label={`${r.label} ${r.value}`} className={optionClass}>
                <RatioGlyph ratio={r.value} />
                <span className="text-sm font-semibold tabular-nums">{r.value}</span>
                <span className="text-[11px] leading-none font-normal text-muted-foreground">{r.label}</span>
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>

        <div className="grid gap-2">
          <Label>Frame rate</Label>
          <ToggleGroup
            type="single"
            spacing={2}
            value={String(settings.fps)}
            onValueChange={(v) => v && updateSettings({ fps: Number(v) })}
            className="grid w-full auto-cols-fr grid-flow-col"
            aria-label="Frame rate"
          >
            {frameRates.map((r) => (
              <ToggleGroupItem key={r.value} value={String(r.value)} className={optionClass}>
                <span className="text-sm font-semibold tabular-nums">{r.value} fps</span>
                <span className="text-[11px] leading-none font-normal text-muted-foreground">{r.label}</span>
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button>Done</Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** A small outline rectangle in the given aspect ratio. */
function RatioGlyph({ ratio }: { ratio: AspectRatio }) {
  const [a, b] = ratio.split(":").map(Number);
  const max = 18;
  const width = a >= b ? max : Math.round((max * a) / b);
  const height = a >= b ? Math.round((max * b) / a) : max;
  return (
    <span className="flex size-5 items-center justify-center" aria-hidden>
      <span
        className="rounded-[3px] border-[1.5px] border-current opacity-70 group-data-[state=on]:text-brand group-data-[state=on]:opacity-100"
        style={{ width, height }}
      />
    </span>
  );
}
