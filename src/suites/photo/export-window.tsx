/**
 * Export (ux.md, "Saving, progress and failure"): the photo as a PNG (transparency kept) or a JPEG (over the
 * background, or white), at its canvas size. In the desktop app the save dialog says where; a browser downloads it.
 * The file is replaced only once the new one is complete. Editing goes on meanwhile: what's exported is the photo
 * as it was when it started. Cancel (or Esc) stops it while it renders, and nothing is written; once every band is
 * rendered the file is being encoded, which finishes.
 */
import { useRef, useState } from "react";
import { errorMessage } from "@shared/errors";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Slider } from "@/components/ui/slider";
import { FloatingWindow, WindowBody, WindowFooter, WindowLead, centredOnDesktop } from "@/components/windows/floating-window";
import { chooseSaveFile } from "@/lib/desktop";
import { liveRenderer } from "./live";
import { usePhoto, usePhotoDoc } from "./store";
import { usePhotoUi } from "./ui";

type Phase =
  | { status: "idle" }
  | { status: "running"; progress: number }
  | { status: "done"; path: string; bytes: number }
  | { status: "cancelled" }
  | { status: "failed"; error: string };

const isAbort = (error: unknown) => error instanceof DOMException && error.name === "AbortError";

const safeName = (name: string) => name.replace(/[^\w .,()'&+-]+/g, " ").trim() || "Photo";

export function PhotoExportWindow() {
  const [initial] = useState(() => centredOnDesktop(420, 360, "photo"));
  const docName = usePhotoDoc((d) => d.name);
  const canvas = usePhotoDoc((d) => d.canvas);
  const [name, setName] = useState(safeName(docName));
  const [format, setFormat] = useState<"png" | "jpeg">("png");
  const [quality, setQuality] = useState(92);
  const [bits, setBits] = useState<8 | 16>(8);
  const [phase, setPhase] = useState<Phase>({ status: "idle" });
  const running = useRef<AbortController | null>(null);
  const close = () => usePhotoUi.getState().setExportOpen(false);
  const extension = format === "jpeg" ? "jpg" : "png";

  const run = async () => {
    const { projectId, history } = usePhoto.getState();
    const renderer = liveRenderer();
    if (!projectId || !history || !renderer) return;
    const fileName = `${safeName(name)}.${extension}`;
    const chosen = chooseSaveFile({ defaultPath: fileName, filters: [{ name: format === "jpeg" ? "JPEG" : "PNG", extensions: [extension] }] });
    const destination = chosen === undefined ? null : await chosen;
    if (chosen !== undefined && !destination) return;
    setPhase({ status: "running", progress: 0 });
    const controller = new AbortController();
    running.current = controller;
    try {
      const r = await renderer;
      await r.ready();
      const result = await r.export(projectId, history.doc.doc, { name: fileName, format, bits, quality, destination }, (progress) => setPhase({ status: "running", progress }), controller.signal);
      setPhase({ status: "done", path: result.path, bytes: result.bytes });
      // A browser downloads what the server kept.
      if (!destination) {
        const a = document.createElement("a");
        a.href = result.download;
        a.download = fileName;
        a.click();
      }
    } catch (error) {
      setPhase(isAbort(error) ? { status: "cancelled" } : { status: "failed", error: errorMessage(error) });
    } finally {
      running.current = null;
    }
  };

  const busy = phase.status === "running";
  // Every band rendered: the helper is encoding the file, which can't be stopped.
  const encoding = busy && phase.progress >= 1;
  const cancel = () => running.current?.abort();
  return (
    <FloatingWindow id="export" title="Export" heading="Export photo" initial={initial} keepsKeys escapeCloses={!encoding} onClose={busy ? cancel : close} className="w-[420px] max-w-full">
      <WindowBody>
        <WindowLead>
          {canvas.width} × {canvas.height} px, everything visible on the canvas.
        </WindowLead>
        <label className="flex flex-col gap-1 text-sm">
          File name
          <span className="flex items-center gap-1">
            <Input value={name} onChange={(e) => setName(e.target.value)} disabled={busy} data-autofocus />
            <span className="text-muted-foreground">.{extension}</span>
          </span>
        </label>
        <div className="flex gap-1.5" role="radiogroup" aria-label="Format">
          {(["png", "jpeg"] as const).map((f) => (
            <Button key={f} size="sm" variant={format === f ? "secondary" : "outline"} role="radio" aria-checked={format === f} disabled={busy} onClick={() => setFormat(f)}>
              {f === "png" ? "PNG (transparency)" : "JPEG"}
            </Button>
          ))}
        </div>
        {format === "png" && (
          <div className="flex items-center gap-1.5 text-sm" role="radiogroup" aria-label="Depth">
            <span className="mr-1.5">Depth</span>
            {([8, 16] as const).map((b) => (
              <Button key={b} size="sm" variant={bits === b ? "secondary" : "outline"} role="radio" aria-checked={bits === b} disabled={busy} onClick={() => setBits(b)}>
                {b}-bit
              </Button>
            ))}
          </div>
        )}
        {format === "jpeg" && (
          <label className="flex items-center gap-3 text-sm">
            Quality
            <Slider aria-label="Quality" min={1} max={100} step={1} value={[quality]} onValueChange={([v]) => setQuality(v)} disabled={busy} />
            <span className="w-8 text-right tabular-nums">{quality}</span>
          </label>
        )}
        {phase.status === "running" && (
          <div className="flex flex-col gap-1.5" data-export-progress>
            <Progress value={phase.progress * 100} />
            <span className="text-xs text-muted-foreground">{encoding ? "Writing the file…" : `Rendering… ${Math.round(phase.progress * 100)}%`}</span>
          </div>
        )}
        {phase.status === "cancelled" && (
          <p className="text-sm text-muted-foreground" data-export-cancelled>
            Export cancelled: nothing was written.
          </p>
        )}
        {phase.status === "done" && (
          <p className="text-sm" data-export-done>
            Saved {Math.round(phase.bytes / 1024)} KB to <span className="break-all text-muted-foreground">{phase.path}</span>
          </p>
        )}
        {phase.status === "failed" && <p className="text-sm text-destructive">Couldn't export: {phase.error}</p>}
        <WindowFooter>
          <Button variant="outline" onClick={busy ? cancel : close} disabled={encoding}>
            {phase.status === "done" || phase.status === "cancelled" ? "Close" : "Cancel"}
          </Button>
          <Button onClick={() => void run()} disabled={busy || !name.trim()}>
            {busy ? "Exporting…" : "Export"}
          </Button>
        </WindowFooter>
      </WindowBody>
    </FloatingWindow>
  );
}
