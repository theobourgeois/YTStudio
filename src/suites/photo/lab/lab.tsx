/**
 * The photo lab (F0's development page, `/photo-lab.html` in `pnpm dev`): open a decoded image on the WebGPU
 * renderer, pan, zoom and paint it, and run the gate's checks. It goes once F1's workspace exists; what it
 * measures is in docs/photo/foundations-prototype.md.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { type BrushSettings } from "@shared/photo/brush.ts";
import { panBy, viewToDoc, zoomAbout } from "@shared/photo/geometry.ts";
import type { HelperStatus, SourceInfo, TileSize } from "@shared/photo/lab.ts";
import { labApi } from "../api.ts";
import { GpuUnavailableError } from "../render/gpu.ts";
import { PhotoSession } from "../render/session.ts";
import * as bench from "./bench.ts";

const BUDGETS = [256, 1024, 2048] as const;
const BRUSH: BrushSettings = { radius: 60, hardness: 0.5, strength: 0.6, spacing: 0.15 };

declare global {
  interface Window {
    photoLab?: {
      ready: Promise<void>;
      /** A new session (closing the last) with these tiles and budget, on a canvas of this size in device pixels. */
      start(options: { tile: TileSize; budgetMB: number; width: number; height: number }): Promise<void>;
      session(): PhotoSession | null;
      bench: typeof bench;
      api: typeof labApi;
    };
  }
}

export function PhotoLab() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const holderRef = useRef<HTMLDivElement>(null);
  const sessionRef = useRef<PhotoSession | null>(null);
  const [sources, setSources] = useState<SourceInfo[]>([]);
  const [helper, setHelper] = useState<HelperStatus | null>(null);
  const [tile, setTile] = useState<TileSize>(256);
  const [budgetMB, setBudgetMB] = useState<number>(2048);
  const [status, setStatus] = useState("Starting…");
  const [results, setResults] = useState<{ label: string; value: unknown }[]>([]);
  const [brush, setBrush] = useState(false);
  const [, setTick] = useState(0);
  const fixedSize = useRef<{ width: number; height: number } | null>(null);

  const log = (label: string, value: unknown) => setResults((r) => [{ label, value }, ...r].slice(0, 30));

  const start = useCallback(async (options: { tile: TileSize; budgetMB: number }) => {
    sessionRef.current?.dispose();
    sessionRef.current = null;
    const canvas = canvasRef.current!;
    const session = await PhotoSession.create(canvas, { tile: options.tile, budgetBytes: options.budgetMB * 1024 ** 2 });
    session.onChange = () => {
      setStatus(session.status);
      setTick((t) => t + 1);
    };
    sessionRef.current = session;
    const size = fixedSize.current ?? measure(holderRef.current!);
    session.resize(size.width, size.height);
    setStatus(`${session.gpu.adapter.vendor} ${session.gpu.adapter.architecture}${session.gpu.adapter.fallback ? " (fallback)" : ""}`);
    return session;
  }, []);

  useEffect(() => {
    let resolveReady: () => void = () => {};
    const ready = new Promise<void>((r) => (resolveReady = r));
    window.photoLab = {
      ready,
      start: async ({ tile, budgetMB, width, height }) => {
        fixedSize.current = { width, height };
        await start({ tile, budgetMB });
      },
      session: () => sessionRef.current,
      bench,
      api: labApi,
    };
    start({ tile, budgetMB })
      .then(() => resolveReady())
      .catch((error) => setStatus(error instanceof GpuUnavailableError ? error.message : String(error)));
    void labApi.sources().then(setSources);
    void labApi.helper().then(setHelper);
    return () => sessionRef.current?.dispose();
    // Started once; the controls restart it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The canvas follows its box, in device pixels (unless the bench fixed its size).
  useEffect(() => {
    const holder = holderRef.current!;
    const observer = new ResizeObserver(() => {
      if (fixedSize.current) return;
      const { width, height } = measure(holder);
      sessionRef.current?.resize(width, height);
    });
    observer.observe(holder);
    return () => observer.disconnect();
  }, []);

  const run = async (label: string, task: (s: PhotoSession) => Promise<unknown>) => {
    const session = sessionRef.current;
    if (!session) return;
    try {
      setStatus(`${label}…`);
      const value = await task(session);
      log(label, value);
      setStatus(`${label}: done`);
    } catch (error) {
      log(label, { error: String(error) });
      setStatus(`${label} failed: ${error}`);
    }
  };

  const open = (info: SourceInfo) => run(`open ${info.name}`, (s) => bench.openSource(s, info.name));

  const upload = async (files: FileList | null) => {
    for (const file of files ?? []) {
      setStatus(`Uploading ${file.name}…`);
      try {
        await labApi.addSource(file, file.name);
      } catch (error) {
        setStatus(String(error));
      }
    }
    setSources(await labApi.sources());
  };

  // Pointer: drag pans (or paints with the brush on), the wheel zooms about the pointer.
  const onPointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const session = sessionRef.current;
    if (!session?.layout) return;
    const canvas = event.currentTarget;
    canvas.setPointerCapture(event.pointerId);
    const scale = canvas.width / canvas.clientWidth;
    const at = (e: { clientX: number; clientY: number }) => {
      const r = canvas.getBoundingClientRect();
      return { x: (e.clientX - r.left) * scale, y: (e.clientY - r.top) * scale };
    };
    let last = at(event);
    const painting = brush && !event.altKey && session.paint;
    if (painting) {
      session.paint!.begin(BRUSH, [0.8, 0.25, 0.05, 0.8]);
      session.paint!.add([viewToDoc(session.view, last.x, last.y)]);
      session.requestDraw();
    }
    const move = (e: PointerEvent) => {
      const events = e.getCoalescedEvents?.() ?? [e];
      if (painting) {
        session.paint!.add(events.map((c) => { const p = at(c); return viewToDoc(session.view, p.x, p.y); }));
        session.requestDraw();
      } else {
        const now = at(e);
        session.setView(panBy(session.view, now.x - last.x, now.y - last.y));
        last = now;
      }
    };
    const up = async () => {
      canvas.removeEventListener("pointermove", move);
      canvas.removeEventListener("pointerup", up);
      canvas.removeEventListener("pointercancel", cancel);
      if (painting) {
        const result = await session.paint!.end();
        session.requestDraw("final");
        if (result) {
          log("stroke", { tiles: result.tiles, commitMs: round(result.commitMs), readbackMs: round(result.readbackMs), hashMs: round(result.hashMs) });
          result.uploaded.then((u) => log("uploaded", u), (error) => log("upload failed", String(error)));
        }
      } else session.requestDraw("final");
    };
    const cancel = () => {
      canvas.removeEventListener("pointermove", move);
      canvas.removeEventListener("pointerup", up);
      canvas.removeEventListener("pointercancel", cancel);
      if (painting) session.paint!.cancel();
      session.requestDraw("final");
    };
    canvas.addEventListener("pointermove", move);
    canvas.addEventListener("pointerup", up);
    canvas.addEventListener("pointercancel", cancel);
  };

  useEffect(() => {
    const canvas = canvasRef.current!;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      const session = sessionRef.current;
      if (!session?.layout) return;
      const r = canvas.getBoundingClientRect();
      const scale = canvas.width / canvas.clientWidth;
      session.setView(zoomAbout(session.view, (event.clientX - r.left) * scale, (event.clientY - r.top) * scale, Math.exp(-event.deltaY * 0.002)));
    };
    canvas.addEventListener("wheel", wheel, { passive: false });
    return () => canvas.removeEventListener("wheel", wheel);
  }, []);

  const session = sessionRef.current;
  const atlas = session?.ctx.atlas;
  return (
    <div className="flex h-screen bg-surface-0 text-sm text-fg">
      <aside className="flex w-80 shrink-0 flex-col gap-3 overflow-y-auto border-r border-line p-3">
        <h1 className="text-base font-semibold">Photo lab</h1>
        <p className="text-xs text-fg-muted">{status}</p>
        <p className="text-xs text-fg-muted">Helper: {helper ? `${helper.decoder ?? "not running"} · ${helper.restarts} restarts` : "…"}</p>
        <div className="flex gap-2">
          <label className="flex items-center gap-1">
            Tiles
            <select value={tile} onChange={(e) => setTile(Number(e.target.value) as TileSize)} className="rounded border border-line bg-surface-1 px-1">
              <option value={256}>256</option>
              <option value={512}>512</option>
            </select>
          </label>
          <label className="flex items-center gap-1">
            Budget
            <select value={budgetMB} onChange={(e) => setBudgetMB(Number(e.target.value))} className="rounded border border-line bg-surface-1 px-1">
              {BUDGETS.map((b) => (
                <option key={b} value={b}>{b} MB</option>
              ))}
            </select>
          </label>
          <LabButton onClick={() => void start({ tile, budgetMB })}>Restart</LabButton>
        </div>
        <div>
          <h2 className="mb-1 font-medium">Images</h2>
          <input type="file" accept="image/*" multiple onChange={(e) => void upload(e.target.files)} className="mb-2 text-xs" />
          <ul className="flex flex-col gap-1">
            {sources.map((s) => (
              <li key={s.key}>
                <button type="button" onClick={() => void open(s)} className="w-full rounded px-1 text-left hover:bg-surface-2">
                  {s.name} <span className="text-fg-muted">{s.width}×{s.height} · {s.bits}-bit</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
        <div className="flex flex-wrap gap-1">
          <LabButton onClick={() => session?.layout && session.setView({ ...session.view, ...fit(session) }, "final")}>Fit</LabButton>
          <LabButton onClick={() => session && session.setView(zoomAbout(session.view, session.view.width / 2, session.view.height / 2, 1 / session.view.zoom), "final")}>100%</LabButton>
          <LabButton pressed={brush} onClick={() => setBrush((b) => !b)}>Brush</LabButton>
          <LabButton onClick={() => { session?.paint?.undo(); void session?.paint?.ensureResident().then(() => session.requestDraw("final")); session?.requestDraw("final"); }}>Undo</LabButton>
          <LabButton onClick={() => { session?.paint?.redo(); void session?.paint?.ensureResident().then(() => session.requestDraw("final")); session?.requestDraw("final"); }}>Redo</LabButton>
        </div>
        <div className="flex flex-wrap gap-1">
          <LabButton onClick={() => void run("compile", bench.compileCheck)}>Compile</LabButton>
          <LabButton onClick={() => void run("pan/zoom", (s) => bench.panZoom(s))}>Pan/zoom</LabButton>
          <LabButton onClick={() => void run("stroke", (s) => bench.stroke(s))}>Stroke</LabButton>
          <LabButton onClick={() => void run("P3", bench.p3)}>P3 check</LabButton>
          <LabButton onClick={() => void run("round trip", bench.roundTrip)}>Round trip</LabButton>
          <LabButton onClick={() => void run("GPU loss", bench.deviceLoss)}>Lose GPU</LabButton>
          <LabButton onClick={() => void run("budget walk", (s) => bench.budgetWalk(s))}>Budget walk</LabButton>
        </div>
        {atlas && (
          <p className="text-xs text-fg-muted">
            Atlas: {atlas.used}/{atlas.capacity} tiles · {Math.round(atlas.allocatedBytes / 1024 ** 2)} MB · {atlas.evictions} evictions · zoom {(session!.view.zoom * 100).toFixed(1)}%
          </p>
        )}
        <ol className="flex flex-col gap-2 font-mono text-[11px]">
          {results.map((r, i) => (
            <li key={i}>
              <div className="font-semibold">{r.label}</div>
              <pre className="whitespace-pre-wrap break-all text-fg-muted">{JSON.stringify(r.value, null, 1)}</pre>
            </li>
          ))}
        </ol>
      </aside>
      <div ref={holderRef} className="relative min-w-0 flex-1 overflow-hidden">
        <canvas ref={canvasRef} onPointerDown={onPointerDown} className="absolute inset-0 h-full w-full touch-none" />
      </div>
    </div>
  );
}

const round = (n: number) => Math.round(n * 100) / 100;

function measure(element: HTMLElement) {
  const r = element.getBoundingClientRect();
  return { width: Math.max(1, Math.round(r.width * devicePixelRatio)), height: Math.max(1, Math.round(r.height * devicePixelRatio)) };
}

function fit(session: PhotoSession) {
  const { width, height } = session.canvas;
  const l = session.layout!;
  const zoom = Math.min((width - 48) / l.width, (height - 48) / l.height);
  return { zoom, x: l.width / 2 - width / 2 / zoom, y: l.height / 2 - height / 2 / zoom };
}

function LabButton({ children, onClick, pressed }: { children: React.ReactNode; onClick: () => void; pressed?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`raised rounded border border-line px-2 py-0.5 text-xs ${pressed ? "bg-brand text-white" : "bg-surface-1 hover:bg-surface-2"}`}
    >
      {children}
    </button>
  );
}
