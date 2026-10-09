import { useState } from "react";
import { PiArrowRight, PiPlus, PiPower, PiX } from "react-icons/pi";
import { cn } from "cn";
import { errorMessage } from "@shared/errors";
import { modAmountOf, modAmountToValue, routesBySource, SERUM_MOD_SOURCES, type SerumModRoute, type SerumSoundEdit } from "@shared/music/serum-sound";
import { Button } from "@/components/ui/button";
import { Knob } from "../knob";
import { NamePicker } from "./name-picker";
import { useSerumUi } from "./store";

/** What a route can come from: every source but None. */
const SOURCES = SERUM_MOD_SOURCES.slice(1);
const AMOUNT_UNIT = { scale: 1, unit: "%" };

const edit = (channelId: string, edits: SerumSoundEdit[], label?: string) => void useSerumUi.getState().edit(channelId, edits, label).catch(() => {});

/**
 * The mod matrix as readable rows (`docs/serum/player.md` §3.4): `source (aux) → destination`, its amount, grouped
 * by source. An amount turns live; the rest (bipolar, bypass, a source or destination changed, a route added or
 * removed) is a reload, which the engine makes without a click.
 */
export function ModulationSection({ channelId, routes }: { channelId: string; routes: SerumModRoute[] | null }) {
  const busy = useSerumUi((s) => s.channels[channelId]?.busy ?? false);
  return (
    <section className="border-t border-line px-3 py-2.5" aria-label="Modulation" data-testid="serum-modulation">
      <div className="mb-1.5 flex items-center gap-2">
        <h3 className="text-[11px] font-medium text-muted-foreground">Modulation</h3>
        {routes && <span className="text-[11px] text-muted-foreground">{routes.length ? `${routes.length} route${routes.length === 1 ? "" : "s"}` : ""}</span>}
        {routes && <AddRoute channelId={channelId} disabled={busy} />}
      </div>
      {!routes ? (
        <p className="py-1 text-[11px] text-muted-foreground">Load a preset to see what it modulates.</p>
      ) : !routes.length ? (
        <p className="py-1 text-[11px] text-muted-foreground">Nothing is modulated: add a route.</p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {routesBySource(routes).map((group) => (
            <div key={group.source} role="group" aria-label={group.source} className="flex flex-col">
              {group.routes.map((route, i) => (
                <RouteRow key={route.slot} channelId={channelId} route={route} first={i === 0} disabled={busy} />
              ))}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function RouteRow({ channelId, route, first, disabled }: { channelId: string; route: SerumModRoute; first: boolean; disabled: boolean }) {
  const destinations = useSerumUi((s) => s.channels[channelId]?.destinations ?? null);
  const name = `${route.source} → ${route.to}`;
  const set = (value: number, gesture: "begin" | "drag" | "end" | "set") => useSerumUi.getState().setControl(channelId, route.amount.param, value, gesture, `${name} amount`);
  const latest = () => useSerumUi.getState().channels[channelId]?.sound?.modulation?.find((r) => r.slot === route.slot)?.amount.value ?? route.amount.value;
  return (
    <div className={cn("flex h-7 items-center gap-1.5 text-[12px]", route.bypass && "opacity-50")} data-slot={route.slot} aria-label={name}>
      <NamePicker options={SOURCES} value={route.source} label="Source" onPick={(source) => edit(channelId, [{ kind: "route", slot: route.slot, source }], `${route.to}: from ${source}`)}>
        <button
          type="button"
          disabled={disabled}
          title={`Slot ${route.slot}: change its source`}
          className={cn("w-24 shrink-0 truncate rounded-sm px-1 text-left hover:bg-accent/60", first ? "font-medium" : "text-muted-foreground/60")}
        >
          {route.source}
          {route.aux && <span className="ml-1 text-[10px] text-muted-foreground">× {route.aux}</span>}
        </button>
      </NamePicker>
      <PiArrowRight className="size-3 shrink-0 text-muted-foreground" />
      <NamePicker
        options={destinations}
        value={route.to}
        label="Destination"
        onOpen={() => void useSerumUi.getState().loadDestinations(channelId)}
        onPick={(to) => edit(channelId, [{ kind: "route", slot: route.slot, to }], `${route.source}: to ${to}`)}
      >
        <button type="button" disabled={disabled} title="Change its destination" className="min-w-0 flex-1 truncate rounded-sm px-1 text-left hover:bg-accent/60">
          {route.to}
        </button>
      </NamePicker>
      <Knob
        value={modAmountOf(route.amount.value)}
        min={-100}
        max={100}
        defaultValue={0}
        bipolar
        label={`${name} amount`}
        format={(v) => `${Math.round(v)}%`}
        unit={AMOUNT_UNIT}
        size={20}
        onBegin={() => set(latest(), "begin")}
        onDrag={(v) => set(modAmountToValue(v), "drag")}
        onEnd={() => set(latest(), "end")}
        onCancel={() => set(latest(), "end")}
        onSet={(v) => set(modAmountToValue(v), "set")}
      />
      <span className="w-10 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground">{Math.round(modAmountOf(route.amount.value))}%</span>
      <button
        type="button"
        disabled={disabled}
        aria-pressed={route.bipolar}
        title="Bipolar: the source swings both ways"
        className={cn("h-5 w-6 shrink-0 rounded-sm border border-line text-[11px]", route.bipolar ? "pressed text-foreground" : "text-muted-foreground hover:text-foreground")}
        onClick={() => edit(channelId, [{ kind: "route", slot: route.slot, bipolar: !route.bipolar }], `${name}: ${route.bipolar ? "unipolar" : "bipolar"}`)}
      >
        ±
      </button>
      <Button
        variant="ghost"
        size="icon-xs"
        disabled={disabled}
        aria-pressed={route.bypass}
        aria-label={`Bypass ${name}`}
        title={route.bypass ? "Bypassed: turn it on" : "Bypass it"}
        onClick={() => edit(channelId, [{ kind: "route", slot: route.slot, bypass: !route.bypass }], `${name}: ${route.bypass ? "on" : "bypassed"}`)}
      >
        <PiPower className={route.bypass ? "text-muted-foreground" : "text-foreground"} />
      </Button>
      <Button variant="ghost" size="icon-xs" disabled={disabled} aria-label={`Remove ${name}`} title="Remove the route" onClick={() => edit(channelId, [{ kind: "removeRoute", slot: route.slot }], `Remove ${name}`)}>
        <PiX />
      </Button>
    </div>
  );
}

/** + Add: a source, then a destination; the route starts at 50%. */
function AddRoute({ channelId, disabled }: { channelId: string; disabled: boolean }) {
  const destinations = useSerumUi((s) => s.channels[channelId]?.destinations ?? null);
  const [source, setSource] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="ml-auto flex items-center gap-1">
      {error && <span className="max-w-60 truncate text-[11px] text-destructive" title={error}>{error}</span>}
      {source ? (
        <>
          <span className="text-[11px] text-muted-foreground">{source} →</span>
          <NamePicker
            options={destinations}
            label="Destination"
            onOpen={() => void useSerumUi.getState().loadDestinations(channelId)}
            onPick={(to) => {
              const from = source;
              setSource(null);
              void useSerumUi
                .getState()
                .edit(channelId, [{ kind: "route", source: from, to }], `Add ${from} → ${to}`)
                .then(() => setError(null), (err) => setError(errorMessage(err)));
            }}
          >
            <Button variant="outline" size="sm" className="h-6 px-2 text-[11px]">
              Pick a destination
            </Button>
          </NamePicker>
          <Button variant="ghost" size="icon-xs" aria-label="Don't add a route" onClick={() => setSource(null)}>
            <PiX />
          </Button>
        </>
      ) : (
        <NamePicker options={SOURCES} label="Source" onPick={(s) => setSource(s)}>
          <Button variant="outline" size="sm" className="h-6 gap-1 px-2 text-[11px]" disabled={disabled}>
            <PiPlus className="size-3" /> Add
          </Button>
        </NamePicker>
      )}
    </div>
  );
}
