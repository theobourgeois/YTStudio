import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { request } from "@/lib/api";
import { VOCAL_DESCRIPTIONS, VOCAL_LABELS, vocalRevision, type VocalMixRun, type VocalVariant } from "@shared/music/audio-intelligence/vocal-mix";
import { MASTER_TRACK_ID } from "@shared/music/project";
import { songTicks } from "@shared/music/playlist";
import { songSeconds, songTick, tempoMap } from "@shared/music/tempo";
import type { AudioArtifact } from "@shared/music/audio-intelligence/types";
import { useMusic, useSong } from "../store";
import { useTransport } from "../transport";
import { applyVocalMix, useVocalMix, vocalMixTool } from "./store";

export function VocalMixDialog() {
  const state = useVocalMix();
  const currentProject = useMusic(s => s.projectId);
  const open = state.open && state.projectId === currentProject;
  return <Dialog open={open} onOpenChange={value => { if (!value) state.close(); }}>
    <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl" aria-describedby="vocal-mix-description">
      <DialogHeader><DialogTitle>Vocal mix comparison</DialogTitle>
        <DialogDescription id="vocal-mix-description">Audition small vocal changes across two passages. Rendering stops playback. Your song changes only when you apply a choice.</DialogDescription>
      </DialogHeader>
      {open && currentProject && <VocalMixBody key={currentProject} projectId={currentProject} runId={state.runId} />}
    </DialogContent>
  </Dialog>;
}

function VocalMixBody({ projectId, runId }: { projectId: string; runId: string | null }) {
  const song = useSong(s => s);
  const [run, setRun] = useState<VocalMixRun | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [track, setTrack] = useState(() => song.mixer.tracks.find(t => t.id !== MASTER_TRACK_ID && /voc|voice/i.test(t.name ?? ""))?.id ?? "");
  const [first, setFirst] = useState(0);
  const [second, setSecond] = useState(() => Math.min(20, Math.max(10, songSeconds(song, songTicks(song)) - 10)));
  const [length, setLength] = useState(10);
  const [passage, setPassage] = useState(0);
  const [variant, setVariant] = useState<VocalVariant>("baseline");
  const [matched, setMatched] = useState(true);
  const [applied, setApplied] = useState(false);
  const [artifact, setArtifact] = useState<AudioArtifact | null>(null);
  const player = useRef<HTMLAudioElement>(null);
  const restore = useRef({ offset: 0, playing: false });
  useEffect(() => {
    if (!runId) { setRun(null); return; }
    let gone = false, timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const next = await vocalMixTool<VocalMixRun>(projectId, "get_vocal_mix_run", { runId });
        if (gone) return;
        setRun(next);
        if (["preparing", "rendering"].includes(next.status)) timer = setTimeout(poll, 1000);
      } catch (e) { if (!gone) setError(String(e)); }
    };
    void poll();
    return () => { gone = true; clearTimeout(timer); };
  }, [projectId, runId, refresh]);
  const selected = run?.candidates.find(c => c.variant === variant)?.renders[passage];
  const selectedId = selected?.artifactId;
  useEffect(() => {
    if (player.current) player.current.volume = matched ? Math.min(1, 10 ** ((selected?.auditionGainDb ?? 0) / 20)) : 1;
  }, [matched, selected?.auditionGainDb]);
  useEffect(() => {
    let gone = false;
    setArtifact(null);
    if (selectedId) void request<AudioArtifact>(`/api/music/audio/${projectId}/artifacts/${selectedId}`).then(a => { if (!gone) setArtifact(a); }).catch(e => { if (!gone) setError(String(e)); });
    return () => { gone = true; };
  }, [projectId, selectedId]);
  const rememberPosition = () => {
    const audio = player.current;
    restore.current = { offset: audio && artifact ? Math.max(0, audio.currentTime - (artifact.passage?.leadInFrames ?? 0) / artifact.format.sampleRate) : 0, playing: !!audio && !audio.paused };
    audio?.pause();
  };
  const start = async () => {
    setBusy(true); setError(null); setApplied(false);
    try {
      const current = useMusic.getState();
      if (current.projectId !== projectId || !current.history) throw new Error("Open this song first.");
      const doc = current.history.doc;
      const tick = (seconds: number) => Math.round(songTick(tempoMap(doc), seconds * doc.settings.tempo * 96 / 60));
      const bundle = await request<{ snapshot: { id: string } }>(`/api/music/audio/${projectId}/capture`, { method: "POST", body: JSON.stringify({ song: doc, live: true }) });
      const next = await vocalMixTool<VocalMixRun>(projectId, "create_vocal_mix_run", { snapshotId: bundle.snapshot.id, vocalTrackId: track,
        startTick: tick(first), endTick: tick(first + length), checkStartTick: tick(second), checkEndTick: tick(second + length) });
      setRun(next); setVariant("baseline"); useVocalMix.getState().remember(next.id);
    } catch (e) { setError(String(e)); } finally { setBusy(false); }
  };
  const apply = async () => {
    if (!run) return;
    setBusy(true); setError(null);
    try { player.current?.pause(); await applyVocalMix(projectId, run.id, variant); setApplied(true); }
    catch (e) { setError(String(e)); } finally { setBusy(false); }
  };
  const operation = async (name: string) => {
    if (!run) return;
    setBusy(true); setError(null);
    try {
      const next = await vocalMixTool<VocalMixRun>(projectId, name, { runId: run.id });
      setRun(next);
      if (next.status === "rendering") {
        // Refresh the polling effect after explicit restart.
        useVocalMix.getState().remember(next.id); setRefresh(n => n + 1);
      }
    } catch (e) { setError(String(e)); } finally { setBusy(false); }
  };
  const stale = !!run && vocalRevision(song) !== run.baseRevision;
  const rendering = !!run && ["preparing", "rendering"].includes(run.status);
  const unsafe = variant !== "baseline" && !!run?.candidates.find(c => c.variant === variant)?.renders.some(r => r.fullScaleFraction === null || r.fullScaleFraction > 0 || r.peakDbfs === null || r.peakDbfs >= 0);
  return <div className="grid gap-4 text-sm">
    <div className="grid gap-2 rounded-md border bg-surface-1 p-3">
      <label className="grid gap-1">Vocal mixer insert<select aria-label="Vocal mixer insert" className="rounded border bg-background p-2" value={track} onChange={e => setTrack(e.target.value)} disabled={busy || rendering}>
        <option value="">Choose the insert containing only your vocal</option>
        {song.mixer.tracks.filter(t => t.id !== MASTER_TRACK_ID).map((t, i) => <option key={t.id} value={t.id}>{t.name ?? `Insert ${i + 1}`}</option>)}
      </select></label>
      <div className="grid grid-cols-3 gap-2">{[["First start (s)", first, setFirst], ["Second start (s)", second, setSecond], ["Length (s)", length, setLength]].map(([label, value, setter]) =>
        <label key={String(label)} className="grid gap-1 text-xs">{String(label)}<Input aria-label={String(label)} type="number" min={0} value={Number(value)} disabled={busy || rendering} onChange={e => (setter as (v: number) => void)(Number(e.target.value))} /></label>)}
      </div>
      <p className="text-xs text-muted-foreground">Choose two nonoverlapping active passages, each 5–20 seconds. Fixed audition proposals; no model or upload is required.</p>
      <Button onClick={() => void start()} disabled={!track || busy || rendering}>{busy ? "Working…" : run ? "Start fresh comparison" : "Render alternatives"}</Button>
    </div>
    {error && <p role="alert" className="text-destructive">{error}</p>}
    {run && <>
      <p role="status">{run.status === "ready" ? "Both passages are ready to compare." : `Comparison: ${run.status}.`}</p>
      {run.error && <p role="alert" className="text-destructive">{run.error}</p>}
      {rendering && <Button variant="outline" onClick={() => void operation("cancel_vocal_mix_run")} disabled={busy}>Cancel comparison</Button>}
      {["interrupted", "failed"].includes(run.status) && <Button variant="outline" onClick={() => void operation("retry_vocal_mix_run")} disabled={busy}>Retry interrupted or failed jobs</Button>}
      {run.status === "ready" && <>
        <div className="flex flex-wrap gap-2">{[0, 1].map(i => <Button key={i} variant={passage === i ? "default" : "outline"} onClick={() => { if (i === passage) return; rememberPosition(); restore.current.offset = 0; setPassage(i); }}>Passage {i + 1}</Button>)}</div>
        <div className="grid grid-cols-2 gap-2">{run.candidates.map(c => <Button key={c.variant} variant={variant === c.variant ? "default" : "outline"} onClick={() => { if (variant === c.variant) return; rememberPosition(); setVariant(c.variant); }}>{VOCAL_LABELS[c.variant]}</Button>)}</div>
        <p>{VOCAL_DESCRIPTIONS[variant]}</p>
        <label className="flex gap-2"><input type="checkbox" checked={matched} onChange={e => setMatched(e.target.checked)} />Match listening levels</label>
        <p className="text-xs text-muted-foreground">RMS matching is approximate. Switch it off to check original output levels; matching gain is used only for playback.</p>
        {artifact && selectedId && <audio ref={player} controls preload="auto" className="w-full" src={`/api/music/audio/${projectId}/artifacts/${selectedId}/audio`}
          onLoadedMetadata={e => {
            const a = e.currentTarget, lead = (artifact.passage?.leadInFrames ?? 0) / artifact.format.sampleRate;
            a.currentTime = Math.min(lead + restore.current.offset, a.duration);
            a.volume = matched ? Math.min(1, 10 ** ((selected?.auditionGainDb ?? 0) / 20)) : 1;
            if (restore.current.playing) void a.play().catch(() => {});
          }} onPlay={() => { useTransport.getState().stop(); }} />}
        {artifact && <p className="text-xs text-muted-foreground">Playback includes effect tails. The player starts after the recorded warm-up.</p>}
        {stale && !applied && <p role="alert">The song changed. Start a fresh comparison before applying.</p>}
        {unsafe && <p role="alert">This alternative has insufficient measured headroom in at least one passage.</p>}
        <Button onClick={() => void apply()} disabled={busy || stale || unsafe}>{variant === "baseline" ? "Keep current mix" : "Apply selected alternative"}</Button>
        {applied && <p role="status">{variant === "baseline" ? "Current mix kept." : "Applied as one undo step. Use Undo to restore the previous mix."}</p>}
      </>}
    </>}
  </div>;
}
