import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { errorMessage } from "@shared/errors";
import { fillMixerInserts, isMixRole, MIX_ROLES, ROLE_COLORS, ROLE_LABELS, type ChannelEvidence, type MixRole, type MixerSetupRequest, type MixerSetupResult } from "@shared/music/mixer-setup";
import { Button } from "@/components/ui/button";
import { keyLabel } from "@/lib/key-labels";
import { useGridSelection } from "@/components/media/use-grid-selection";
import { cn } from "cn";
import { PiCheckBold, PiGearSix, PiMagnifyingGlass, PiSpinnerGap, PiWaveform, PiPianoKeys } from "react-icons/pi";
import { MusicWindow, centredOnDesktop } from "../window";
import { useMusicUi, useMusicWindows } from "../ui";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { musicApi } from "../api";
import { useMusic } from "../store";

function evidenceIdentity(channels: ChannelEvidence[]) {
  return JSON.stringify(channels.map(({ channelId, kind, preset, category, filename, supported }) => ({ channelId, kind, preset, category, filename, supported })));
}

/** Classification never writes the document; the final application is one atomic undo step. */
export function FillInsertsButton() {
  return <Button variant="ghost" size="sm" onClick={() => {
    useMusicUi.setState({ fillInsertsOpen: true });
    useMusicWindows.getState().focus("fill-inserts");
  }} data-testid="fill-inserts" title="Organize channels into colored mixer inserts and buses">Fill inserts</Button>;
}

export function FillInsertsWindow() {
  const [busy, setBusy] = useState(false);
  const [configured, setConfigured] = useState(false);
  const [key, setKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<MixerSetupResult | null>(null);
  const [choices, setChoices] = useState<Record<string, MixRole | "unknown">>({});
  const [overrides, setOverrides] = useState<NonNullable<MixerSetupRequest["overrides"]>>({});
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [reviewOnly, setReviewOnly] = useState(false);
  const manual = useRef<Record<string, MixRole | "unknown">>({});
  const visible = (result?.channels ?? []).filter((c) => (!reviewOnly || c.supported && !isMixRole(choices[c.channelId])) && `${c.name} ${c.preset ?? ""} ${c.filename ?? ""} ${c.category ?? ""}`.toLowerCase().includes(search.toLowerCase()));
  const order = visible.filter((c) => c.supported).map((c) => c.channelId);
  const selection = useGridSelection(order, { dragItems: true, onDelete: (ids) => assign("unknown", ids) });
  const selectedIds = order.filter(selection.isSelected);
  const unresolved = result?.channels.filter((c) => c.supported && !isMixRole(choices[c.channelId])).length ?? 0;
  const assigned = result?.channels.filter((c) => c.supported && isMixRole(choices[c.channelId])).length ?? 0;
  function assign(role: MixRole | "unknown", ids = selectedIds) {
    if (busy) return;
    const changes = Object.fromEntries(ids.map((id) => [id, role]));
    manual.current = { ...manual.current, ...changes };
    setChoices((old) => ({ ...old, ...changes }));
  }
  const snapshot = useRef<MixerSetupRequest | null>(null);
  const generation = useRef(0);
  useEffect(() => () => { generation.current++; }, []);

  const close = () => { generation.current++; useMusicUi.setState({ fillInsertsOpen: false }); setBusy(false); setKey(""); };
  async function apply(data: MixerSetupResult, selected: Record<string, MixRole | "unknown">, request: MixerSetupRequest, token: number) {
    const before = useMusic.getState();
    if (before.projectId !== request.projectId || before.history?.doc !== request.song) throw new Error("The song changed. Run classification again before filling inserts.");
    const evidence = await musicApi.mixerSetupEvidence(request);
    if (generation.current !== token) return;
    const current = useMusic.getState();
    if (current.projectId !== request.projectId || current.history?.doc !== request.song || evidenceIdentity(evidence) !== evidenceIdentity(data.channels)) throw new Error("The song, samples, or Serum preset changed. Run classification again.");
    const assignments = new Map<string, MixRole>();
    for (const channel of data.channels) if (channel.supported && isMixRole(selected[channel.channelId])) assignments.set(channel.channelId, selected[channel.channelId] as MixRole);
    if (!assignments.size) throw new Error("Choose a group for at least one channel.");
    const names = new Map(data.channels.map((c) => [c.channelId, c.preset || c.filename?.replace(/\.[^.]+$/, "") || request.song.mixer.tracks.find((t) => t.setupChannel === c.channelId)?.name || c.name]));
    const next = fillMixerInserts(request.song, assignments, names);
    current.commit((song) => song === request.song ? next : song);
    close();
    const skipped = data.channels.length - assignments.size;
    toast.success(`Filled ${assignments.size} inserts`, { description: `Routed through instr, bass, and drums → mixbus → Master.${skipped ? ` ${skipped} channels left unchanged.` : ""} Undo restores the setup.` });
  }
  async function classify(inputOverrides = overrides) {
    const token = ++generation.current;
    setBusy(true); setError(null);
    try {
      if (key.trim()) { const settings = await musicApi.setMixerSetupKey(key.trim()); setConfigured(settings.configured); setKey(""); }
      if (generation.current !== token) return;
      const { projectId, history } = useMusic.getState();
      if (!projectId || !history) throw new Error("Open a song first.");
      const request: MixerSetupRequest = { projectId, song: history.doc, overrides: inputOverrides };
      const data = await musicApi.classifyMixer(request);
      if (generation.current !== token) return;
      const current = useMusic.getState();
      if (current.projectId !== projectId || current.history?.doc !== request.song) throw new Error("The song changed. Run classification again.");
      const selected: Record<string, MixRole | "unknown"> = {};
      for (const channel of data.channels) {
        const managed = request.song.mixer.tracks.find((t) => t.setupChannel === channel.channelId);
        selected[channel.channelId] = manual.current[channel.channelId] ?? (channel.source === "rule" ? channel.role : managed && isMixRole(managed.setupRole) ? managed.setupRole : channel.role);
      }
      snapshot.current = request;
      setResult(data); setChoices(selected);
      selection.select(data.channels.filter((c) => c.supported && !isMixRole(selected[c.channelId])).map((c) => c.channelId));
      setSettingsOpen(false);
    } catch (err) { if (generation.current === token) setError(errorMessage(err)); }
    finally { if (generation.current === token) setBusy(false); }
  }
  async function start() {
    setError(null); setResult(null); setOverrides({}); setBusy(true);
    const token = ++generation.current;
    try {
      const settings = await musicApi.mixerSetupSettings();
      if (generation.current !== token) return;
      setConfigured(settings.configured);
      setSettingsOpen(!settings.configured);
      if (settings.configured) await classify({});
    } catch (err) { if (generation.current === token) setError(errorMessage(err)); }
    finally { if (generation.current === token) setBusy(false); }
  }
  useEffect(() => { void start(); }, []);

  async function accept() {
    if (!result || !snapshot.current) return;
    const token = ++generation.current;
    setBusy(true); setError(null);
    try { await apply(result, choices, snapshot.current, token); }
    catch (err) { if (generation.current === token) setError(errorMessage(err)); }
    finally { if (generation.current === token) setBusy(false); }
  }
  return (
    <MusicWindow id="fill-inserts" title="Fill mixer inserts" initial={{ ...centredOnDesktop(680, 600), width: 680, height: 600 }} resizable={{ minWidth: 510, minHeight: 380 }} keepsKeys onClose={close}>
      <div className="flex min-h-0 flex-1 flex-col" data-testid="fill-inserts-window" aria-busy={busy}>
        <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
          <div><h2 className="text-sm font-semibold">Organize your mix</h2><p className="mt-0.5 text-xs text-muted-foreground">Select sounds. Pick a group. We handle the inserts and routing.</p></div>
          <Button variant="ghost" size="icon-sm" aria-label="Jev settings" aria-pressed={settingsOpen} onClick={() => setSettingsOpen((v) => !v)}><PiGearSix /></Button>
        </div>
        {settingsOpen && <div className="border-b bg-muted/30 px-4 py-3"><label className="grid gap-1.5 text-xs font-medium">Jev API key<Input type="password" autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)} placeholder={configured ? "Paste a replacement key" : "Paste your TypeSafe API key"} disabled={busy} data-autofocus={!configured || undefined} /></label><p className="mt-1.5 text-[11px] text-muted-foreground">{configured ? "Key saved locally. " : "Saved locally. "}Only preset names, categories, and sample filenames are sent.</p></div>}
        {error && <p role="alert" className="border-b bg-destructive/10 px-4 py-2 text-xs text-destructive">{error}</p>}
        {result && <>
          <div className="flex items-center gap-2 border-b px-3 py-2">
            <div className="relative min-w-0 flex-1"><PiMagnifyingGlass className="absolute left-2 top-2 size-3.5 text-muted-foreground" /><Input className="h-7 pl-7 text-xs" placeholder="Find a sound…" aria-label="Find a sound" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
            <Button variant={reviewOnly ? "default" : "ghost"} size="sm" aria-pressed={reviewOnly} onClick={() => setReviewOnly((v) => !v)}>Needs a group{unresolved ? ` · ${unresolved}` : ""}</Button>
          </div>
          <div className="border-b bg-muted/20 px-3 py-2.5">
            <div className="mb-2 flex items-center justify-between text-[11px]"><span className="font-medium">{selectedIds.length ? `${selectedIds.length} selected` : "Select sounds to change their group"}</span><div className="flex gap-3"><button className="text-muted-foreground hover:text-foreground" onClick={() => selection.select(order)} disabled={busy}>Select all</button><button className="text-muted-foreground hover:text-foreground" onClick={selection.clear}>Clear</button></div></div>
            <div className="flex gap-2">{MIX_ROLES.map((role) => <Button key={role} variant="outline" className="min-w-0 flex-1" disabled={busy || !selectedIds.length} onClick={() => assign(role)} aria-label={`Make selected ${ROLE_LABELS[role].toLowerCase()}`}><span className="size-2 rounded-full" style={{ background: ROLE_COLORS[role] }} />{ROLE_LABELS[role]}<span className="ml-auto text-[11px] text-muted-foreground">{result.channels.filter((c) => choices[c.channelId] === role).length}</span></Button>)}<Button variant="ghost" disabled={busy || !selectedIds.length} onClick={() => assign("unknown")} title="Leave selected sounds unchanged">Skip</Button></div>
          </div>
          <div {...selection.containerProps} onKeyDown={(e) => {
            selection.containerProps.onKeyDown(e);
            if (e.defaultPrevented || busy || !selectedIds.length || (e.target as Element).closest("input, textarea, button, [role=combobox]") || e.metaKey || e.ctrlKey || e.altKey) return;
            const role = MIX_ROLES[Number(e.key) - 1];
            if (/^[123]$/.test(e.key) && role) { e.preventDefault(); assign(role); }
          }} className="relative min-h-0 flex-1 overflow-y-auto" data-testid="fill-inserts-results">
            <div ref={selection.contentRef} tabIndex={0} role="listbox" aria-label="Sounds to organize" aria-multiselectable="true" className="min-h-full select-none py-1 outline-none" data-autofocus>
              {visible.map((channel) => {
                const selected = selection.isSelected(channel.channelId);
                const role = choices[channel.channelId];
                const color = isMixRole(role) ? ROLE_COLORS[role] : undefined;
                return <div key={channel.channelId} data-grid-item={channel.supported ? channel.channelId : undefined} role="option" aria-selected={selected} aria-disabled={!channel.supported} className={cn("mx-2 rounded-md border border-transparent", selected ? "border-brand/30 bg-brand/12" : "hover:bg-muted/40", !channel.supported && "opacity-50")} onClick={(e) => { if (channel.supported && !(e.target as Element).closest("button, input, [role=combobox]")) { selection.contentRef.current?.focus({ preventScroll: true }); selection.click(e, channel.channelId); } }}>
                  <div className="flex items-center gap-2.5 px-2 py-1.5">
                    <span className={cn("grid size-4 shrink-0 place-items-center rounded border", selected ? "border-brand bg-brand text-brand-foreground" : "border-muted-foreground/35")} aria-hidden>{selected && <PiCheckBold className="size-3" />}</span>
                    <span className="grid size-7 shrink-0 place-items-center rounded bg-muted/50" style={{ color }}>{channel.kind === "plugin" ? <PiPianoKeys className="size-4" /> : <PiWaveform className="size-4" />}</span>
                    <div className="min-w-0 flex-1"><p className="truncate text-xs font-medium" title={channel.preset ?? channel.filename ?? channel.name}>{channel.preset ?? channel.filename?.replace(/\.[^.]+$/, "") ?? channel.name}</p><p className="mt-0.5 truncate text-[10px] text-muted-foreground">{channel.kind === "plugin" ? `Serum${channel.category ? ` · ${channel.category}` : ""}` : "Sample"}{!channel.preset && channel.kind === "plugin" ? " · Preset name unavailable" : ""}{channel.supported && !isMixRole(role) ? " · Needs a group" : ""}</p></div>
                    {channel.supported ? <Select value={role ?? "unknown"} disabled={busy} onValueChange={(value) => assign(isMixRole(value) ? value : "unknown", [channel.channelId])}><SelectTrigger className="w-32 text-xs" size="sm" aria-label={`Group for ${channel.preset ?? channel.name}`}><SelectValue /></SelectTrigger><SelectContent><SelectItem value="unknown">Skip</SelectItem>{MIX_ROLES.map((group) => <SelectItem key={group} value={group}><span style={{ color: ROLE_COLORS[group] }}>●</span> {ROLE_LABELS[group]}</SelectItem>)}</SelectContent></Select> : <span className="text-[10px] text-muted-foreground">Unsupported</span>}
                  </div>
                  {channel.supported && channel.kind === "plugin" && !channel.preset && <div className="mb-2 ml-9 mr-2 flex gap-2"><Input className="h-7 text-xs" aria-label={`Preset name for ${channel.name}`} placeholder="Serum preset name" value={overrides[channel.channelId]?.preset ?? ""} disabled={busy} onChange={(e) => setOverrides((old) => ({ ...old, [channel.channelId]: { preset: e.target.value, category: old[channel.channelId]?.category ?? "" } }))} /><Input className="h-7 text-xs" aria-label={`Preset category for ${channel.name}`} placeholder="Category" value={overrides[channel.channelId]?.category ?? ""} disabled={busy} onChange={(e) => setOverrides((old) => ({ ...old, [channel.channelId]: { preset: old[channel.channelId]?.preset ?? "", category: e.target.value } }))} /></div>}
                </div>;
              })}
              {!visible.length && <p className="p-8 text-center text-xs text-muted-foreground">{reviewOnly ? "Every sound has a group. Ready to fill." : "No sounds match your search."}</p>}
            </div>
            {selection.marquee}
          </div>
          <p className="border-t px-3 py-1.5 text-[10px] text-muted-foreground">{keyLabel("Drag to select · ⌘ adds · Shift selects a range · 1 Instruments / 2 Bass / 3 Drums")}</p>
        </>}
        {!result && <div className="flex min-h-20 flex-1 flex-col items-center justify-center gap-2 p-6 text-center text-muted-foreground">{busy ? <><PiSpinnerGap className="size-6 animate-spin" /><p role="status" className="text-xs">Reading your sounds…</p></> : <><PiWaveform className="size-8" /><p className="text-sm font-medium text-foreground">Your mixer, organized in one pass</p><p className="max-w-72 text-xs">Add your Jev key, then let it group your Serum presets and samples.</p></>}</div>}
        <div className="flex items-center justify-between gap-3 border-t bg-muted/20 px-3 py-2.5">
          <span className="text-[11px] text-muted-foreground">{busy ? <span role="status" className="flex items-center gap-1.5"><PiSpinnerGap className="animate-spin" />Working…</span> : result ? `${assigned} inserts ready${unresolved ? ` · ${unresolved} skipped` : ""}` : "Instruments → Bass → Drums"}</span>
          <div className="flex gap-2"><Button variant="ghost" size="sm" disabled={busy || (!configured && !key.trim())} onClick={() => void classify()}>{result ? "Reclassify" : "Classify sounds"}</Button>{result && <Button size="sm" disabled={busy || !assigned} onClick={() => void accept()}>Fill {assigned} inserts</Button>}</div>
        </div>
      </div>
    </MusicWindow>
  );
}
