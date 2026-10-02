import { useEffect, useMemo, useRef, useState } from "react";
import { PiCaretRightFill, PiChartLine, PiCursorClick, PiMagnifyingGlass, PiPlug, PiSpinnerGap } from "react-icons/pi";
import { cn } from "cn";
import { errorMessage } from "@shared/errors";
import { targetKey } from "@shared/music/automation";
import type { EngineParameter, PluginParameter } from "@shared/music/engine";
import { Input } from "@/components/ui/input";
import { musicApi } from "../api";
import { useSong } from "../store";
import { useTransport } from "../transport";
import { MusicWindow, centredOnDesktop } from "../window";
import { automateParameter, createAutomationClip } from "./actions";
import { type ControlRow, type PluginOwner, matches, pluginOwners, songControls } from "./controls";
import { useAutomationUi } from "./store";

const W = 380;
/** The most of a plugin's parameters listed at once (some have thousands): typing finds the rest. */
const MOST_ROWS = 300;
const H = 460;

/**
 * Automate… (the Picker's automation tab): every control of the song in one list, to make an automation
 * clip of one, better than FL Studio's Tools → Last tweaked (Théo): the parameter last touched in a
 * plugin's window first, then the song's, the channels' and the mixer's controls, then each plugin's own
 * parameters (asked of the engine as its section opens, or as something's typed). Typing finds any of
 * them by name or owner.
 */
export function AutomationChooser() {
  const song = useSong((s) => s);
  const touched = useAutomationUi((s) => s.touched);
  const touchedControl = useAutomationUi((s) => s.touchedControl);
  const [query, setQuery] = useState("");
  const field = useRef<HTMLInputElement>(null);
  const groups = useMemo(() => songControls(song), [song]);
  const owners = useMemo(() => pluginOwners(song), [song]);
  const close = () => useAutomationUi.setState({ chooserOpen: false });
  useEffect(() => {
    const timer = setTimeout(() => field.current?.focus(), 0);
    return () => clearTimeout(timer);
  }, []);
  const pick = (row: ControlRow) => {
    if (createAutomationClip(row.target)) close();
  };
  const pickParameter = (p: PluginParameter) => {
    if (automateParameter(p)) close();
  };
  const touchedOwner = touched && owners.find((o) => o.owner === touched.owner && o.id === touched.id);
  // The editor's own control last touched (a knob, one of our effects'), if it's still there.
  const lastControl = useMemo(() => (touchedControl ? groups.flatMap((g) => g.rows).find((r) => r.key === targetKey(touchedControl)) ?? null : null), [groups, touchedControl]);

  return (
    <MusicWindow id="automate" title="Automate" initial={{ ...centredOnDesktop(W, H), width: W, height: H }} onClose={close} resizable={{ minWidth: 300, minHeight: 240 }}>
      <div className="flex min-h-0 flex-1 flex-col" data-testid="automate-window">
        <label className="flex items-center gap-1.5 border-b border-line px-2 py-1.5">
          <PiMagnifyingGlass className="size-3.5 shrink-0 text-muted-foreground" />
          <Input
            ref={field}
            aria-label="Find a control"
            placeholder="Find a control: “cutoff”, “kick vol”…"
            className="h-7 text-xs"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Escape") close();
            }}
          />
        </label>
        <div className="min-h-0 flex-1 overflow-y-auto py-1 text-[12px]">
          {touched && touchedOwner && matches(query, touched.name, touchedOwner.name) && (
            <Section title="Last touched in a plugin's window" icon={<PiCursorClick className="size-3" />}>
              <Row name={touched.name} owner={touchedOwner.name} detail={touched.text} onPick={() => pickParameter(touched)} />
            </Section>
          )}
          {lastControl && matches(query, lastControl.name, lastControl.owner) && (
            <Section title="Last touched" icon={<PiCursorClick className="size-3" />}>
              <Row name={lastControl.name} owner={lastControl.owner} automated={lastControl.automated} onPick={() => pick(lastControl)} />
            </Section>
          )}
          {groups.map((group) => {
            const rows = group.rows.filter((r) => matches(query, r.name, r.owner));
            if (!rows.length) return null;
            return (
              <Section key={group.title} title={group.title}>
                {rows.map((row) => (
                  <Row key={row.key} name={row.name} owner={row.owner} automated={row.automated} onPick={() => pick(row)} />
                ))}
              </Section>
            );
          })}
          {owners.map((owner) => (
            <PluginSection key={`${owner.owner}:${owner.id}`} owner={owner} query={query} onPick={pickParameter} />
          ))}
        </div>
        <p className="border-t border-line px-2.5 py-1.5 text-[10px] text-muted-foreground">
          Or touch a parameter in a plugin's window and press Automate in its title bar. A clip covers the Playlist's time selection, or the whole song.
        </p>
      </div>
    </MusicWindow>
  );
}

function Section({ title, icon, children }: { title: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="pb-1">
      <h3 className="flex items-center gap-1 px-2.5 pt-1.5 pb-0.5 text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">
        {icon}
        {title}
      </h3>
      {children}
    </section>
  );
}

function Row({ name, owner, detail, automated, onPick }: { name: string; owner: string; detail?: string; automated?: boolean; onPick: () => void }) {
  return (
    <button
      type="button"
      className="flex w-full items-center gap-2 px-2.5 py-1 text-left hover:bg-surface-2 focus-visible:bg-surface-2"
      title={`Make an automation clip of ${name} (${owner})`}
      onClick={onPick}
    >
      <span className="min-w-0 truncate">{name}</span>
      <span className="min-w-0 flex-1 truncate text-muted-foreground">{owner}</span>
      {detail && <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">{detail}</span>}
      {automated && <PiChartLine className="size-3.5 shrink-0 text-brand" aria-label="Automated" />}
    </button>
  );
}

/** A plugin's own parameters: asked of the engine when the section opens (or something's typed). */
function PluginSection({ owner, query, onPick }: { owner: PluginOwner; query: string; onPick: (p: PluginParameter) => void }) {
  const [open, setOpen] = useState(false);
  const loaded = useTransport((s) => (owner.owner === "channel" ? s.channels.loaded.some((c) => c.channel === owner.id) : s.effects.loaded.some((e) => e.effect === owner.id)));
  const [list, setList] = useState<EngineParameter[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const searching = query.trim().length > 0;
  const shown = open || searching;
  useEffect(() => {
    if (!shown || list || !loaded) return;
    let stale = false;
    musicApi.pluginParameters(owner.owner, owner.id).then(
      (parameters) => !stale && setList(parameters),
      (err) => !stale && setError(errorMessage(err)),
    );
    return () => {
      stale = true;
    };
  }, [shown, list, loaded, owner.owner, owner.id]);
  const rows = (list ?? []).filter((p) => matches(query, p.name, owner.name));
  if (searching && list && !rows.length && !matches(query, owner.name)) return null;
  return (
    <section className="pb-1">
      <button
        type="button"
        aria-expanded={shown}
        className="flex w-full items-center gap-1 px-2.5 pt-1.5 pb-0.5 text-left text-[10px] font-semibold tracking-wide text-muted-foreground uppercase hover:text-foreground"
        onClick={() => setOpen(!open)}
      >
        <PiCaretRightFill className={cn("size-2.5 transition-transform", shown && "rotate-90")} />
        <PiPlug className="size-3" />
        <span className="truncate">{owner.name}</span>
      </button>
      {shown &&
        (!loaded ? (
          <p className="px-6 py-1 text-[11px] text-muted-foreground">Its plugin isn't loaded (yet).</p>
        ) : error ? (
          <p className="px-6 py-1 text-[11px] text-destructive">{error}</p>
        ) : !list ? (
          <p className="flex items-center gap-1 px-6 py-1 text-[11px] text-muted-foreground">
            <PiSpinnerGap className="size-3 animate-spin" /> Asking the plugin…
          </p>
        ) : (
          rows.slice(0, MOST_ROWS).map((p) => (
            <Row
              key={p.id}
              name={p.name}
              owner={owner.name}
              detail={p.text}
              onPick={() => onPick({ owner: owner.owner, id: owner.id, index: p.index, param: p.id, name: p.name, value: p.value, text: p.text })}
            />
          ))
        ))}
      {shown && rows.length > MOST_ROWS && <p className="px-6 py-1 text-[11px] text-muted-foreground">{rows.length - MOST_ROWS} more: type to find one.</p>}
    </section>
  );
}
