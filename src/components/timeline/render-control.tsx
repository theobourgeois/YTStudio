import { useMemo } from "react";
import { PiCircleNotch, PiFilmStrip, PiWarningCircle, PiX } from "react-icons/pi";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { SHORTCUT_KEYS } from "@/hooks/shortcuts";
import { useEditor } from "@/stores/editor";
import { segmentsOf, useRenderFiles } from "@/stores/render-files";

/**
 * Render Effects In to Out from the timeline's toolbar (Premiere's Enter, docs/render-files.md): how many parts
 * are worth rendering (red in the bar over the ruler), then how far a render is, with Cancel.
 */
export function RenderControl() {
  const job = useRenderFiles((s) => s.job);
  const error = useRenderFiles((s) => s.error);
  const keys = useRenderFiles((s) => s.keys);
  const segments = useEditor((s) => (s.project === s.document ? segmentsOf(s.gestureDocument ?? s.document, s.assets) : null));
  const missing = useMemo(() => segments?.filter((s) => s.heavy && !keys.has(s.key)).length ?? 0, [segments, keys]);
  const rendering = !!job && (job.status === "queued" || job.status === "rendering");

  if (rendering) {
    return (
      <div className="flex items-center gap-1 rounded-md bg-muted py-0.5 pr-0.5 pl-2 text-xs text-muted-foreground" data-rendering>
        <PiCircleNotch className="size-3.5 animate-spin" />
        <span className="tabular-nums">
          Rendering {job.segments > 0 ? `${job.rendered.length} of ${job.segments}` : ""} · {Math.round(job.progress * 100)}%
        </span>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon-sm" className="size-6" aria-label="Cancel rendering" onClick={() => useRenderFiles.getState().cancel()}>
              <PiX />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Cancel rendering (what's done stays green)</TooltipContent>
        </Tooltip>
      </div>
    );
  }

  const tip =
    segments === null
      ? "Render effects: open the main sequence (a nested one isn't rendered on its own)"
      : missing > 0
        ? `Render effects in to out: the ${missing} red part${missing === 1 ? "" : "s"} over the ruler, so they play smoothly`
        : "Render effects: nothing to render (the heavy parts are green, or there are none)";
  return (
    <div className="flex items-center gap-0.5">
      {error && (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="inline-flex text-destructive" aria-label="Rendering failed" role="img">
              <PiWarningCircle />
            </span>
          </TooltipTrigger>
          <TooltipContent className="max-w-72">{error}</TooltipContent>
        </Tooltip>
      )}
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex">
            <Button
              variant="ghost"
              size="sm"
              className="h-8 gap-1.5 px-2 text-xs text-muted-foreground hover:text-foreground"
              aria-label="Render effects"
              disabled={missing === 0}
              onClick={() => void useRenderFiles.getState().render()}
            >
              <PiFilmStrip />
              <span>Render</span>
            </Button>
          </span>
        </TooltipTrigger>
        <TooltipContent>
          {tip} <span className="ml-1 text-muted-foreground">{SHORTCUT_KEYS.renderEffects}</span>
        </TooltipContent>
      </Tooltip>
    </div>
  );
}
