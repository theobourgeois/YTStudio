import { PiSlidersHorizontal } from "react-icons/pi";
import type { AspectRatio } from "@shared/types";
import { formatTime } from "@shared/format";
import { projectDuration } from "@shared/timeline";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useEditor } from "@/stores/editor";
import { BackgroundPicker } from "./background-picker";
import { PanelHeader, Section } from "./layout";

const RATIOS: { value: AspectRatio; label: string }[] = [
  { value: "9:16", label: "Vertical" },
  { value: "16:9", label: "Landscape" },
  { value: "1:1", label: "Square" },
  { value: "4:5", label: "Portrait" },
];
const FRAME_RATES = [24, 25, 30, 60];

export function ProjectInspector() {
  const name = useEditor((s) => s.project.name);
  const settings = useEditor((s) => s.project.settings);
  const { updateSettings } = useEditor.getState();
  const frameRates = [...new Set([...FRAME_RATES, settings.fps])].sort((a, b) => a - b);

  return (
    <>
      <PanelHeader
        icon={
          <div className="flex size-10 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
            <PiSlidersHorizontal className="size-4" />
          </div>
        }
        title={name}
        subtitle="Select a clip to edit it"
      />

      <Section title="Aspect ratio">
        <ToggleGroup
          type="single"
          spacing={1}
          value={settings.aspectRatio}
          onValueChange={(v) => v && updateSettings({ aspectRatio: v as AspectRatio })}
          className="grid w-full grid-cols-4 gap-1.5"
          aria-label="Aspect ratio"
        >
          {RATIOS.map((r) => (
            <ToggleGroupItem
              key={r.value}
              value={r.value}
              aria-label={`${r.label} ${r.value}`}
              className="group h-auto flex-col gap-1 rounded-md border border-transparent px-0 py-2 text-muted-foreground hover:bg-muted hover:text-foreground data-[state=on]:border-brand/40 data-[state=on]:bg-brand/10 data-[state=on]:text-foreground"
            >
              <RatioGlyph ratio={r.value} />
              <span className="text-xs font-medium tabular-nums">{r.value}</span>
              <span className="text-[10px] leading-none font-normal text-muted-foreground">{r.label}</span>
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </Section>

      <Section>
        <div className="flex items-center justify-between gap-4">
          <h3 className="text-xs font-medium text-muted-foreground">Frame rate</h3>
          <Select value={String(settings.fps)} onValueChange={(v) => updateSettings({ fps: Number(v) })}>
            <SelectTrigger size="sm" className="h-7 w-24 text-xs" aria-label="Frame rate">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {frameRates.map((fps) => (
                <SelectItem key={fps} value={String(fps)} className="text-xs">
                  {fps} fps
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </Section>

      <Section
        title="Background"
        aside={<span className="font-mono text-[11px] text-muted-foreground uppercase">{settings.background}</span>}
      >
        <BackgroundPicker />
      </Section>

      <Section title="Overview">
        <ProjectStats />
      </Section>
    </>
  );
}

function ProjectStats() {
  const duration = useEditor((s) => projectDuration(s.project));
  const clips = useEditor((s) => s.project.clips.length);
  const tracks = useEditor((s) => s.project.tracks.length);
  const stats = [
    { label: "Duration", value: formatTime(duration) },
    { label: "Clips", value: clips },
    { label: "Tracks", value: tracks },
  ];
  return (
    <dl className="grid grid-cols-3 gap-1.5">
      {stats.map((s) => (
        <div key={s.label} className="flex flex-col-reverse rounded-md bg-muted/60 px-2.5 py-2">
          <dt className="text-[11px] text-muted-foreground">{s.label}</dt>
          <dd className="text-sm font-medium tabular-nums">{s.value}</dd>
        </div>
      ))}
    </dl>
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
