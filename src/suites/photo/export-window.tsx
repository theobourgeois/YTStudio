/**
 * Export (ux.md, "Saving, progress and failure"): the photo as a PNG (transparency kept) or a JPEG (over the
 * background, or white), at its canvas size. In the desktop app the save dialog says where; a browser downloads it.
 * The file is replaced only once the new one is complete. Editing goes on meanwhile: what's exported is the photo
 * as it was when it started.
 */
import { useState } from "react";
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

type Phase = { status: "idle" } | { status: "running"; progress: number } | { status: "done"; path: string; bytes: number } | { status: "failed"; error: string };

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
    try {
      const r = await renderer;
      await r.ready();
      const result = await r.export(projectId, history.doc.doc, { name: fileName, format, bits, quality, destination }, (progress) => setPhase({ status: "running", progress }));
      setPhase({ status: "done", path: result.path, bytes: result.bytes });
      // A browser downloads what the server kept.
      if (!destination) {
        const a = document.createElement("a");
        a.href = result.download;
        a.download = fileName;
        a.click();
      }
    } catch (error) {
      setPhase({ status: "failed", error: errorMessage(error) });
    }
  };

  const busy = phase.status === "running";
  return (
    <FloatingWindow id="export" title="Export" heading="Export photo" initial={initial} keepsKeys escapeCloses={!busy} onClose={close} className="w-[420px] max-w-full">
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
        {phase.status === "running" && <Progress value={phase.progress * 100} />}
        {phase.status === "done" && (
          <p className="text-sm" data-export-done>
            Saved {Math.round(phase.bytes / 1024)} KB to <span className="break-all text-muted-foreground">{phase.path}</span>
          </p>
        )}
        {phase.status === "failed" && <p className="text-sm text-destructive">Couldn't export: {phase.error}</p>}
        <WindowFooter>
          <Button variant="outline" onClick={close} disabled={busy}>
            {phase.status === "done" ? "Close" : "Cancel"}
          </Button>
          <Button onClick={() => void run()} disabled={busy || !name.trim()}>
            {busy ? "Exporting…" : "Export"}
          </Button>
        </WindowFooter>
      </WindowBody>
    </FloatingWindow>
  );
}
