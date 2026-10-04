import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { errorMessage } from "@shared/errors";
import { fillMixerInserts, isMixRole, MIX_ROLES, ROLE_COLORS, ROLE_LABELS, type ChannelEvidence, type MixRole, type MixerSetupRequest, type MixerSetupResult } from "@shared/music/mixer-setup";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { musicApi } from "../api";
import { useMusic } from "../store";

function evidenceIdentity(channels: ChannelEvidence[]) {
  return JSON.stringify(channels.map(({ channelId, kind, preset, category, filename, supported }) => ({ channelId, kind, preset, category, filename, supported })));
}

/** Classification never writes the document; the final application is one atomic undo step. */
export function FillInsertsButton() {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [configured, setConfigured] = useState(false);
  const [key, setKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<MixerSetupResult | null>(null);
  const [choices, setChoices] = useState<Record<string, MixRole | "unknown">>({});
  const [overrides, setOverrides] = useState<NonNullable<MixerSetupRequest["overrides"]>>({});
  const snapshot = useRef<MixerSetupRequest | null>(null);
  const generation = useRef(0);
  useEffect(() => () => { generation.current++; }, []);

  const close = () => { generation.current++; setOpen(false); setBusy(false); setKey(""); };
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
        selected[channel.channelId] = channel.source === "rule" ? channel.role : managed && isMixRole(managed.setupRole) ? managed.setupRole : channel.role;
      }
      snapshot.current = request;
      setResult(data); setChoices(selected);
      if (data.channels.some((c) => c.supported) && data.channels.every((c) => !c.supported || isMixRole(selected[c.channelId]))) await apply(data, selected, request, token);
    } catch (err) { if (generation.current === token) setError(errorMessage(err)); }
    finally { if (generation.current === token) setBusy(false); }
  }
  async function start() {
    setOpen(true); setError(null); setResult(null); setOverrides({}); setBusy(true);
    const token = ++generation.current;
    try {
      const settings = await musicApi.mixerSetupSettings();
      if (generation.current !== token) return;
      setConfigured(settings.configured);
      if (settings.configured) await classify({});
    } catch (err) { if (generation.current === token) setError(errorMessage(err)); }
    finally { if (generation.current === token) setBusy(false); }
  }
  async function accept() {
    if (!result || !snapshot.current) return;
    const token = ++generation.current;
    setBusy(true); setError(null);
    try { await apply(result, choices, snapshot.current, token); }
    catch (err) { if (generation.current === token) setError(errorMessage(err)); }
    finally { if (generation.current === token) setBusy(false); }
  }
  return <>
    <Button variant="ghost" size="sm" onClick={() => void start()} disabled={busy} data-testid="fill-inserts" title="Classify Serum presets and sample filenames, then color and route their inserts">Fill inserts</Button>
    <Dialog open={open} onOpenChange={(value) => { if (!value) close(); }}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader><DialogTitle>Fill mixer inserts</DialogTitle><DialogDescription>Instruments in red, bass and 808s in blue, drums in yellow. Each goes through its bus to mixbus and Master.</DialogDescription></DialogHeader>
        {busy && <p role="status" className="text-sm text-muted-foreground">Reading preset names and classifying channels…</p>}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        {!busy && <label className="grid gap-1 text-sm">{configured ? "Replace Jev API key (optional)" : "Jev API key"}<Input type="password" autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)} placeholder={configured ? "Key configured" : "Paste your TypeSafe API key"} /><span className="text-xs text-muted-foreground">Saved locally. Only preset metadata and sample filenames are sent to Jev.</span></label>}
        {result && <div className="max-h-80 space-y-3 overflow-y-auto" data-testid="fill-inserts-results">{result.channels.map((channel) => <div key={channel.channelId} className="rounded border p-2">
          <div className="flex items-center justify-between gap-2"><div className="min-w-0"><p className="truncate text-sm font-medium">{channel.name}</p><p className="truncate text-xs text-muted-foreground" title={channel.filename ?? channel.preset ?? ""}>{channel.filename ?? channel.preset ?? "No preset name"}{channel.category ? ` · ${channel.category}` : ""}</p></div>
            {channel.supported ? <Select value={choices[channel.channelId] ?? "unknown"} disabled={busy} onValueChange={(value) => setChoices((old) => ({ ...old, [channel.channelId]: isMixRole(value) ? value : "unknown" }))}><SelectTrigger className="w-36" size="sm" aria-label={`Group for ${channel.name}`}><SelectValue /></SelectTrigger><SelectContent><SelectItem value="unknown">Leave unchanged</SelectItem>{MIX_ROLES.map((role) => <SelectItem key={role} value={role}><span style={{ color: ROLE_COLORS[role] }}>●</span> {ROLE_LABELS[role]}</SelectItem>)}</SelectContent></Select> : <span className="text-xs text-muted-foreground">Unsupported</span>}
          </div>
          {channel.issue && <p className="mt-1 text-xs text-muted-foreground">{channel.issue}</p>}
          {channel.supported && channel.kind === "plugin" && !channel.preset && <div className="mt-2 flex gap-2"><Input aria-label={`Preset name for ${channel.name}`} placeholder="Serum preset name" value={overrides[channel.channelId]?.preset ?? ""} disabled={busy} onChange={(e) => setOverrides((old) => ({ ...old, [channel.channelId]: { preset: e.target.value, category: old[channel.channelId]?.category ?? "" } }))} /><Input aria-label={`Preset category for ${channel.name}`} placeholder="Category (optional)" value={overrides[channel.channelId]?.category ?? ""} disabled={busy} onChange={(e) => setOverrides((old) => ({ ...old, [channel.channelId]: { preset: old[channel.channelId]?.preset ?? "", category: e.target.value } }))} /></div>}
        </div>)}</div>}
        <DialogFooter><Button variant="outline" onClick={close}>Cancel</Button><Button variant={result ? "outline" : "default"} disabled={busy || (!configured && !key.trim())} onClick={() => void classify()}>{result ? "Classify again" : "Fill inserts"}</Button>{result && <Button disabled={busy || !Object.values(choices).some(isMixRole)} onClick={() => void accept()}>Apply setup</Button>}</DialogFooter>
      </DialogContent>
    </Dialog>
  </>;
}
