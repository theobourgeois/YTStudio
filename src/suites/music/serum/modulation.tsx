import { useState } from "react";
import { PiArrowRight, PiPlus, PiPower, PiX } from "react-icons/pi";
import { cn } from "cn";
import { errorMessage } from "@shared/errors";
import { modAmountOf, modAmountToValue, routesBySource, SERUM_MOD_SOURCES, type SerumModRoute, type SerumSoundEdit } from "@shared/music/serum-sound";
import { BarSlider } from "../pro-c/knob";
import { sourceHue } from "./look";
import { NamePicker } from "./name-picker";
import { SerumSection } from "./section";
import { useSerumUi } from "./store";

/** What a route can come from: every source but None. */
const SOURCES = SERUM_MOD_SOURCES.slice(1);

const edit = (channelId: string, edits: SerumSoundEdit[], label?: string) => void useSerumUi.getState().edit(channelId, edits, label).catch(() => {});

const iconButton = "grid size-5 shrink-0 place-items-center rounded-sm text-[var(--serum-text-dim)] outline-none hover:bg-white/5 hover:text-[var(--serum-text)] disabled:opacity-30";

/**
 * The mod matrix (`docs/serum/player.md` §3.4), as Serum's matrix reads: a row a route, its source in its kind's
 * colour (envelopes green, LFOs blue, macros amber), its destination, its amount a bar from the middle. An amount
 * turns live; the rest (bipolar, bypass, a source or destination changed, a route added or removed) is a reload,
 * which the engine makes without a click.
 */
export function ModulationSection({ channelId, routes }: { channelId: string; routes: SerumModRoute[] | null }) {
  const busy = useSerumUi((s) => s.channels[channelId]?.busy ?? false);
  return (
    <SerumSection
      title="Modulation"
      label="Modulation"
      testId="serum-modulation"
      aside={
        routes && (
          <>
            {routes.length > 0 && <span className="text-[11px] text-[var(--serum-text-dim)]">{routes.length} route{routes.length === 1 ? "" : "s"}</span>}
            <AddRoute channelId={channelId} disabled={busy} />
          </>
        )
      }
    >
      {!routes ? (
        <p className="text-[11px] text-[var(--serum-text-dim)]">Load a preset to see what it modulates.</p>
      ) : !routes.length ? (
        <p className="rounded-[5px] border border-dashed border-[var(--serum-edge)] py-3 text-center text-[11px] text-[var(--serum-text-dim)]">Nothing is modulated: add a route.</p>
      ) : (
        <div className="overflow-hidden rounded-[5px] border border-black/60 bg-[var(--serum-display)]">
          {routesBySource(routes).map((group) => (
            <div key={group.source} role="group" aria-label={group.source} className="border-b border-black/40 last:border-b-0">
              {group.routes.map((route, i) => (
                <RouteRow key={route.slot} channelId={channelId} route={route} first={i === 0} disabled={busy} />
              ))}
            </div>
          ))}
        </div>
      )}
    </SerumSection>
  );
}

function RouteRow({ channelId, route, first, disabled }: { channelId: string; route: SerumModRoute; first: boolean; disabled: boolean }) {
  const destinations = useSerumUi((s) => s.channels[channelId]?.destinations ?? null);
  const name = `${route.source} → ${route.to}`;
  const hue = sourceHue(route.source);
  const set = (value: number, gesture: "begin" | "drag" | "end" | "set") => useSerumUi.getState().setControl(channelId, route.amount.param, value, gesture, `${name} amount`);
  const latest = () => useSerumUi.getState().channels[channelId]?.sound?.modulation?.find((r) => r.slot === route.slot)?.amount.value ?? route.amount.value;
  const amount = Math.round(modAmountOf(route.amount.value));
  return (
    <div className={cn("flex h-8 items-center gap-2 px-2 text-[12px] hover:bg-white/[0.03]", route.bypass && "opacity-45")} data-slot={route.slot} aria-label={name}>
      <NamePicker options={SOURCES} value={route.source} label="Source" onPick={(source) => edit(channelId, [{ kind: "route", slot: route.slot, source }], `${route.to}: from ${source}`)}>
        <button
          type="button"
          disabled={disabled}
          title={`Slot ${route.slot}: change its source`}
          className={cn("flex w-[104px] shrink-0 items-center gap-1.5 rounded-sm px-1.5 py-0.5 text-left outline-none hover:bg-white/5", !first && "opacity-60")}
        >
          <span className="h-3 w-[3px] shrink-0 rounded-full" style={{ background: hue }} />
          <span className="truncate font-semibold" style={{ color: hue }}>
            {route.source}
          </span>
          {route.aux && <span className="truncate text-[10px] text-[var(--serum-text-dim)]">× {route.aux}</span>}
        </button>
      </NamePicker>
      <PiArrowRight className="size-3 shrink-0 text-[var(--serum-text-dim)]" />
      <NamePicker
        options={destinations}
        value={route.to}
        label="Destination"
        onOpen={() => void useSerumUi.getState().loadDestinations(channelId)}
        onPick={(to) => edit(channelId, [{ kind: "route", slot: route.slot, to }], `${route.source}: to ${to}`)}
      >
        <button type="button" disabled={disabled} title="Change its destination" className="min-w-0 flex-1 truncate rounded-sm px-1 py-0.5 text-left text-[var(--serum-text)] outline-none hover:bg-white/5">
          {route.to}
        </button>
      </NamePicker>
      <BarSlider
        value={route.amount.value}
        defaultValue={0.5}
        bipolar
        length={92}
        colour={hue}
        label={`${name} amount`}
        format={(v) => `${Math.round(modAmountOf(v))}%`}
        onBegin={() => set(latest(), "begin")}
        onDrag={(v) => set(v, "drag")}
        onEnd={() => set(latest(), "end")}
        onCancel={() => set(latest(), "end")}
        onSet={(v) => set(v, "set")}
        parse={(text) => {
          const n = Number.parseFloat(text.replace(",", "."));
          return Number.isFinite(n) ? modAmountToValue(n) : null;
        }}
        typed={(v) => String(Math.round(modAmountOf(v)))}
      />
      <span className={cn("w-9 shrink-0 text-right text-[11px] tabular-nums", amount === 0 ? "text-[var(--serum-text-dim)]" : "text-[var(--serum-value)]")}>{amount}%</span>
      <button
        type="button"
        disabled={disabled}
        aria-pressed={route.bipolar}
        title="Bipolar: the source swings both ways"
        className={cn(
          "h-5 w-6 shrink-0 rounded-[3px] border text-[11px] font-semibold outline-none",
          route.bipolar ? "border-[var(--serum-trace)] text-[var(--serum-trace)]" : "border-[var(--serum-edge)] text-[var(--serum-text-dim)] hover:text-[var(--serum-text)]",
        )}
        onClick={() => edit(channelId, [{ kind: "route", slot: route.slot, bipolar: !route.bipolar }], `${name}: ${route.bipolar ? "unipolar" : "bipolar"}`)}
      >
        ±
      </button>
      <button
        type="button"
        disabled={disabled}
        aria-pressed={route.bypass}
        aria-label={`Bypass ${name}`}
        title={route.bypass ? "Bypassed: turn it on" : "Bypass it"}
        className={iconButton}
        onClick={() => edit(channelId, [{ kind: "route", slot: route.slot, bypass: !route.bypass }], `${name}: ${route.bypass ? "on" : "bypassed"}`)}
      >
        <PiPower className={route.bypass ? "text-[var(--serum-hot)]" : ""} />
      </button>
      <button type="button" disabled={disabled} aria-label={`Remove ${name}`} title="Remove the route" className={iconButton} onClick={() => edit(channelId, [{ kind: "removeRoute", slot: route.slot }], `Remove ${name}`)}>
        <PiX />
      </button>
    </div>
  );
}

const addButton = "flex h-5 items-center gap-1 rounded-[4px] border border-black/60 bg-[var(--serum-tab)] px-2 text-[11px] text-[var(--serum-text-dim)] outline-none hover:text-[var(--serum-text)] disabled:opacity-40";

/** + Add: a source, then a destination; the route starts at 50%. */
function AddRoute({ channelId, disabled }: { channelId: string; disabled: boolean }) {
  const destinations = useSerumUi((s) => s.channels[channelId]?.destinations ?? null);
  const [source, setSource] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex items-center gap-1">
      {error && (
        <span className="max-w-60 truncate text-[11px] text-destructive" title={error}>
          {error}
        </span>
      )}
      {source ? (
        <>
          <span className="text-[10.5px] font-semibold" style={{ color: sourceHue(source) }}>
            {source} →
          </span>
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
            <button type="button" className={addButton}>
              Pick a destination
            </button>
          </NamePicker>
          <button type="button" className={iconButton} aria-label="Don't add a route" onClick={() => setSource(null)}>
            <PiX />
          </button>
        </>
      ) : (
        <NamePicker options={SOURCES} label="Source" onPick={(s) => setSource(s)}>
          <button type="button" className={addButton} disabled={disabled}>
            <PiPlus className="size-2.5" /> Add
          </button>
        </NamePicker>
      )}
    </div>
  );
}
