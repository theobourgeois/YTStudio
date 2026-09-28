import { memo, useState } from "react";
import {
  PiArrowCounterClockwise,
  PiCheckCircle,
  PiDotsThree,
  PiFilmSlate,
  PiTrash,
} from "react-icons/pi";
import type { ProjectSummary } from "@shared/types";
import { formatDuration, formatRelative } from "@shared/format";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useEditor } from "@/stores/editor";
import { useProjects } from "@/stores/projects";
import { DeleteProjectDialog } from "./delete-project-dialog";

interface ProjectItemProps {
  project: ProjectSummary;
  selected: boolean;
  /** Current time, passed down so relative times refresh together. */
  now: number;
}

export const ProjectItem = memo(function ProjectItem({ project, selected, now }: ProjectItemProps) {
  // The open project's name updates live while it's being renamed.
  const liveName = useEditor((s) => (s.projectId === project.id ? s.project.name : null));
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const settled = project.status === "settled";
  const name = liveName ?? project.name;

  const open = () => useProjects.getState().open(project.id);
  const toggleSettled = () => {
    const projects = useProjects.getState();
    void (settled ? projects.unsettle(project.id) : projects.settle(project.id));
  };

  return (
    <>
      <div
        role="button"
        tabIndex={0}
        aria-current={selected ? "page" : undefined}
        title={name}
        onClick={open}
        onKeyDown={(e) => {
          if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) {
            e.preventDefault();
            open();
          }
        }}
        className={cn(
          "group/item relative flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 outline-none transition-colors",
          "focus-visible:ring-2 focus-visible:ring-ring/60",
          selected ? "bg-accent" : "hover:bg-accent/60",
        )}
      >
        <Thumbnail url={project.thumbnail} dimmed={settled} />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span
              className={cn(
                "truncate text-[13px] leading-5 font-medium",
                settled && !selected && "text-muted-foreground",
              )}
            >
              {name}
            </span>
            <span className="ml-auto shrink-0 text-[11px] text-muted-foreground tabular-nums group-hover/item:invisible group-focus-within/item:invisible">
              {formatRelative(settled ? (project.settledAt ?? project.updatedAt) : project.updatedAt, now)}
            </span>
          </div>
          <p className="truncate text-[11px] leading-4 text-muted-foreground">
            {project.clipCount === 0
              ? "Empty"
              : `${formatDuration(project.duration)} · ${project.clipCount} clip${project.clipCount === 1 ? "" : "s"}`}
          </p>
        </div>

        <div
          className={cn(
            "absolute top-1.5 right-1.5 flex items-center gap-0.5 opacity-0 transition-opacity",
            "group-hover/item:opacity-100 group-focus-within/item:opacity-100",
            menuOpen && "opacity-100",
          )}
          onClick={(e) => e.stopPropagation()}
        >
          <Tooltip>
            <TooltipTrigger asChild>
              <button type="button" className={actionButton} onClick={toggleSettled}>
                {settled ? <PiArrowCounterClockwise className="size-3.5" /> : <PiCheckCircle className="size-3.5" />}
                <span className="sr-only">{settled ? "Unsettle" : "Settle"}</span>
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">{settled ? "Unsettle — back to work" : "Settle — done with it"}</TooltipContent>
          </Tooltip>
          <DropdownMenu modal={false} open={menuOpen} onOpenChange={setMenuOpen}>
            <DropdownMenuTrigger asChild>
              <button type="button" className={actionButton} aria-label="More actions">
                <PiDotsThree className="size-3.5" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-40">
              <DropdownMenuItem onSelect={toggleSettled}>
                {settled ? <PiArrowCounterClockwise /> : <PiCheckCircle />}
                {settled ? "Unsettle" : "Settle"}
              </DropdownMenuItem>
              <DropdownMenuItem variant="destructive" onSelect={() => setConfirmDelete(true)}>
                <PiTrash />
                Delete…
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      <DeleteProjectDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        name={name}
        onConfirm={() => void useProjects.getState().remove(project.id)}
      />
    </>
  );
});

const actionButton =
  "grid size-6 place-items-center rounded-md bg-background/80 text-muted-foreground shadow-xs ring-1 ring-border backdrop-blur-sm transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none";

function Thumbnail({ url, dimmed }: { url: string | null; dimmed: boolean }) {
  return (
    <div
      className={cn(
        "grid size-9 shrink-0 place-items-center overflow-hidden rounded-md bg-muted ring-1 ring-border ring-inset",
        dimmed && "opacity-60 grayscale",
      )}
    >
      {url ? (
        <img src={url} alt="" draggable={false} className="size-full object-cover" />
      ) : (
        <PiFilmSlate className="size-4 text-muted-foreground" />
      )}
    </div>
  );
}
