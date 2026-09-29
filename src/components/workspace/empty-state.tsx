import { PiFilmSlate, PiNotePencil, PiUploadSimple } from "react-icons/pi";
import { acceptMediaFiles } from "@/components/media/import-media";
import { Button } from "@/components/ui/button";
import { useFileDrop } from "@/hooks/use-file-drop";
import { cn } from "cn";
import { settledProjects, useProjects } from "@/stores/projects";

/** Shown when no video is open: start a new one (dropping clips here starts one with them). */
export function EmptyState() {
  const settledCount = useProjects((s) => settledProjects(s.projects).length);
  const create = (files?: File[]) => void useProjects.getState().create(files);
  const drop = useFileDrop((files) => {
    const accepted = acceptMediaFiles(files);
    if (accepted.length > 0) create(accepted);
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
          {drop.active ? <PiUploadSimple className="size-6" /> : <PiFilmSlate className="size-6" />}
        </span>
        <h1 className="mt-5 text-lg font-semibold tracking-tight">
          {drop.active ? "Drop to start a new video" : "Start a new video"}
        </h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          Drop your clips here, or start from scratch. When you're done, settle it and move on to
          the next one.
        </p>
        <Button className="mt-6" onClick={() => create()}>
          <PiNotePencil />
          New video
        </Button>
        {settledCount > 0 && (
          <p className="mt-6 text-xs text-muted-foreground">
            {settledCount} settled video{settledCount === 1 ? "" : "s"} in the sidebar.
          </p>
        )}
      </div>
    </div>
  );
}
