/**
 * The Auto captions window (CapCut's "Auto captions", Premiere's "Create
 * captions"): which clips, the language, a style, how long captions are,
 * their animation, and which engine transcribes. Generating keeps going if
 * the window is closed; the captions are added (as one undo step) when it's done.
 */
import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { PiSparkle, PiWarning } from "react-icons/pi";
import {
  CAPTION_ANIMATIONS,
  CAPTION_LANGUAGES,
  CAPTION_LENGTHS,
  CAPTION_PRESETS,
  type CaptionLength,
  captionAnimationOf,
  captionClips,
  captionSourceClips,
  captionStyleOf,
  presetStyle,
} from "@shared/captions";
import { TRANSITIONS } from "@shared/transitions";
import { brandButton } from "@/components/export/export-form";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectSeparator, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { FloatingWindow, WindowBody, WindowFooter, WindowLead, centredOnDesktop } from "@/components/windows/floating-window";
import { cn } from "cn";
import { type CaptionOptions, type CaptionScope, useCaptions } from "@/stores/captions";
import { useEditor } from "@/stores/editor";
import { useFonts } from "@/stores/fonts";
import { useShallow } from "zustand/react/shallow";
import { CaptionSample } from "./caption-sample";
import { EnginePicker } from "./engine-picker";


const CURATED = new Set(CAPTION_ANIMATIONS.map((a) => a.type));

/** Auto captions' window over the video editor, while it's open (`useCaptions.dialogOpen`). */
export function AutoCaptionsWindow() {
  const open = useCaptions((s) => s.dialogOpen);
  return open ? <CaptionsWindow /> : null;
}

const close = () => useCaptions.getState().closeDialog();

function CaptionsWindow() {
  const [initial] = useState(() => centredOnDesktop(512, 560, "video"));
  const running = useCaptions((s) => s.run.status === "running");
  return (
    <FloatingWindow
      id="captions"
      title="Auto captions"
      heading={running ? "Making captions…" : undefined}
      initial={initial}
      keepsKeys
      onClose={close}
      className="max-h-full w-[512px] max-w-full"
    >
      <WindowBody>
        <WindowLead>
          {running ? "You can close this; the captions are added when they're ready." : "Turn the speech in your clips into captions you can edit."}
        </WindowLead>
        {running ? <Running /> : <CaptionForm />}
      </WindowBody>
    </FloatingWindow>
  );
}

function Running() {
  const run = useCaptions((s) => s.run);
  if (run.status !== "running") return null;
  const pct = Math.round(run.progress * 100);
  return (
    <div className="grid gap-5">
      <div className="grid gap-2">
        <div className="flex items-baseline justify-between text-sm">
          <span>
            {run.progress === 0 ? "Getting the sound ready" : "Listening"} to {run.clips} clip{run.clips === 1 ? "" : "s"}…
          </span>
          <span className="text-muted-foreground tabular-nums">{pct}%</span>
        </div>
        <Progress value={pct} className="[&>div]:bg-brand" />
      </div>
      <WindowFooter>
        <Button type="button" variant="ghost" onClick={() => useCaptions.getState().cancel()}>
          Stop
        </Button>
        <Button type="button" variant="outline" onClick={close}>
          Hide
        </Button>
      </WindowFooter>
    </div>
  );
}

function CaptionForm() {
  const saved = useCaptions((s) => s.options);
  const clipIds = useCaptions((s) => s.dialogClipIds);
  const failure = useCaptions((s) => (s.run.status === "error" ? s.run.message : null));
  const engines = useCaptions((s) => s.engines);
  const aspect = useEditor((s) => s.project.settings.aspectRatio);
  const hasCaptions = useEditor((s) => s.project.clips.some((c) => c.caption));
  const counts = useEditor(
    useShallow((s) => {
      const assets = Object.fromEntries(s.assets.map((a) => [a.id, a]));
      return {
        selected: clipIds.length ? captionSourceClips(s.project, assets, clipIds).length : 0,
        timeline: captionSourceClips(s.project, assets).length,
      };
    }),
  );
  useFonts((s) => s.status); // the samples use the installed styles once they're known
  useEffect(() => useFonts.getState().load(), []);

  const [options, setOptions] = useState<CaptionOptions>(() => {
    // Captioning more clips: match the captions already there.
    const project = useEditor.getState().project;
    if (!captionClips(project).length) return saved;
    const animation = captionAnimationOf(project);
    return { ...saved, style: "current", animation: animation?.type ?? "none" };
  });
  const [scope, setScope] = useState<CaptionScope>(counts.selected ? "selection" : "timeline");
  const set = (patch: Partial<CaptionOptions>) => setOptions((o) => ({ ...o, ...patch }));

  const engine = engines?.find((e) => e.id === options.engine);
  const clips = scope === "selection" ? counts.selected : counts.timeline;
  const canGenerate = engine?.status === "ready" && clips > 0;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (canGenerate) void useCaptions.getState().generate(options, scope);
  };

  return (
    <form onSubmit={submit} className="grid gap-4">
      <Field label="Clips">
        <ToggleGroup
          type="single"
          spacing={2}
          value={scope}
          onValueChange={(v) => v && setScope(v as CaptionScope)}
          className="grid w-full grid-cols-2"
          aria-label="Clips"
        >
          <ToggleGroupItem value="selection" disabled={counts.selected === 0} className={optionClass}>
            {counts.selected ? `Selected clip${counts.selected === 1 ? "" : "s"} (${counts.selected})` : "Selected clips"}
          </ToggleGroupItem>
          <ToggleGroupItem value="timeline" disabled={counts.timeline === 0} className={optionClass}>
            Whole timeline
          </ToggleGroupItem>
        </ToggleGroup>
      </Field>

      <Field label="Language">
        <Select value={options.language} onValueChange={(language) => set({ language })}>
          <SelectTrigger className="w-full" aria-label="Language">
            <SelectValue />
          </SelectTrigger>
          <SelectContent position="popper" className="max-h-72">
            <SelectItem value="auto">Detect automatically</SelectItem>
            <SelectSeparator />
            {CAPTION_LANGUAGES.map((l) => (
              <SelectItem key={l.code} value={l.code}>
                {l.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      <Field label="Style">
        <StylePicker value={options.style} onChange={(style) => set({ style })} aspect={aspect} withCurrent={hasCaptions} />
      </Field>

      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-4">
        <Field label="Length">
          <ToggleGroup
            type="single"
            value={options.length}
            onValueChange={(v) => v && set({ length: v as CaptionLength })}
            className="grid w-full grid-cols-4 rounded-md bg-muted p-0.5"
            aria-label="Length"
          >
            {CAPTION_LENGTHS.map((l) => (
              <ToggleGroupItem key={l.value} value={l.value} title={l.hint} className={segmentClass}>
                {l.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </Field>
        <Field label="Animation">
          <AnimationSelect value={options.animation} onChange={(animation) => set({ animation })} />
        </Field>
      </div>

      <label className="flex cursor-pointer items-center justify-between gap-4 text-sm">
        <span>
          Punctuation
          <span className="block text-xs text-muted-foreground">Commas, full stops and question marks in the captions.</span>
        </span>
        <Switch checked={options.punctuation} onCheckedChange={(punctuation) => set({ punctuation })} aria-label="Punctuation" />
      </label>

      <Field label="Transcribe with">
        <EnginePicker value={options.engine} onChange={(engine) => set({ engine })} />
      </Field>

      {failure && (
        <div className="flex gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-2.5 text-xs text-destructive">
          <PiWarning className="mt-px size-4 shrink-0" />
          <p className="leading-relaxed">{failure}</p>
        </div>
      )}

      <WindowFooter className="items-center">
        {hasCaptions && (
          <p className="mr-auto text-xs text-muted-foreground">Replaces the captions over these clips.</p>
        )}
        <Button type="button" variant="ghost" onClick={close}>
          Cancel
        </Button>
        <Button type="submit" className={brandButton} disabled={!canGenerate}>
          <PiSparkle />
          Generate captions
        </Button>
      </WindowFooter>
    </form>
  );
}

const optionClass =
  "h-9 rounded-md border border-input text-[13px] hover:bg-accent/60 hover:text-foreground data-[state=on]:border-brand data-[state=on]:bg-brand/10 data-[state=on]:text-foreground data-[state=on]:ring-1 data-[state=on]:ring-brand";

const segmentClass =
  "h-7 min-w-0 rounded-[5px]! px-1 text-xs text-muted-foreground hover:bg-transparent hover:text-foreground data-[state=on]:bg-background data-[state=on]:text-foreground data-[state=on]:shadow-xs! dark:data-[state=on]:bg-accent";

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

/** The presets as little frames (and the captions' own look, when there are some). */
export function StylePicker({
  value,
  onChange,
  aspect,
  withCurrent,
  compact = false,
}: {
  value: string | null;
  onChange: (id: string) => void;
  aspect: Parameters<typeof presetStyle>[1];
  withCurrent: boolean;
  compact?: boolean;
}) {
  const current = useEditor((s) => {
    const first = s.project.clips.find((c) => c.caption);
    return first ? JSON.stringify(captionStyleOf(first).style) : null;
  });
  const tiles = useMemo(() => {
    const list = CAPTION_PRESETS.map((p) => ({ id: p.id, label: p.label, style: presetStyle(p, aspect) }));
    if (withCurrent && current) list.unshift({ id: "current", label: "Current", style: JSON.parse(current) });
    return list;
  }, [aspect, withCurrent, current]);

  return (
    <div role="radiogroup" aria-label="Caption style" className={cn("grid gap-1.5", compact ? "grid-cols-3" : "grid-cols-4")}>
      {tiles.map((t) => (
        <button
          key={t.id}
          type="button"
          role="radio"
          aria-checked={t.id === value}
          aria-label={t.label}
          onClick={() => onChange(t.id)}
          className={cn(
            "group grid cursor-pointer gap-1 rounded-lg p-1 text-left outline-none transition-colors hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring/50",
            t.id === value && "bg-brand/10 ring-1 ring-brand hover:bg-brand/10",
          )}
        >
          <CaptionSample style={t.style} px={compact ? 15 : 16} className={compact ? "h-11" : "h-12"} />
          <span className={cn("px-0.5 text-[11px] text-muted-foreground", t.id === value && "text-foreground")}>{t.label}</span>
        </button>
      ))}
    </div>
  );
}

/** None, the animations that suit captions, then every other transition. */
export function AnimationSelect({ value, onChange, className }: { value: string; onChange: (type: string) => void; className?: string }) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className={cn("w-36", className)} aria-label="Animation">
        <SelectValue />
      </SelectTrigger>
      <SelectContent position="popper" align="end" className="max-h-80">
        <SelectItem value="none">None</SelectItem>
        {CAPTION_ANIMATIONS.map((a) => (
          <SelectItem key={a.type} value={a.type}>
            {a.label}
          </SelectItem>
        ))}
        <SelectSeparator />
        <SelectGroup>
          <SelectLabel>More transitions</SelectLabel>
          {TRANSITIONS.filter((t) => !CURATED.has(t.type)).map((t) => (
            <SelectItem key={t.type} value={t.type}>
              {t.label}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}
