import { PiSparkle, PiUploadSimple } from "react-icons/pi";
import { SUITES, SUITE_IDS } from "@shared/suites";
import { acceptMediaFiles } from "@/components/media/import-media";
import { Button } from "@/components/ui/button";
import { useFileDrop } from "@/hooks/use-file-drop";
import { cn } from "cn";
import { settledProjects, useProjects } from "@/stores/projects";
import { clientSuite } from "@/suites";

/** Shown when no project is open: start one in any suite (dropping clips here starts a video with them). */
export function EmptyState() {
  const settledCount = useProjects((s) => settledProjects(s.projects).length);
  const drop = useFileDrop((files) => {
    const accepted = acceptMediaFiles(files);
    if (accepted.length > 0) void useProjects.getState().create({ suite: "video", files: accepted });
  });

  return (
    <div className="relative flex min-h-0 flex-1 items-center justify-center bg-stage p-8" {...drop.handlers}>
      <div
        className={cn(
          "flex w-full max-w-md flex-col items-center rounded-2xl border border-dashed bg-card/60 px-8 py-12 text-center transition-colors",
          drop.active && "border-brand bg-brand/5",
        )}
      >
        <span className="grid size-12 place-items-center rounded-xl bg-muted text-muted-foreground">
          {drop.active ? <PiUploadSimple className="size-6" /> : <PiSparkle className="size-6" />}
        </span>
        <h1 className="mt-5 text-lg font-semibold tracking-tight">{drop.active ? "Drop to start a new video" : "Start something new"}</h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          Drop your clips here to start a video, or pick what to make. When you're done, settle it and move on to the
          next one.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          {SUITE_IDS.map((id, i) => {
            const Icon = clientSuite(id).icon;
            return (
              <Button key={id} variant={i === 0 ? "default" : "outline"} onClick={() => void useProjects.getState().create({ suite: id })}>
                <Icon />
                New {SUITES[id].noun}
              </Button>
            );
          })}
        </div>
        {settledCount > 0 && (
          <p className="mt-6 text-xs text-muted-foreground">
            {settledCount} settled project{settledCount === 1 ? "" : "s"} in the sidebar.
          </p>
        )}
      </div>
    </div>
  );
}
