import { memo, useState, type ComponentType, type ReactNode } from "react";
import {
  PiArrowCounterClockwise,
  PiCheckCircle,
  PiCircleDashedBold,
  PiCopy,
  PiDotsThree,
  PiHandPalm,
  PiPushPin,
  PiTrash,
  PiWarningCircle,
} from "react-icons/pi";
import type { ProjectSummary } from "@shared/types";
import { formatElapsed, formatRelative } from "@shared/format";
import { ProviderIcon } from "@/components/assistant/provider-icon";
import { useNow } from "@/hooks/use-now";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "cn";
import { useAssistant } from "@/stores/assistant";
import { useProjects } from "@/stores/projects";
import { clientSuite, describeProject } from "@/suites";
import { type ChatStatus, chatStatus } from "./chat-status";
import { DeleteProjectDialog } from "./delete-project-dialog";

interface ProjectItemProps {
  project: ProjectSummary;
  selected: boolean;
  /** Current time, passed down so relative times refresh together. */
  now: number;
}

export const ProjectItem = memo(function ProjectItem({ project, selected, now }: ProjectItemProps) {
  // The open project's name updates live while it's being renamed. (A project's suite never changes, so the hook is always the same one.)
  const liveName = clientSuite(project.suite).useLiveName(project.id);
  const activity = useAssistant((s) => s.chatActivity[project.id]);
  const seenAt = useAssistant((s) => s.seen[project.id]);
  const waiting = useAssistant((s) => s.confirmations.some((c) => c.projectId === project.id));
  const status = chatStatus(activity, { seenAt, isOpen: selected, waiting });
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const settled = project.status === "settled";
  const name = liveName ?? project.name;

  const open = () => void useProjects.getState().open(project.id);
  const toggleSettled = () => {
    const projects = useProjects.getState();
    void (settled ? projects.unsettle(project.id) : projects.settle(project.id));
  };
  const menuActions = {
    settled,
    onToggleSettled: toggleSettled,
    onDuplicate: () => void useProjects.getState().duplicate(project.id),
    onSaveTemplate: () => void useProjects.getState().saveTemplate(project.id),
    onDelete: () => setConfirmDelete(true),
  };

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger asChild>
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
            data-project-id={project.id}
            data-chat-status={status?.kind}
            className={cn(
              "group/item relative flex cursor-pointer items-center gap-3 rounded-xl px-2.5 py-2.5 outline-none transition-colors",
              "focus-visible:ring-2 focus-visible:ring-ring/60",
              selected ? "bg-accent" : "hover:bg-accent/60 data-[state=open]:bg-accent/60",
            )}
          >
            <Thumbnail project={project} dimmed={settled} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className={cn("truncate text-sm leading-5 font-medium", settled && !selected && "text-muted-foreground")}>{name}</span>
                <span className="ml-auto flex shrink-0 items-center group-hover/item:invisible group-focus-within/item:invisible">
                  {status ? (
                    <StatusLabel status={status} />
                  ) : (
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {formatRelative(settled ? (project.settledAt ?? project.updatedAt) : project.updatedAt, now)}
                    </span>
                  )}
                </span>
              </div>
              <div className="mt-0.5 flex items-center gap-2">
                <p className="min-w-0 flex-1 truncate text-xs leading-5 text-muted-foreground">
                  {status?.kind === "working" && status.step
                    ? status.step
                    : describeProject(project)}
                </p>
                {status && <ProviderIcon provider={status.provider} className="size-3.5 opacity-80" />}
              </div>
            </div>

            <div
              className={cn(
                "absolute top-2 right-2 flex items-center gap-1.5 opacity-0 transition-opacity",
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
                {/* Portalled, but React still bubbles its events to the context-menu trigger. */}
                <DropdownMenuContent align="start" className="w-48" onContextMenu={(e) => e.stopPropagation()}>
                  <ProjectMenuItems Item={DropdownMenuItem} Separator={DropdownMenuSeparator} {...menuActions} />
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent className="w-48">
          <ProjectMenuItems Item={ContextMenuItem} Separator={ContextMenuSeparator} {...menuActions} />
        </ContextMenuContent>
      </ContextMenu>
      <DeleteProjectDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        name={name}
        onConfirm={() => void useProjects.getState().remove(project.id)}
      />
    </>
  );
});

interface ProjectMenuItemsProps {
  /** The menu's item and separator: the same actions show in the ⋯ menu and on right-click. */
  Item: ComponentType<{ onSelect?: (e: Event) => void; variant?: "default" | "destructive"; children?: ReactNode }>;
  Separator: ComponentType;
  settled: boolean;
  onToggleSettled: () => void;
  onDuplicate: () => void;
  onSaveTemplate: () => void;
  onDelete: () => void;
}

function ProjectMenuItems({ Item, Separator, settled, onToggleSettled, onDuplicate, onSaveTemplate, onDelete }: ProjectMenuItemsProps) {
  return (
    <>
      <Item onSelect={onToggleSettled}>
        {settled ? <PiArrowCounterClockwise /> : <PiCheckCircle />}
        {settled ? "Unsettle" : "Settle"}
      </Item>
      <Item onSelect={onDuplicate}>
        <PiCopy />
        Duplicate
      </Item>
      <Item onSelect={onSaveTemplate}>
        <PiPushPin />
        Use as starting point
      </Item>
      <Separator />
      <Item variant="destructive" onSelect={onDelete}>
        <PiTrash />
        Delete…
      </Item>
    </>
  );
}

const actionButton =
  "grid size-6 place-items-center rounded-md bg-background/80 text-muted-foreground shadow-xs ring-1 ring-border backdrop-blur-sm transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none";

/** A chat's state in T3 Code's style: "Working 2m" in the accent colour, "Done", "Failed", "Needs you". */
function StatusLabel({ status }: { status: ChatStatus }) {
  switch (status.kind) {
    case "working":
      return <Working since={status.since} />;
    case "waiting":
      return (
        <span className="flex items-center gap-1 text-xs font-medium text-amber-600 dark:text-amber-400">
          <PiHandPalm className="size-3.5" />
          Needs you
        </span>
      );
    case "done":
      return (
        <span className="flex items-center gap-1 text-xs font-medium text-emerald-600 dark:text-emerald-400">
          <PiCheckCircle className="size-3.5" />
          Done
        </span>
      );
    case "failed":
      return (
        <span className="flex items-center gap-1 text-xs font-medium text-destructive">
          <PiWarningCircle className="size-3.5" />
          Failed
        </span>
      );
  }
}

/** Its own component: it ticks every second. */
function Working({ since }: { since: number }) {
  const now = useNow(1000);
  return (
    <span className="flex items-center gap-1.5 text-xs font-medium text-brand tabular-nums">
      <PiCircleDashedBold className="size-3.5 animate-[spin_3s_linear_infinite]" />
      Working {formatElapsed(now - since)}
    </span>
  );
}

/** Its picture, else its suite's icon. */
function Thumbnail({ project, dimmed }: { project: ProjectSummary; dimmed: boolean }) {
  const { icon: Icon, tint } = clientSuite(project.suite);
  return (
    <div
      className={cn(
        "grid size-10 shrink-0 place-items-center overflow-hidden rounded-lg ring-1 ring-border ring-inset",
        project.thumbnail ? "bg-muted" : tint,
        dimmed && "opacity-60 grayscale",
      )}
    >
      {project.thumbnail ? (
        <img src={project.thumbnail} alt="" draggable={false} className="size-full object-cover" />
      ) : (
        <Icon className="size-4" />
      )}
    </div>
  );
}
