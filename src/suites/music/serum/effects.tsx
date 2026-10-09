import { useRef, useState } from "react";
import { PiArrowLeft, PiArrowRight, PiCaretDown, PiCaretUp, PiCheck, PiDotsThree, PiPlus, PiPower, PiX } from "react-icons/pi";
import { cn } from "cn";
import {
  fxParamText,
  fxSteps,
  fxText,
  SERUM_EFFECT_KINDS,
  SERUM_EFFECTS,
  SERUM_FX_RACK_LABELS,
  SERUM_FX_RACKS,
  type SerumChainEntry,
  type SerumEffectState,
  type SerumFxControl,
  type SerumFxParam,
  type SerumFxRack,
  type SerumFxRackId,
} from "@shared/music/serum-effects";
import type { SerumSoundEdit } from "@shared/music/serum-sound";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Caption, CompKnob } from "../pro-c/knob";
import { SerumSection } from "./section";
import { effectAt, useSerumUi } from "./store";

const edit = (channelId: string, edits: SerumSoundEdit[], label?: string) => void useSerumUi.getState().edit(channelId, edits, label).catch(() => {});

const menuContent = "max-h-80 overflow-y-auto border-black/60 bg-[var(--serum-panel)] text-[var(--serum-text)]";
const menuItem = "gap-2 text-[12px] focus:bg-white/5 focus:text-[var(--serum-text)]";
const iconButton = "grid size-5 shrink-0 place-items-center rounded-sm text-[var(--serum-text-dim)] outline-none hover:bg-white/5 hover:text-[var(--serum-text)] disabled:opacity-30";

/**
 * Serum's effects (`docs/serum/player.md` §3.6): its three racks as tabs, each a row of cards in Serum's order. A card
 * is an effect's name, its mode, its switch and its main knobs, live (each linked to one of the rack's slots); its
 * expand shows the rest, which Serum takes as a new state when let go. Adding, removing, moving and Serum's saved
 * effects are reloads. Each change is a step of the player's undo.
 */
export function EffectsSection({ channelId, racks }: { channelId: string; racks: SerumFxRack[] }) {
  const busy = useSerumUi((s) => s.channels[channelId]?.busy ?? false);
  const [rackId, setRackId] = useState<SerumFxRackId>("main");
  /** The card showing all its settings: its place and kind, so it closes when another takes its place. */
  const [expanded, setExpanded] = useState<string | null>(null);
  if (!racks.length) return null;
  const rack = racks.find((r) => r.rack === rackId) ?? racks[0];
  const choose = (id: SerumFxRackId) => {
    setRackId(id);
    setExpanded(null);
  };
  return (
    <SerumSection
      label="Effects"
      testId="serum-effects"
      aside={
        <>
          <div className="mr-auto flex overflow-hidden rounded-[4px] border border-black/60 text-[11px]" role="tablist" aria-label="Effect racks">
            {racks.map((r) => (
              <button
                key={r.rack}
                type="button"
                role="tab"
                aria-selected={r.rack === rack.rack}
                className={cn("px-2 py-[3px] whitespace-nowrap outline-none", r.rack === rack.rack ? "bg-[var(--serum-tab-on)] text-[var(--serum-text)]" : "bg-[var(--serum-tab)] text-[var(--serum-text-dim)] hover:text-[var(--serum-text)]")}
                onClick={() => choose(r.rack)}
              >
                {SERUM_FX_RACK_LABELS[r.rack]}
                {r.effects.length > 0 && <span className="ml-1 text-[var(--serum-text-dim)]">{r.effects.length}</span>}
              </button>
            ))}
          </div>
          <AddEffect channelId={channelId} rack={rack.rack} disabled={busy} />
        </>
      }
    >
      {!rack.effects.length ? (
        <p className="rounded-[5px] border border-dashed border-[var(--serum-edge)] py-3 text-center text-[11px] text-[var(--serum-text-dim)]">
          {rack.rack === "main" ? "No effects: add one." : `Nothing on ${SERUM_FX_RACK_LABELS[rack.rack]}: add an effect, then send oscillators to it in Serum.`}
        </p>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(176px,1fr))] gap-1.5" role="list" aria-label={`${SERUM_FX_RACK_LABELS[rack.rack]} effects`}>
          {rack.effects.map((effect) => (
            <EffectCard
              key={`${effect.position}-${effect.effect}`}
              channelId={channelId}
              rack={rack.rack}
              effect={effect}
              count={rack.effects.length}
              expanded={expanded === `${effect.position}:${effect.effect}`}
              onExpand={() => setExpanded(expanded === `${effect.position}:${effect.effect}` ? null : `${effect.position}:${effect.effect}`)}
              disabled={busy}
            />
          ))}
        </div>
      )}
    </SerumSection>
  );
}

function EffectCard({
  channelId,
  rack,
  effect,
  count,
  expanded,
  onExpand,
  disabled,
}: {
  channelId: string;
  rack: SerumFxRackId;
  effect: SerumEffectState;
  count: number;
  expanded: boolean;
  onExpand: () => void;
  disabled: boolean;
}) {
  const spec = effect.effect ? SERUM_EFFECTS[effect.effect] : null;
  const on = !effect.enabled || effect.enabled.value >= 0.5;
  const name = spec?.name ?? "Unknown effect";
  const set = (key: string, value: number, gesture: "begin" | "drag" | "end" | "set") => useSerumUi.getState().setEffectControl(channelId, rack, effect.position, key, value, gesture);
  /** Where a control is now (a drag's own moves land in the store as it goes). */
  const latest = (key: string) => effectAt(useSerumUi.getState().channels[channelId]?.sound, rack, effect.position)?.controls.find((c) => c.key === key)?.value ?? 0;
  const mode = spec?.mode ? spec.params.find((p) => p.key === spec.mode) : undefined;
  const modeControl = mode && effect.controls.find((c) => c.key === mode.key);
  const shown = (p: SerumFxParam) => !p.hidden && p.key !== "kParamEnable";
  const rest = spec ? spec.params.filter((p) => shown(p) && p.key !== spec.mode && !spec.main.includes(p.key)) : [];
  return (
    <div
      role="listitem"
      aria-label={`${name} (${effect.position})`}
      data-effect={effect.effect ?? "unknown"}
      data-on={on}
      className={cn("flex min-w-0 flex-col rounded-[4px] border border-black/50 bg-[var(--serum-panel)] px-2 pt-1.5 pb-2", expanded && "col-span-full")}
    >
      <div className="flex min-w-0 items-center gap-1">
        {effect.enabled && (
          <button
            type="button"
            aria-pressed={on}
            aria-label={`${on ? "Bypass" : "Turn on"} ${name}`}
            title={on ? "On: bypass it" : "Bypassed: turn it on"}
            className={cn(iconButton, on && "text-[var(--serum-trace)] hover:text-[var(--serum-trace)]")}
            onClick={() => set("kParamEnable", on ? 0 : 1, "set")}
          >
            <PiPower />
          </button>
        )}
        <span className={cn("truncate text-[12px] font-semibold", on ? "text-[var(--serum-text)]" : "text-[var(--serum-text-dim)]")}>{name}</span>
        {mode && modeControl && <ChoiceMenu param={mode} control={modeControl} onPick={(v) => set(mode.key, v, "set")} disabled={disabled && !modeControl.param} />}
        {effect.impulse && (
          <span className="truncate text-[10.5px] text-[var(--serum-text-dim)]" title={`Impulse: ${effect.impulse}`}>
            {effect.impulse}
          </span>
        )}
        <div className="ml-auto flex shrink-0 items-center">
          <EffectMenu channelId={channelId} rack={rack} effect={effect} name={name} count={count} disabled={disabled} />
          {rest.length > 0 && (
            <button type="button" aria-expanded={expanded} aria-label={`${expanded ? "Fewer" : "All"} ${name} settings`} title={expanded ? "Fewer settings" : "All its settings"} className={iconButton} onClick={onExpand}>
              {expanded ? <PiCaretUp /> : <PiCaretDown />}
            </button>
          )}
        </div>
      </div>
      {spec && (
        <div className={cn("mt-1.5 flex flex-wrap justify-around gap-x-1 gap-y-2", !on && "opacity-45")}>
          {spec.main.map((key) => {
            const param = spec.params.find((p) => p.key === key)!;
            const control = effect.controls.find((c) => c.key === key);
            return control && <FxKnob key={key} name={name} param={param} control={control} effect={effect} size={38} latest={() => latest(key)} onSet={(v, g) => set(key, v, g)} />;
          })}
        </div>
      )}
      {expanded && rest.length > 0 && (
        <div className={cn("mt-2 grid grid-cols-[repeat(auto-fill,minmax(64px,1fr))] gap-x-1 gap-y-2 border-t border-black/40 pt-2", !on && "opacity-45")} data-testid="serum-effect-settings">
          {rest.map((param) => {
            const control = effect.controls.find((c) => c.key === param.key);
            if (!control) return null;
            if (param.scale.kind === "switch" || param.scale.kind === "options")
              return (
                <div key={param.key} className="flex min-w-0 flex-col items-center gap-1">
                  <ChoiceMenu param={param} control={control} onPick={(v) => set(param.key, v, "set")} disabled={disabled && !control.param} boxed />
                  <Caption className="max-w-full truncate text-[9.5px] tracking-normal normal-case">{control.name ?? param.label}</Caption>
                </div>
              );
            return <FxKnob key={param.key} name={name} param={param} control={control} effect={effect} size={30} latest={() => latest(param.key)} onSet={(v, g) => set(param.key, v, g)} />;
          })}
        </div>
      )}
    </div>
  );
}

/**
 * An effect's knob. Linked to a slot it turns live; otherwise it moves here alone while dragged and Serum takes it as a
 * new state when let go. Serum's own text shows at rest, ours while it moves.
 */
function FxKnob({
  name,
  param,
  control,
  effect,
  size,
  latest,
  onSet,
}: {
  name: string;
  param: SerumFxParam;
  control: SerumFxControl;
  /** Its effect as it is (its sync switch decides a time's text). */
  effect: SerumEffectState;
  size: number;
  /** Where it is now in the player's store. */
  latest: () => number;
  onSet: (value: number, gesture: "begin" | "drag" | "end" | "set") => void;
}) {
  const [held, setHeld] = useState<number | null>(null);
  const holding = useRef<number | null>(null);
  const live = control.param !== null;
  const value = held ?? control.value;
  const label = control.name ?? param.label;
  const format = (v: number) => (v === control.value && control.text ? control.text : fxParamText(param, v, effect));
  const hold = (v: number | null) => {
    holding.current = v;
    setHeld(v);
  };
  const end = () => {
    onSet(live ? latest() : (holding.current ?? latest()), "end");
    hold(null);
  };
  return (
    <div className="flex min-w-0 flex-col items-center" data-param={param.spec} data-slot={control.param ?? undefined}>
      <CompKnob
        value={value}
        defaultValue={param.default}
        label={`${name} ${label.toLowerCase()}`}
        format={format}
        size={size}
        onBegin={() => (live ? onSet(latest(), "begin") : hold(latest()))}
        onDrag={(v) => (live ? onSet(v, "drag") : hold(v))}
        onEnd={end}
        onCancel={end}
        onSet={(v) => onSet(v, "set")}
        caption={<Caption className={cn("max-w-full truncate tracking-normal normal-case", size < 36 ? "text-[9.5px]" : "text-[10.5px]")}>{label}</Caption>}
      />
      <span className="max-w-full truncate text-[10px] text-[var(--serum-text-dim)] tabular-nums">{format(value)}</span>
    </div>
  );
}

/** A choice (a mode, a type, a switch of the rest) as a menu of its options: live when it's linked, else a reload. */
function ChoiceMenu({ param, control, onPick, disabled, boxed }: { param: SerumFxParam; control: SerumFxControl; onPick: (value: number) => void; disabled?: boolean; boxed?: boolean }) {
  const steps = fxSteps(param.scale) ?? [];
  const now = control.text || fxText(param.scale, control.value);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          aria-label={control.name ?? param.label}
          className={cn(
            "flex min-w-0 items-center gap-0.5 rounded-sm px-1 py-0.5 text-[11px] text-[var(--serum-text-dim)] outline-none hover:bg-white/5 hover:text-[var(--serum-text)]",
            boxed && "max-w-full border border-[var(--serum-edge)] bg-[var(--serum-display)]",
          )}
        >
          <span className="truncate">{now}</span>
          <PiCaretDown className="size-2.5 shrink-0 opacity-70" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className={cn(menuContent, "w-44")}>
        {steps.map((step) => (
          <DropdownMenuItem key={step.label} className={menuItem} onSelect={() => onPick(step.value)}>
            <span className="flex-1">{step.label}</span>
            {step.label === now && <PiCheck className="size-3 text-[var(--serum-trace)]" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** An effect's menu: moved along its rack or to another, or taken out. */
function EffectMenu({ channelId, rack, effect, name, count, disabled }: { channelId: string; rack: SerumFxRackId; effect: SerumEffectState; name: string; count: number; disabled: boolean }) {
  const move = (at: number, toRack?: SerumFxRackId) =>
    edit(channelId, [{ kind: "moveEffect", rack, position: effect.position, at, ...(toRack && { toRack }) }], `Move ${name}${toRack ? ` to ${SERUM_FX_RACK_LABELS[toRack]}` : ""}`);
  const others = SERUM_FX_RACKS.filter((r) => r !== rack);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" disabled={disabled} aria-label={`${name} menu`} title="Move or remove it" className={iconButton}>
          <PiDotsThree />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className={cn(menuContent, "w-44")}>
        <DropdownMenuItem className={menuItem} disabled={effect.position <= 1} onSelect={() => move(effect.position - 1)}>
          <PiArrowLeft className="size-3" /> Move earlier
        </DropdownMenuItem>
        <DropdownMenuItem className={menuItem} disabled={effect.position >= count} onSelect={() => move(effect.position + 1)}>
          <PiArrowRight className="size-3" /> Move later
        </DropdownMenuItem>
        {others.map((r) => (
          <DropdownMenuItem
            key={r}
            className={menuItem}
            onSelect={() => move((useSerumUi.getState().channels[channelId]?.sound?.effects.find((x) => x.rack === r)?.effects.length ?? 0) + 1, r)}
          >
            <span className="w-3" /> Move to {SERUM_FX_RACK_LABELS[r]}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem className={menuItem} onSelect={() => edit(channelId, [{ kind: "removeEffect", rack, position: effect.position }], `Remove ${name}`)}>
          <PiX className="size-3" /> Remove
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Saved effects or racks grouped by their first folder ("Reverb", "FX Rack"). */
function byFolder(chains: readonly SerumChainEntry[]): [string, SerumChainEntry[]][] {
  const groups = new Map<string, SerumChainEntry[]>();
  for (const chain of chains) {
    const top = chain.folder.split("/")[0] || "Other";
    groups.set(top, [...(groups.get(top) ?? []), chain]);
  }
  return [...groups];
}

const addButton = "flex h-5 items-center gap-1 rounded-[4px] border border-black/60 bg-[var(--serum-tab)] px-2 text-[11px] text-[var(--serum-text-dim)] outline-none hover:text-[var(--serum-text)] disabled:opacity-40";

/** + Add: any of Serum's effects at the end of the rack, or one of its saved effects, or a saved rack in its place. */
function AddEffect({ channelId, rack, disabled }: { channelId: string; rack: SerumFxRackId; disabled: boolean }) {
  const chains = useSerumUi((s) => s.chains);
  const label = SERUM_FX_RACK_LABELS[rack];
  const effects = byFolder((chains ?? []).filter((c) => c.kind === "effect"));
  const racks = byFolder((chains ?? []).filter((c) => c.kind === "rack"));
  const putIn = (chain: SerumChainEntry) => edit(channelId, [{ kind: "effectChain", rack, path: chain.path }], `Load ${chain.name}`);
  return (
    <DropdownMenu onOpenChange={(open) => open && void useSerumUi.getState().loadChains()}>
      <DropdownMenuTrigger asChild>
        <button type="button" className={addButton} disabled={disabled} aria-label={`Add an effect to ${label}`}>
          <PiPlus className="size-2.5" /> Add
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className={cn(menuContent, "w-48")}>
        {SERUM_EFFECT_KINDS.map((kind) => (
          <DropdownMenuItem key={kind} className={menuItem} onSelect={() => edit(channelId, [{ kind: "addEffect", rack, effect: kind }], `Add ${SERUM_EFFECTS[kind].name}`)}>
            {SERUM_EFFECTS[kind].name}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        {chains === null ? (
          <DropdownMenuLabel className="text-[11px] font-normal text-[var(--serum-text-dim)]">Reading Serum's saved effects…</DropdownMenuLabel>
        ) : !chains.length ? (
          <DropdownMenuLabel className="text-[11px] font-normal text-[var(--serum-text-dim)]">Serum has no saved effects here.</DropdownMenuLabel>
        ) : (
          <>
            <ChainMenu title="Saved effects" groups={effects} onPick={putIn} />
            <ChainMenu title={`Saved racks (replace ${label})`} groups={racks} onPick={putIn} />
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ChainMenu({ title, groups, onPick }: { title: string; groups: [string, SerumChainEntry[]][]; onPick: (chain: SerumChainEntry) => void }) {
  if (!groups.length) return null;
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger className={menuItem}>{title}</DropdownMenuSubTrigger>
      <DropdownMenuSubContent className={cn(menuContent, "w-48")}>
        {groups.map(([folder, list]) => (
          <DropdownMenuSub key={folder}>
            <DropdownMenuSubTrigger className={menuItem}>{folder}</DropdownMenuSubTrigger>
            <DropdownMenuSubContent className={cn(menuContent, "w-56")}>
              {list.map((chain) => (
                <DropdownMenuItem key={chain.path} className={menuItem} onSelect={() => onPick(chain)} title={chain.folder}>
                  <span className="truncate">{chain.name}</span>
                  {chain.folder.endsWith("/User") && <span className="ml-auto text-[10px] text-[var(--serum-text-dim)]">yours</span>}
                </DropdownMenuItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        ))}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}
