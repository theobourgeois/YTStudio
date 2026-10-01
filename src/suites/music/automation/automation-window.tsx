import { useEffect, useRef } from "react";
import { PiCaretDownBold, PiChartLine } from "react-icons/pi";
import { cn } from "cn";
import { controlOf, updateAutomation } from "@shared/music/automation";
import { clipContext } from "@shared/music/playlist";
import { MAX_LFO_SPEED, MIN_LFO_SPEED } from "@shared/music/project";
import type { Automation, MusicProject } from "@shared/music/types";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { PERCENT, SongKnob, type ValueUnit, percent } from "../knob";
import { prepare } from "../piano/draw";
import { AUTOMATION, clipColours } from "../playlist/draw";
import { useMusic, useSong } from "../store";
import { automationWindow } from "../ui";
import { MusicWindow } from "../window";
import { AUTOMATION_TOOLS, type AutomationTool, closeAutomationWindow, deleteAutomations, runTool } from "./actions";
import { drawCurve } from "./draw-curve";

const PREVIEW_W = 360;
const PREVIEW_H = 84;
/** The LFO's speed knob turns through powers of two (a cycle every sixteen bars to 32 a bar). */
const SPEED_UNIT: ValueUnit = { scale: 1, unit: "log₂ cycles/bar", digits: 2 };

/** An LFO speed (cycles a bar) as said: "4 / bar", "1 / 4 bars". */
export function speedText(speed: number): string {
  if (speed >= 1) return `${Math.round(speed * 100) / 100} / bar`;
  return `1 / ${Math.round((1 / speed) * 100) / 100} bars`;
}

/**
 * An automation clip's window (FL Studio's automation clip settings, `docs/fl-studio/automation.md`): what
 * it drives, its curve, Min / Max, the LFO (added to the curve, or multiplying it) and the Tools. Opened by
 * a double-click on one of its clips, or its menus' Automation settings.
 */
export function AutomationWindow({ automation, index }: { automation: Automation; index: number }) {
  const song = useSong((s) => s);
  const info = controlOf(song, automation.target);
  const id = automation.id;
  const { lfo } = automation;
  const lfoOn = lfo.enabled && lfo.level !== 0;
  return (
    <MusicWindow id={automationWindow(id)} title={automation.name} initial={{ x: 160 + index * 28, y: 150 + index * 28 }} onClose={() => closeAutomationWindow(id)} className="w-[392px]">
      <div className="flex flex-col gap-2.5 p-3" data-testid="automation-window" data-automation={id}>
        <div className="flex items-center gap-2 text-[11px]">
          <PiChartLine className="size-4 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate" title={`${info.name} of ${info.owner}`}>
            {info.exists ? (
              <>
                Drives <span className="font-medium">{info.name}</span> of <span className="font-medium">{info.owner}</span>
              </>
            ) : (
              <span className="text-destructive">What it drove is gone ({info.owner}): it plays nothing.</span>
            )}
          </span>
          <ToolsMenu automation={automation} />
        </div>
        <CurvePreview automation={automation} />
        <div className="flex items-end gap-3">
          <Labelled label="MIN">
            <SongKnob size={28} label="Min" value={automation.min} min={0} max={1} defaultValue={0} format={(v) => info.format(v)} unit={PERCENT} edit={(s, min) => updateAutomation(s, id, { min })} />
          </Labelled>
          <Labelled label="MAX">
            <SongKnob size={28} label="Max" value={automation.max} min={0} max={1} defaultValue={1} format={(v) => info.format(v)} unit={PERCENT} edit={(s, max) => updateAutomation(s, id, { max })} />
          </Labelled>
          <div className="mx-1 h-10 w-px bg-line" aria-hidden />
          <fieldset className="flex items-end gap-2.5" aria-label="LFO">
            <Labelled label="LFO">
              <button
                type="button"
                aria-label="LFO"
                aria-pressed={lfo.enabled}
                title="The LFO: an oscillator added to the curve (or multiplying it), its points kept"
                className={cn("my-[7px] size-3.5 rounded-full border", lfo.enabled ? "border-brand-edge bg-brand shadow-[0_0_5px] shadow-brand/70" : "sunken")}
                onClick={() => commit((s) => updateAutomation(s, id, { lfo: { enabled: !lfo.enabled } }))}
              />
            </Labelled>
            <Labelled label="SPD">
              <SongKnob
                size={24}
                label="LFO speed"
                value={Math.log2(lfo.speed)}
                min={Math.log2(MIN_LFO_SPEED)}
                max={Math.log2(MAX_LFO_SPEED)}
                defaultValue={0}
                format={(v) => speedText(2 ** v)}
                unit={SPEED_UNIT}
                edit={(s, v) => updateAutomation(s, id, { lfo: { speed: 2 ** v } })}
              />
            </Labelled>
            <Labelled label="TENS">
              <SongKnob size={24} label="LFO tension" value={lfo.tension} min={-1} max={1} defaultValue={0} bipolar format={signedPercent} unit={PERCENT} edit={(s, tension) => updateAutomation(s, id, { lfo: { tension } })} />
            </Labelled>
            <Labelled label="SKEW">
              <SongKnob size={24} label="LFO skew" value={lfo.skew} min={0} max={1} defaultValue={0.5} format={percent} unit={PERCENT} edit={(s, skew) => updateAutomation(s, id, { lfo: { skew } })} />
            </Labelled>
            <Labelled label="LVL">
              <SongKnob size={24} label="LFO level" value={lfo.level} min={-1} max={1} defaultValue={0} bipolar format={signedPercent} unit={PERCENT} edit={(s, level) => updateAutomation(s, id, { lfo: { level } })} />
            </Labelled>
            <Labelled label="MULT">
              <button
                type="button"
                aria-label="Multiply"
                aria-pressed={lfo.multiply}
                title="Multiply: the LFO scales the curve (for a volume); off, it's added to it (for a pan)"
                className={cn("my-[5px] h-[18px] rounded-sm px-1.5 text-[10px] font-semibold", lfo.multiply ? "pressed text-brand" : "raised hover:raised-hover text-muted-foreground")}
                onClick={() => commit((s) => updateAutomation(s, id, { lfo: { multiply: !lfo.multiply } }))}
              >
                ×
              </button>
            </Labelled>
          </fieldset>
        </div>
        <p className="text-[10px] text-muted-foreground">
          {lfoOn ? "The dotted line is what's heard: the curve with the LFO. " : ""}It plays in song mode. On its clips: right-click the line to add a point, drag points and the
          small rings between them, right-click a point for its curve types.
        </p>
      </div>
    </MusicWindow>
  );
}

/** One edit of the song, now. */
const commit = (edit: (song: MusicProject) => MusicProject) => useMusic.getState().commit(edit);

const signedPercent = (v: number) => (Math.abs(v) < 0.005 ? "0%" : `${v > 0 ? "+" : "−"}${Math.round(Math.abs(v) * 100)}%`);

function Labelled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-0.5">
      {children}
      <span className="text-[9px] font-medium tracking-wide text-muted-foreground">{label}</span>
    </div>
  );
}

/** The window's Tools (FL's): flip, scale, normalise, decimate, smooth; delete. */
function ToolsMenu({ automation }: { automation: Automation }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className="raised hover:raised-hover flex h-5.5 shrink-0 items-center gap-1 rounded-sm px-1.5 text-[11px]">
          Tools <PiCaretDownBold className="size-2.5 text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {(Object.keys(AUTOMATION_TOOLS) as AutomationTool[]).map((tool) => (
          <DropdownMenuItem key={tool} onSelect={() => runTool(automation.id, tool)}>
            {AUTOMATION_TOOLS[tool].name}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onSelect={() => deleteAutomations([automation.id])}>
          Delete (and its clips)
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** The whole curve, as its clips draw it, in its colour. */
function CurvePreview({ automation }: { automation: Automation }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const barTicks = useSong((s) => clipContext(s).barTicks);
  useEffect(() => {
    const c = canvas.current && prepare(canvas.current, PREVIEW_W, PREVIEW_H);
    if (!c) return;
    const colours = automation.color ? clipColours(automation.color) : AUTOMATION;
    c.fillStyle = colours.body;
    c.fillRect(0, 0, PREVIEW_W, PREVIEW_H);
    drawCurve(c, automation, { x0: 6, pxPerTick: (PREVIEW_W - 12) / Math.max(1, automation.length), top: 4, height: PREVIEW_H - 8 }, 6, PREVIEW_W - 6, { line: colours.content, point: colours.title }, true, barTicks);
  }, [automation, barTicks]);
  return <canvas ref={canvas} className="sunken block rounded-sm" style={{ width: PREVIEW_W, height: PREVIEW_H }} aria-label={`${automation.name}'s curve`} />;
}
