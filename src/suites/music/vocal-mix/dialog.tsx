import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { request } from "@/lib/api";
import { vocalRevision, type VocalMixRun } from "@shared/music/audio-intelligence/vocal-mix";
import { VOCAL_LEVEL_TARGETS, type VocalLevel } from "@shared/music/audio-intelligence/vocal-analysis";
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
        <DialogDescription id="vocal-mix-description">Measure the vocal against the beat over two passages, then audition the changes the measurements suggest. Rendering stops playback. Your song changes only when you apply a choice.</DialogDescription>
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
  const [candidateId, setCandidateId] = useState("baseline");
  const [level, setLevel] = useState<VocalLevel>("balanced");
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
        if (["preparing", "analysing", "rendering"].includes(next.status)) timer = setTimeout(poll, 1000);
      } catch (e) { if (!gone) setError(String(e)); }
    };
    void poll();
    return () => { gone = true; clearTimeout(timer); };
  }, [projectId, runId, refresh]);
  const candidate = run?.candidates.find(c => c.id === candidateId) ?? run?.candidates[0];
  const selected = candidate?.renders[passage];
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
        startTick: tick(first), endTick: tick(first + length), checkStartTick: tick(second), checkEndTick: tick(second + length), level });
      setRun(next); setCandidateId("baseline"); useVocalMix.getState().remember(next.id);
    } catch (e) { setError(String(e)); } finally { setBusy(false); }
  };
  const apply = async () => {
    if (!run) return;
    setBusy(true); setError(null);
    try { player.current?.pause(); await applyVocalMix(projectId, run.id, candidate?.id ?? "baseline"); setApplied(true); }
    catch (e) { setError(String(e)); } finally { setBusy(false); }
  };
  const operation = async (name: string) => {
    if (!run) return;
    setBusy(true); setError(null);
    try {
      const next = await vocalMixTool<VocalMixRun>(projectId, name, { runId: run.id });
      setRun(next);
      if (next.status === "rendering" || next.status === "analysing") {
        // Refresh the polling effect after explicit restart.
        useVocalMix.getState().remember(next.id); setRefresh(n => n + 1);
      }
    } catch (e) { setError(String(e)); } finally { setBusy(false); }
  };
  const stale = !!run && vocalRevision(song) !== run.baseRevision;
  const rendering = !!run && ["preparing", "analysing", "rendering"].includes(run.status);
  const unsafe = !!candidate?.change && candidate.renders.some(r => r.fullScaleFraction === null || r.fullScaleFraction > 0 || r.truePeakDbtp === null || r.truePeakDbtp >= 0);
  const baseline = candidate?.id === "baseline";
  return <div className="grid gap-4 text-sm">
    <div className="grid gap-2 rounded-md border bg-surface-1 p-3">
      <label className="grid gap-1">Vocal mixer insert<select aria-label="Vocal mixer insert" className="rounded border bg-background p-2" value={track} onChange={e => setTrack(e.target.value)} disabled={busy || rendering}>
        <option value="">Choose the insert containing only your vocal</option>
        {song.mixer.tracks.filter(t => t.id !== MASTER_TRACK_ID).map((t, i) => <option key={t.id} value={t.id}>{t.name ?? `Insert ${i + 1}`}</option>)}
      </select></label>
      <div className="grid grid-cols-3 gap-2">{[["First start (s)", first, setFirst], ["Second start (s)", second, setSecond], ["Length (s)", length, setLength]].map(([label, value, setter]) =>
        <label key={String(label)} className="grid gap-1 text-xs">{String(label)}<Input aria-label={String(label)} type="number" min={0} value={Number(value)} disabled={busy || rendering} onChange={e => (setter as (v: number) => void)(Number(e.target.value))} /></label>)}
      </div>
      <label className="grid gap-1 text-xs">Where the vocal sits<select aria-label="Where the vocal sits" className="rounded border bg-background p-2 text-sm" value={level} onChange={e => setLevel(e.target.value as VocalLevel)} disabled={busy || rendering}>
        {(Object.keys(VOCAL_LEVEL_TARGETS) as VocalLevel[]).map(l => <option key={l} value={l}>{l[0].toUpperCase() + l.slice(1)} ({VOCAL_LEVEL_TARGETS[l]} LU against the beat)</option>)}
      </select></label>
      <p className="text-xs text-muted-foreground">Choose two nonoverlapping passages where the vocal sings, each 5–20 seconds. Everything is measured here; no model or upload is involved.</p>
      <Button onClick={() => void start()} disabled={!track || busy || rendering}>{busy ? "Working…" : run ? "Start fresh comparison" : "Measure and render alternatives"}</Button>
    </div>
    {error && <p role="alert" className="text-destructive">{error}</p>}
    {run && <>
      <p role="status">{run.status === "ready" ? (run.candidates.length > 1 ? "Both passages are ready to compare." : "Measured: nothing to change.") : run.status === "analysing" ? "Measuring the vocal against the beat…" : run.status === "rendering" ? `Rendering ${run.candidates.length - 1} alternative${run.candidates.length === 2 ? "" : "s"}…` : `Comparison: ${run.status}.`}</p>
      {run.findings && <div className="grid gap-1 rounded-md border bg-surface-1 p-3" aria-label="What the measurements found">
        <p className="font-medium">What the measurements found</p>
        {run.findings.every(list => !list.length) && <p className="text-xs text-muted-foreground">Nothing passed its starting point in either passage.</p>}
        {run.findings.map((list, i) => list.length > 0 && <div key={i} className="text-xs"><span className="text-muted-foreground">Passage {i + 1}:</span><ul className="list-disc pl-5">{list.map(f => <li key={f.kind}>{f.text}</li>)}</ul></div>)}
        {run.conclusion && <p className="text-xs">{run.conclusion}</p>}
      </div>}
      {run.error && <p role="alert" className="text-destructive">{run.error}</p>}
      {rendering && <Button variant="outline" onClick={() => void operation("cancel_vocal_mix_run")} disabled={busy}>Cancel comparison</Button>}
      {["interrupted", "failed"].includes(run.status) && <Button variant="outline" onClick={() => void operation("retry_vocal_mix_run")} disabled={busy}>Retry interrupted or failed jobs</Button>}
      {run.status === "ready" && <>
        <div className="flex flex-wrap gap-2">{[0, 1].map(i => <Button key={i} variant={passage === i ? "default" : "outline"} onClick={() => { if (i === passage) return; rememberPosition(); restore.current.offset = 0; setPassage(i); }}>Passage {i + 1}</Button>)}</div>
        <div className="grid grid-cols-2 gap-2">{run.candidates.map(c => <Button key={c.id} variant={candidate?.id === c.id ? "default" : "outline"} onClick={() => { if (candidate?.id === c.id) return; rememberPosition(); setCandidateId(c.id); }}>{c.label}</Button>)}</div>
        {candidate && <div className="grid gap-1 text-xs">
          {candidate.reasons.map((r, i) => <p key={i}>{r}</p>)}
          {candidate.effects.length > 0 && <><p className="text-muted-foreground">Measured against the current mix (mean of both passages):</p><ul className="list-disc pl-5">{candidate.effects.map((e, i) => <li key={i}>{e}</li>)}</ul></>}
        </div>}
        <label className="flex gap-2"><input type="checkbox" checked={matched} onChange={e => setMatched(e.target.checked)} />Match listening levels</label>
        <p className="text-xs text-muted-foreground">Matched to the same integrated loudness (LUFS) and kept under -1 dBTP. Switch it off to hear original output levels; matching gain is used only for playback.</p>
        {artifact && selectedId && <audio ref={player} controls preload="auto" className="w-full" src={`/api/music/audio/${projectId}/artifacts/${selectedId}/audio`}
          onLoadedMetadata={e => {
            const a = e.currentTarget, lead = (artifact.passage?.leadInFrames ?? 0) / artifact.format.sampleRate;
            a.currentTime = Math.min(lead + restore.current.offset, a.duration);
            a.volume = matched ? Math.min(1, 10 ** ((selected?.auditionGainDb ?? 0) / 20)) : 1;
            if (restore.current.playing) void a.play().catch(() => {});
          }} onPlay={() => { useTransport.getState().stop(); }} />}
        {artifact && <p className="text-xs text-muted-foreground">Playback includes effect tails. The player starts after the recorded warm-up.</p>}
        {stale && !applied && <p role="alert">The song changed. Start a fresh comparison before applying.</p>}
        {unsafe && <p role="alert">This alternative's true peak reaches 0 dBTP in at least one passage.</p>}
        <Button onClick={() => void apply()} disabled={busy || stale || unsafe}>{baseline ? "Keep current mix" : "Apply selected alternative"}</Button>
        {applied && <p role="status">{baseline ? "Current mix kept." : "Applied as one undo step. Use Undo to restore the previous mix."}</p>}
      </>}
    </>}
  </div>;
}
