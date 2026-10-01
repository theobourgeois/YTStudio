import { useEffect, useState, type ReactNode } from "react";
import { cn } from "cn";
import {
  PiArrowCounterClockwise,
  PiCopy,
  PiDownloadSimple,
  PiMagnet,
  PiMagnifyingGlass,
  PiPause,
  PiPlay,
  PiPlus,
  PiScissors,
  PiSpeakerHigh,
  PiTrash,
} from "react-icons/pi";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { ColorPicker, ColorSwatchPicker } from "@/components/color-picker";
import { ThemePicker } from "@/components/settings/general-settings";
import { SettingsGroup, SettingsRow } from "@/components/settings/settings-ui";
import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuCell,
  ContextMenuCheckboxItem,
  ContextMenuColumns,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { TagChip } from "@/components/ui/tag-chip";
import { Toggle } from "@/components/ui/toggle";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { GallerySection } from "./types";

/** A labelled row of examples. */
function Row({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className="flex items-start gap-4">
      <div className="w-28 shrink-0 pt-1.5 text-xs text-muted-foreground">{label}</div>
      <div className={cn("flex flex-wrap items-center gap-2", className)}>{children}</div>
    </div>
  );
}

const SURFACES = [
  ["surface-0", "the desktop, the stage"],
  ["surface-1", "panels (background)"],
  ["surface-2", "cards, work areas"],
  ["popover", "menus, dialogs"],
  ["surface-3", "a raised control's face"],
  ["sunken", "fields"],
] as const;

const SWATCHES = ["line", "line-strong", "bevel-shadow", "brand", "destructive", "playhead"] as const;
const CLIPS = ["clip-video", "clip-audio", "clip-graphic", "clip-adjustment", "clip-solid", "clip-camera", "clip-null"] as const;

/** A colour's relative luminance (WCAG), from whatever the browser computed for it. */
function luminance(colour: string): number | null {
  const m = colour.match(/rgba?\(([^)]+)\)/);
  if (!m) return null;
  const [r, g, b] = m[1].split(/[ ,/]+/).map(Number);
  const channel = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** The contrast ratio of two CSS colours (resolved by the browser, so variables work). */
function useContrast(foreground: string, background: string): number | null {
  const [ratio, setRatio] = useState<number | null>(null);
  const theme = document.documentElement.className;
  useEffect(() => {
    const probe = document.createElement("div");
    document.body.append(probe);
    probe.style.color = foreground;
    const fg = luminance(getComputedStyle(probe).color);
    probe.style.color = background;
    const bg = luminance(getComputedStyle(probe).color);
    probe.remove();
    setRatio(fg === null || bg === null ? null : (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05));
  }, [foreground, background, theme]);
  return ratio;
}

/** A ratio against what it must reach: 4.5 for text, 3 for icons and lines that carry meaning. */
function Ratio({ foreground, background, need }: { foreground: string; background: string; need: number }) {
  const ratio = useContrast(foreground, background);
  if (ratio === null) return null;
  return (
    <span className={cn("font-mono text-[10px] tabular-nums", ratio >= need ? "text-emerald-500" : "font-bold text-destructive")}>
      {ratio.toFixed(1)}
      {ratio >= need ? "" : ` < ${need}`}
    </span>
  );
}

function Surfaces() {
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-3 gap-2">
        {SURFACES.map(([name, use]) => (
          <div
            key={name}
            className={cn("flex flex-col gap-1 rounded-md border border-line p-3", name === "sunken" && "sunken")}
            style={{ background: `var(--${name})` }}
          >
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-[13px] font-medium">--{name}</span>
              <Ratio foreground="var(--foreground)" background={`var(--${name})`} need={4.5} />
            </div>
            <div className="flex items-baseline justify-between gap-2 text-xs text-muted-foreground">
              {use}
              <Ratio foreground="var(--muted-foreground)" background={`var(--${name})`} need={4.5} />
            </div>
            <div className="flex items-baseline justify-between gap-2 text-xs text-brand">
              accent
              <Ratio foreground="var(--brand)" background={`var(--${name})`} need={3} />
            </div>
          </div>
        ))}
      </div>
      <Row label="Lines, colours">
        {SWATCHES.map((name) => (
          <div key={name} className="flex flex-col items-center gap-1">
            <div className="h-6 w-16 rounded-sm border border-line" style={{ background: `var(--${name})` }} />
            <span className="text-[10px] text-muted-foreground">{name}</span>
          </div>
        ))}
      </Row>
      <Row label="Clips (content)">
        {CLIPS.map((name) => (
          <div key={name} className="flex flex-col items-center gap-1">
            <div className="h-6 w-16 rounded-sm border border-black/40 inset-shadow-[0_1px_0_rgb(255_255_255/0.2)]" style={{ background: `var(--${name})` }} />
            <span className="text-[10px] text-muted-foreground">{name.slice(5)}</span>
          </div>
        ))}
      </Row>
      <Row label="Depth">
        {(["raised", "pressed", "sunken", "raised-brand", "pressed-brand", "floating"] as const).map((name) => (
          <div key={name} className="flex flex-col items-center gap-1">
            <div className={cn("h-8 w-20 rounded-md", name)} />
            <span className="text-[10px] text-muted-foreground">{name}</span>
          </div>
        ))}
      </Row>
    </div>
  );
}

const VARIANTS = ["default", "secondary", "outline", "ghost", "destructive", "link"] as const;

function Buttons() {
  return (
    <div className="flex flex-col gap-3">
      {VARIANTS.map((variant) => (
        <Row key={variant} label={variant}>
          <Button variant={variant}>Export</Button>
          <Button variant={variant}>
            <PiDownloadSimple /> With icon
          </Button>
          <Button variant={variant} size="sm">
            Small
          </Button>
          <Button variant={variant} size="xs">
            Tiny
          </Button>
          <Button variant={variant} size="icon" aria-label="Add">
            <PiPlus />
          </Button>
          <Button variant={variant} size="icon-sm" aria-label="Copy">
            <PiCopy />
          </Button>
          <Button variant={variant} size="icon-xs" aria-label="Delete">
            <PiTrash />
          </Button>
          <Button variant={variant} disabled>
            Disabled
          </Button>
        </Row>
      ))}
      <Row label="large">
        <Button size="lg">New project</Button>
        <Button size="lg" variant="outline">
          Cancel
        </Button>
      </Row>
    </div>
  );
}

function Toggles() {
  const [tool, setTool] = useState("select");
  const [snap, setSnap] = useState(true);
  return (
    <div className="flex flex-col gap-3">
      <Row label="toggle">
        <Toggle aria-label="Snap" pressed={snap} onPressedChange={setSnap}>
          <PiMagnet /> Snap
        </Toggle>
        <Toggle aria-label="Off">
          <PiSpeakerHigh /> Off
        </Toggle>
        <Toggle aria-label="On" defaultPressed>
          <PiSpeakerHigh /> On
        </Toggle>
        <Toggle size="sm" aria-label="Small" defaultPressed>
          <PiScissors />
        </Toggle>
        <Toggle aria-label="Disabled" disabled>
          Disabled
        </Toggle>
      </Row>
      <Row label="ghost toggle">
        <Toggle variant="ghost" aria-label="Ghost off">
          <PiMagnet />
        </Toggle>
        <Toggle variant="ghost" aria-label="Ghost on" defaultPressed>
          <PiMagnet />
        </Toggle>
      </Row>
      <Row label="segmented">
        <ToggleGroup type="single" value={tool} onValueChange={(v) => v && setTool(v)} size="sm">
          <ToggleGroupItem value="select">Select</ToggleGroupItem>
          <ToggleGroupItem value="razor">Razor</ToggleGroupItem>
          <ToggleGroupItem value="hand">Hand</ToggleGroupItem>
        </ToggleGroup>
        <ToggleGroup type="multiple" defaultValue={["b"]}>
          <ToggleGroupItem value="a" aria-label="Bold">
            B
          </ToggleGroupItem>
          <ToggleGroupItem value="b" aria-label="Italic">
            I
          </ToggleGroupItem>
          <ToggleGroupItem value="c" aria-label="Underline">
            U
          </ToggleGroupItem>
        </ToggleGroup>
      </Row>
      <Row label="spaced group">
        <ToggleGroup type="single" defaultValue="9:16" spacing={1} size="sm" variant="ghost">
          {["9:16", "1:1", "16:9"].map((v) => (
            <ToggleGroupItem key={v} value={v}>
              {v}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </Row>
      <Row label="tag chips">
        <div role="radiogroup" aria-label="Category" className="flex gap-1.5">
          {["All", "Colour", "Blur", "Light", "Stylize"].map((t, i) => (
            <TagChip key={t} active={i === 1} onClick={() => {}}>
              {t}
            </TagChip>
          ))}
        </div>
      </Row>
    </div>
  );
}

function Fields() {
  return (
    <div className="flex flex-col gap-3">
      <Row label="input" className="w-80 flex-col items-stretch">
        <Input placeholder="Project name" />
        <Input defaultValue="Summer trip edit" />
        <div className="relative">
          <PiMagnifyingGlass className="absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input className="pl-8" placeholder="Search effects" />
        </div>
        <Input defaultValue="Invalid" aria-invalid />
        <Input defaultValue="Disabled" disabled />
      </Row>
      <Row label="label + input">
        <div className="flex w-80 flex-col gap-1.5">
          <Label htmlFor="gallery-fps">Frame rate</Label>
          <Input id="gallery-fps" defaultValue="30" />
        </div>
      </Row>
      <Row label="select">
        <Select defaultValue="30">
          <SelectTrigger className="w-40" aria-label="Frame rate">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {["24", "25", "30", "50", "60"].map((v) => (
              <SelectItem key={v} value={v}>
                {v} fps
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select>
          <SelectTrigger size="sm" className="w-40" aria-label="Blend mode">
            <SelectValue placeholder="Blend mode" />
          </SelectTrigger>
          <SelectContent>
            {["Normal", "Multiply", "Screen", "Overlay"].map((v) => (
              <SelectItem key={v} value={v}>
                {v}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Row>
    </div>
  );
}

/** The colour picker: open inline, and as the swatch that opens it (the Properties panel's colours). */
function Colours() {
  const [color, setColor] = useState("#d4247a");
  const edit = { begin: () => {}, set: setColor, end: () => {} };
  return (
    <div className="flex items-start gap-6">
      <div className="floating w-60 rounded-md p-2.5">
        <ColorPicker value={color} edit={edit} />
      </div>
      <Row label="swatch">
        <ColorSwatchPicker value={color} label="Colour" edit={edit} />
        <ColorSwatchPicker value="#120c5c" label="Disabled colour" disabled edit={edit} />
      </Row>
    </div>
  );
}

function Ranges() {
  const [volume, setVolume] = useState([70]);
  return (
    <div className="flex flex-col gap-4">
      <Row label="slider" className="w-80">
        <Slider value={volume} onValueChange={setVolume} max={100} aria-label="Volume" />
        <Slider defaultValue={[20, 80]} max={100} aria-label="Range" />
        <Slider defaultValue={[40]} max={100} disabled aria-label="Disabled" />
      </Row>
      <Row label="switch">
        <Switch aria-label="Off" />
        <Switch aria-label="On" defaultChecked />
        <Switch aria-label="Disabled" disabled />
        <Switch aria-label="Disabled on" disabled defaultChecked />
      </Row>
      <Row label="progress" className="w-80 flex-col items-stretch">
        <Progress value={0} />
        <Progress value={35} />
        <Progress value={100} />
      </Row>
    </div>
  );
}

function Menus() {
  const [zoom, setZoom] = useState("fit");
  const [grid, setGrid] = useState(true);
  return (
    <div className="flex min-h-80 items-start gap-8">
      {/* Shown open, so a screenshot has them; `modal={false}` lets several be open at once. */}
      <DropdownMenu open modal={false}>
        <DropdownMenuTrigger asChild>
          <Button variant="outline">Dropdown (open)</Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-52" onCloseAutoFocus={(e) => e.preventDefault()}>
          <DropdownMenuLabel>Clip</DropdownMenuLabel>
          <DropdownMenuItem>
            <PiScissors /> Split at playhead <DropdownMenuShortcut>S</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuItem>
            <PiCopy /> Duplicate <DropdownMenuShortcut>⌘D</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuItem disabled>
            <PiArrowCounterClockwise /> Reset (disabled)
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuCheckboxItem checked={grid} onCheckedChange={setGrid}>
            Show grid
          </DropdownMenuCheckboxItem>
          <DropdownMenuSeparator />
          <DropdownMenuRadioGroup value={zoom} onValueChange={setZoom}>
            <DropdownMenuRadioItem value="fit">Fit</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="100">100%</DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive">
            <PiTrash /> Delete <DropdownMenuShortcut>⌫</DropdownMenuShortcut>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <div className="ml-48 flex flex-col items-start gap-24">
        <Popover open>
          <PopoverTrigger asChild>
            <Button variant="outline">Popover (open)</Button>
          </PopoverTrigger>
          <PopoverContent side="right" align="start" className="w-60" onOpenAutoFocus={(e) => e.preventDefault()}>
            <div className="flex flex-col gap-2">
              <div className="text-[13px] font-medium">Speed</div>
              <Slider defaultValue={[50]} aria-label="Speed" />
              <Input defaultValue="100%" aria-label="Speed value" />
            </div>
          </PopoverContent>
        </Popover>
        <Tooltip open>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="Play">
              <PiPlay />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">Play (Space)</TooltipContent>
        </Tooltip>
      </div>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div
            data-gallery-target="context"
            className="ml-auto flex h-28 w-60 items-center justify-center rounded-md border border-dashed border-line-strong text-xs text-muted-foreground"
          >
            Right-click here
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem>
            <PiPlay /> Play from here
          </ContextMenuItem>
          <ContextMenuItem>
            <PiPause /> Stop
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuCheckboxItem checked>Snap to markers</ContextMenuCheckboxItem>
          <ContextMenuSub>
            <ContextMenuSubTrigger>Add marker</ContextMenuSubTrigger>
            <ContextMenuSubContent>
              <ContextMenuItem>Red</ContextMenuItem>
              <ContextMenuItem>Blue</ContextMenuItem>
            </ContextMenuSubContent>
          </ContextMenuSub>
          <ContextMenuSeparator />
          <ContextMenuItem variant="destructive">
            <PiTrash /> Delete <ContextMenuShortcut>⌫</ContextMenuShortcut>
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div
            data-gallery-target="context-columns"
            className="flex h-28 w-60 items-center justify-center rounded-md border border-dashed border-line-strong text-xs text-muted-foreground"
          >
            Right-click: in columns
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent className="p-0">
          <ContextMenuColumns>
            <ContextMenuCell first>
              <ContextMenuItem inset>Piano roll</ContextMenuItem>
              <ContextMenuCheckboxItem checked>Cut itself</ContextMenuCheckboxItem>
            </ContextMenuCell>
            <ContextMenuCell>
              <ContextMenuItem inset>Cut</ContextMenuItem>
              <ContextMenuItem inset>Copy</ContextMenuItem>
              <ContextMenuItem inset disabled>
                Paste
              </ContextMenuItem>
            </ContextMenuCell>
            <ContextMenuSeparator className="col-span-full m-0" />
            <ContextMenuCell first>
              <ContextMenuItem inset variant="destructive">
                Delete
              </ContextMenuItem>
            </ContextMenuCell>
            <ContextMenuCell>
              <ContextMenuItem inset>
                Rotate left <ContextMenuShortcut>⇧⌘←</ContextMenuShortcut>
              </ContextMenuItem>
            </ContextMenuCell>
          </ContextMenuColumns>
        </ContextMenuContent>
      </ContextMenu>
    </div>
  );
}

function Dialogs() {
  return (
    <div className="flex flex-wrap gap-2">
      <Dialog>
        <DialogTrigger asChild>
          <Button variant="outline">Open dialog</Button>
        </DialogTrigger>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Video settings</DialogTitle>
            <DialogDescription>The canvas's shape and frame rate. Clips keep their place.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="gallery-name">Name</Label>
              <Input id="gallery-name" defaultValue="Summer trip edit" />
            </div>
            <div className="flex items-center justify-between">
              <Label htmlFor="gallery-ripple">Auto ripple</Label>
              <Switch id="gallery-ripple" defaultChecked />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline">Cancel</Button>
            <Button>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button variant="outline">Open alert</Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “Summer trip edit”?</AlertDialogTitle>
            <AlertDialogDescription>Its media and exports are deleted too. This can't be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive">Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <Button
        variant="outline"
        onClick={() => {
          toast.success("Exported summer-trip.mp4");
          toast.error("Couldn't reach the editor server");
          toast("Transcribing… 42%");
        }}
      >
        Show toasts
      </Button>
    </div>
  );
}

function Scrolling() {
  return (
    <div className="flex gap-6">
      <ScrollArea type="always" className="h-40 w-64 rounded-md border border-line bg-card">
        <div className="flex flex-col p-2">
          {Array.from({ length: 20 }, (_, i) => (
            <div key={i} className="rounded-sm px-2 py-1 text-[13px] hover:bg-accent">
              clip-{String(i + 1).padStart(2, "0")}.mp4
            </div>
          ))}
        </div>
      </ScrollArea>
      <div className="h-40 w-64 overflow-auto rounded-md border border-line bg-card p-2 text-[13px]">
        <div className="w-96">
          The page's own scrollbars (index.css), as the Piano roll's: a sunken track and a raised thumb.
          {Array.from({ length: 12 }, (_, i) => (
            <p key={i} className="py-1 text-muted-foreground">
              Line {i + 1}
            </p>
          ))}
        </div>
      </div>
      <div className="flex h-40 flex-col justify-between">
        <span className="text-xs text-muted-foreground">separators</span>
        <Separator className="w-40" />
        <div className="flex h-10 items-center gap-3 text-xs">
          Left <Separator orientation="vertical" /> Right
        </div>
      </div>
    </div>
  );
}

export const PRIMITIVE_SECTIONS: GallerySection[] = [
  { id: "surfaces", title: "Surfaces, colours and contrast", source: "src/themes/studio.css", render: () => <Surfaces /> },
  { id: "buttons", title: "Buttons", source: "components/ui/button.tsx", render: () => <Buttons /> },
  { id: "toggles", title: "Toggles, groups, chips", source: "components/ui/toggle.tsx, toggle-group.tsx, tag-chip.tsx", render: () => <Toggles /> },
  {
    id: "fields",
    title: "Fields",
    source: "components/ui/input.tsx, select.tsx, label.tsx",
    render: () => <Fields />,
    shots: [{ name: "select-open", click: "Frame rate" }],
  },
  { id: "ranges", title: "Sliders, switches, progress", source: "components/ui/slider.tsx, switch.tsx, progress.tsx", render: () => <Ranges /> },
  { id: "colours", title: "Colour picker", source: "components/color-picker.tsx", render: () => <Colours />, shots: [{ name: "open", click: "Colour" }] },
  {
    id: "menus",
    title: "Menus, popovers, tooltips",
    source: "components/ui/dropdown-menu.tsx, context-menu.tsx, popover.tsx, tooltip.tsx",
    render: () => <Menus />,
    shots: [{ name: "context-menu", rightClick: "context" }],
  },
  {
    id: "dialogs",
    title: "Dialogs and toasts",
    source: "components/ui/dialog.tsx, alert-dialog.tsx, sonner.tsx",
    render: () => <Dialogs />,
    shots: [
      { name: "dialog", click: "Open dialog", page: true },
      { name: "alert", click: "Open alert", page: true },
      { name: "toasts", click: "Show toasts", page: true },
    ],
  },
  { id: "scrolling", title: "Scrolling and separators", source: "components/ui/scroll-area.tsx, separator.tsx, index.css", render: () => <Scrolling /> },
  { id: "settings", title: "Settings: groups, rows, themes", source: "components/settings/", render: () => <SettingsParts /> },
];

/** Settings' pieces: a group of rows (with and without a control) and every theme's preview. */
function SettingsParts() {
  const [on, setOn] = useState(true);
  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <SettingsGroup title="A group" description="What the settings in it are about.">
        <SettingsRow title="A switch" description="A line on what it does.">
          <Switch checked={on} onCheckedChange={setOn} aria-label="A switch" />
        </SettingsRow>
        <SettingsRow title="Only words" description="A row can say something without a control." />
      </SettingsGroup>
      <ThemePicker />
    </div>
  );
}
