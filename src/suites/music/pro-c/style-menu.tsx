/**
 * Pro-C's Style button and its menu (`docs/fabfilter/pro-c.md` 2.4): the four groups, each style with
 * what it's for; and the Character button under it (2.5), whose pop-over picks the saturation, its Drive
 * and whether it's before or after the compression. The wheel over the Character button steps its modes,
 * as Pro-C's does.
 */
import { useEffect, useRef } from "react";
import { PiCheck } from "react-icons/pi";
import { cn } from "cn";
import { PRO_C_GROUPS, PRO_C_STYLE_INFO, styleGroup } from "@shared/music/pro-c-presets";
import { PRO_C_CHARACTERS, type ProC, type ProCCharacter, type ProCStyle } from "@shared/music/types";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { setProC } from "./actions";
import { Caption, SongBarSlider } from "./knob";
import { controlProps } from "./specs";

export function StyleButton({ effectId, proC }: { effectId: string; proC: ProC }) {
  const group = styleGroup(proC.style);
  const choose = (style: ProCStyle) => setProC(effectId, { style });
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          data-testid="pro-c-style"
          aria-label={`Style: ${PRO_C_STYLE_INFO[proC.style].name}`}
          title={PRO_C_STYLE_INFO[proC.style].detail}
          className="relative h-[30px] w-[118px] rounded-[7px] border border-[var(--comp-knob-edge)] bg-gradient-to-b from-[var(--comp-button-top)] to-[var(--comp-button-bottom)] px-2 text-[12.5px] font-semibold tracking-wide text-[var(--comp-text)] shadow-[0_2px_6px_rgba(0,0,0,0.5),inset_0_1px_0_rgba(255,255,255,0.08)] outline-none hover:from-[var(--comp-button-hover)] hover:text-white data-[state=open]:from-[var(--comp-button-hover)]"
        >
          {PRO_C_STYLE_INFO[proC.style].name}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="center" className="w-40" data-testid="pro-c-style-menu">
        {PRO_C_GROUPS.map((g) => (
          <DropdownMenuSub key={g.id}>
            <DropdownMenuSubTrigger className="gap-1.5">
              <PiCheck className={cn("size-3.5", g.id === group ? "text-foreground" : "invisible")} />
              {g.name}
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="w-[340px]">
              {g.styles.map((style) => (
                <DropdownMenuItem key={style} onSelect={() => choose(style)} className="items-start gap-1.5 py-1.5">
                  <PiCheck className={cn("mt-0.5 size-3.5", style === proC.style ? "text-foreground" : "invisible")} />
                  <span className="flex min-w-0 flex-col">
                    <span className="font-medium">{PRO_C_STYLE_INFO[style].name}</span>
                    <span className="text-[11px] leading-snug text-muted-foreground">{PRO_C_STYLE_INFO[style].detail}</span>
                  </span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const CHARACTER_NAMES: Record<ProCCharacter, string> = { off: "Off", tube: "Tube", diode: "Diode", bright: "Bright" };

/** Pro-C's Character icon: a little horseshoe of a tube's filament (red while a mode is on). */
function CharacterIcon({ on }: { on: boolean }) {
  return (
    <svg viewBox="0 0 16 16" className="size-[15px]" aria-hidden>
      <rect x="2.5" y="2" width="11" height="12" rx="3.5" fill="none" stroke={on ? "var(--comp-character)" : "currentColor"} strokeWidth="1.3" />
      <path d="M5.5 10.5 V7 a2.5 2.5 0 0 1 5 0 V10.5" fill="none" stroke={on ? "var(--comp-character)" : "currentColor"} strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

export function CharacterButton({ effectId, proC }: { effectId: string; proC: ProC }) {
  const button = useRef<HTMLButtonElement>(null);
  const mode = proC.character.mode;
  const latest = useRef(mode);
  latest.current = mode;
  // The wheel over it steps the modes.
  useEffect(() => {
    const element = button.current;
    if (!element) return;
    const onWheel = (e: WheelEvent) => {
      if (e.deltaY === 0) return;
      e.preventDefault();
      const at = PRO_C_CHARACTERS.indexOf(latest.current);
      const next = PRO_C_CHARACTERS[Math.max(0, Math.min(PRO_C_CHARACTERS.length - 1, at + (e.deltaY < 0 ? 1 : -1)))];
      if (next !== latest.current) setProC(effectId, { character: { mode: next } });
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, [effectId]);
  const drive = controlProps(effectId, proC, "drive");
  const segment = (on: boolean) => cn("flex-1 rounded-[4px] px-2 py-1 text-[11.5px] font-medium transition-colors outline-none", on ? "bg-gradient-to-b from-[var(--comp-button-hover)] to-[var(--comp-button-top)] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.12),0_1px_2px_rgba(0,0,0,0.5)]" : "text-[var(--comp-label)] hover:text-[var(--comp-text)]");
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          ref={button}
          type="button"
          aria-label={`Character: ${CHARACTER_NAMES[mode]}`}
          title={`Character: ${CHARACTER_NAMES[mode]}${mode !== "off" ? ` (${Math.round(proC.character.drive * 100)}%, ${proC.character.post ? "post" : "pre"})` : ""}: the scroll wheel steps the modes`}
          data-testid="pro-c-character"
          className={cn("grid size-6 place-items-center rounded-sm outline-none", mode !== "off" ? "text-[var(--comp-character)]" : "text-[var(--comp-label)] hover:text-[var(--comp-text)]")}
        >
          <CharacterIcon on={mode !== "off"} />
        </button>
      </PopoverTrigger>
      <PopoverContent align="center" side="bottom" className="w-[280px] border-[var(--comp-panel-edge)] bg-[var(--comp-panel)] p-3 text-[var(--comp-text)] shadow-xl" data-testid="pro-c-character-panel">
        <Caption className="mt-0 mb-2.5 text-[var(--comp-label)]">Character</Caption>
        <div className="flex gap-0.5 rounded-md bg-black/35 p-0.5" role="radiogroup" aria-label="Character mode">
          {PRO_C_CHARACTERS.map((m) => (
            <button key={m} type="button" role="radio" aria-checked={m === mode} className={segment(m === mode)} onClick={() => setProC(effectId, { character: { mode: m } })}>
              {CHARACTER_NAMES[m]}
            </button>
          ))}
        </div>
        <div className="mt-3 flex items-center gap-3">
          <div className="flex flex-1 flex-col items-center gap-1">
            <SongBarSlider {...drive} length={150} disabled={mode === "off"} colour="linear-gradient(90deg, var(--comp-drive), var(--comp-character))" testId="pro-c-knob-drive" />
            <Caption className="mt-0.5" disabled={mode === "off"}>
              Drive
            </Caption>
          </div>
          <button
            type="button"
            aria-pressed={proC.character.post}
            title={proC.character.post ? "After the compression: it saturates what's left of the transients" : "Before the compression: the input's peaks saturated first"}
            className="flex items-center gap-1.5 rounded-[5px] border border-[var(--comp-knob-edge)] bg-black/30 px-2 py-1 text-[11px] font-semibold tracking-wider outline-none hover:bg-black/45"
            onClick={() => setProC(effectId, { character: { post: !proC.character.post } })}
          >
            <span className={cn("size-1.5 rounded-full", !proC.character.post ? "bg-[var(--comp-character)]" : "bg-white/20")} />
            {proC.character.post ? "POST" : "PRE"}
            <span className={cn("size-1.5 rounded-full", proC.character.post ? "bg-[var(--comp-character)]" : "bg-white/20")} />
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
