import { ProjectPreviewPicture } from "./project-preview";
import { memo, useState, type ComponentType, type ReactNode } from "react";
import {
  PiCheckCircle,
  PiCircleDashedBold,
  PiCopy,
  PiDotsThree,
  PiFolderOpen,
  PiHandPalm,
  PiMagnifyingGlass,
  PiPencilSimple,
  PiPushPin,
  PiTrash,
  PiWarningCircle,
  PiX,
} from "react-icons/pi";
import type { ProjectSummary } from "@shared/types";
import { formatElapsed, formatRelative } from "@shared/format";
import { SUITES } from "@shared/suites";
import { ProviderIcon } from "@/components/assistant/provider-icon";
import { useNow } from "@/hooks/use-now";
import { Button } from "@/components/ui/button";
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
import { cn } from "cn";
import { FILE_MANAGER } from "@/lib/key-labels";
import { useAssistant } from "@/stores/assistant";
import { lastTouched, useProjects } from "@/stores/projects";
import { clientSuite, describeProject } from "@/suites";
import { type ChatStatus, chatStatus } from "./chat-status";
import { showOpenDialog } from "./open-project-dialog";
import { TrashProjectDialog } from "./trash-project-dialog";

/** Where a project is, shortly: its folder, with the home folder as ~ ("~/Documents/Vaudio"). */
export function folderOf(path: string): string {
  const parent = path.replace(/[/\\][^/\\]*$/, "") || "/";
  return parent
    .replace(/^\/Users\/[^/]+(?=\/|$)/, "~")
    .replace(/^\/home\/[^/]+(?=\/|$)/, "~")
    // Windows: C:\Users\name\Documents\Vaudio is ~\Documents\Vaudio.
    .replace(/^[A-Za-z]:[/\\]Users[/\\][^/\\]+(?=[/\\]|$)/i, "~");
}

interface ProjectCardProps {
  project: ProjectSummary;
  /** Current time, passed down so relative times refresh together. */
  now: number;
}

/** A recent project on the Home screen: its picture, name, what it is and when it was last touched; click to open it. */
export const ProjectCard = memo(function ProjectCard({ project, now }: ProjectCardProps) {
  const activity = useAssistant((s) => s.chatActivity[project.id]);
  const seenAt = useAssistant((s) => s.seen[project.id]);
  const waiting = useAssistant((s) => s.confirmations.some((c) => c.projectId === project.id));
  const status = chatStatus(activity, { seenAt, isOpen: false, waiting });
  const [confirmTrash, setConfirmTrash] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const missing = !!project.missing;

  const projects = useProjects.getState;
  const open = () => {
    if (missing) showOpenDialog({ locate: project });
    else void projects().open(project.id);
  };
  const actions: MenuActions = {
    missing,
    onOpen: open,
    onRename: () => setRenaming(true),
    onDuplicate: () => void projects().duplicate(project.id),
    onReveal: () => void projects().reveal(project.id),
    onSaveTemplate: () => void projects().saveTemplate(project.id),
    onForget: () => void projects().forget(project.id),
    onTrash: () => setConfirmTrash(true),
  };

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div
            role="button"
            tabIndex={0}
            aria-label={project.name}
            title={project.path}
            onClick={(e) => !renaming && e.currentTarget.contains(e.target as Node) && open()}
            onKeyDown={(e) => {
              if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) {
                e.preventDefault();
                open();
              }
            }}
            data-project-id={project.id}
            data-chat-status={status?.kind}
            data-missing={missing || undefined}
            className={cn(
              "group/card relative flex cursor-pointer flex-col overflow-hidden rounded-md border border-line bg-surface-2 outline-none transition-colors",
              "shadow-[inset_0_1px_0_var(--bevel-highlight)] hover:border-brand/70 hover:bg-surface-3",
              "focus-visible:ring-2 focus-visible:ring-ring/60 data-[state=open]:border-brand data-[state=open]:ring-1 data-[state=open]:ring-brand/50",
            )}
          >
            <div className="relative">
              <Picture project={project} />
              <div className="pointer-events-none absolute top-2 left-2">
                <SuiteBadge project={project} />
              </div>
              {status && (
                <div className="pointer-events-none absolute bottom-2 left-2">
                  <StatusPill status={status} />
                </div>
              )}
            </div>

            <div className="flex min-w-0 flex-col gap-0.5 border-t border-line px-3 pt-2 pb-2.5">
              {renaming ? (
                <RenameField
                  name={project.name}
                  onDone={(name) => {
                    setRenaming(false);
                    if (name !== null) void projects().rename(project.id, name);
                  }}
                />
              ) : (
                <span
                  className={cn("truncate text-[13px] leading-5 font-semibold", missing && "text-muted-foreground")}
                  onDoubleClick={(e) => {
                    if (missing) return;
                    e.stopPropagation();
                    setRenaming(true);
                  }}
                >
                  {project.name}
                </span>
              )}
              <span className="flex min-w-0 items-center gap-1.5 text-xs leading-4 text-muted-foreground">
                {missing ? (
                  <span className="flex items-center gap-1 font-medium text-amber-700 dark:text-amber-400">
                    <PiWarningCircle className="size-3.5" />
                    Not where it was
                  </span>
                ) : status?.kind === "working" && status.step ? (
                  <span className="truncate">{status.step}</span>
                ) : (
                  <>
                    <span className="truncate">{describeProject(project)}</span>
                    <span aria-hidden>·</span>
                    <span className="shrink-0 tabular-nums">{formatRelative(lastTouched(project), now)}</span>
                  </>
                )}
              </span>
              <span className="truncate font-mono text-[10.5px] leading-4 text-muted-foreground/80">{folderOf(project.path)}</span>
            </div>

            <div
              className={cn(
                "absolute top-2 right-2 opacity-0 transition-opacity group-hover/card:opacity-100 group-focus-within/card:opacity-100",
                menuOpen && "opacity-100",
              )}
              onClick={(e) => e.stopPropagation()}
            >
              <DropdownMenu modal={false} open={menuOpen} onOpenChange={setMenuOpen}>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="icon-xs" aria-label="More actions">
                    <PiDotsThree />
                  </Button>
                </DropdownMenuTrigger>
                {/* Portalled, but React still bubbles its events to the context-menu trigger. */}
                <DropdownMenuContent align="end" className="w-52" onContextMenu={(e) => e.stopPropagation()}>
                  <MenuItems Item={DropdownMenuItem} Separator={DropdownMenuSeparator} {...actions} />
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent className="w-52">
          <MenuItems Item={ContextMenuItem} Separator={ContextMenuSeparator} {...actions} />
        </ContextMenuContent>
      </ContextMenu>
      <TrashProjectDialog
        open={confirmTrash}
        onOpenChange={setConfirmTrash}
        project={project}
        onConfirm={() => void projects().remove(project.id)}
      />
    </>
  );
});

/** Its picture (a video's first frame), else its suite's icon; a missing one says what to do. */
function Picture({ project }: { project: ProjectSummary }) {
  if (project.missing) {
    return (
      <div className="flex aspect-[16/10] flex-col items-center justify-center gap-2 bg-sunken px-4 text-center">
        <PiMagnifyingGlass className="size-6 text-muted-foreground" />
        <span className="text-xs leading-4 text-muted-foreground">Moved, renamed or deleted.</span>
        <span className="flex gap-1.5" onClick={(e) => e.stopPropagation()}>
          <Button variant="outline" size="xs" onClick={() => showOpenDialog({ locate: project })}>
            Locate…
          </Button>
          <Button variant="ghost" size="xs" onClick={() => void useProjects.getState().forget(project.id)}>
            Remove
          </Button>
        </span>
      </div>
    );
  }
  return <ProjectPreviewPicture project={project} />;
}

function SuiteBadge({ project }: { project: ProjectSummary }) {
  const { icon: Icon } = clientSuite(project.suite);
  return (
    <span className="flex h-5 items-center gap-1 rounded-sm bg-black/55 px-1.5 text-[10.5px] font-medium text-white backdrop-blur-sm">
      <Icon className="size-3" />
      {SUITES[project.suite].label}
    </span>
  );
}

function RenameField({ name, onDone }: { name: string; onDone: (name: string | null) => void }) {
  const [value, setValue] = useState(name);
  return (
    <input
      autoFocus
      aria-label="Project name"
      value={value}
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => setValue(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") onDone(value);
        else if (e.key === "Escape") onDone(null);
      }}
      onBlur={() => onDone(value)}
      className="sunken -mx-1 h-6 rounded-sm px-1 text-[13px] font-semibold outline-none"
    />
  );
}

interface MenuActions {
  missing: boolean;
  onOpen: () => void;
  onRename: () => void;
  onDuplicate: () => void;
  onReveal: () => void;
  onSaveTemplate: () => void;
  onForget: () => void;
  onTrash: () => void;
}

interface MenuItemsProps extends MenuActions {
  /** The menu's item and separator: the same actions show in the ⋯ menu and on right-click. */
  Item: ComponentType<{ onSelect?: (e: Event) => void; variant?: "default" | "destructive"; children?: ReactNode }>;
  Separator: ComponentType;
}

function MenuItems({ Item, Separator, missing, onOpen, onRename, onDuplicate, onReveal, onSaveTemplate, onForget, onTrash }: MenuItemsProps) {
  if (missing) {
    return (
      <>
        <Item onSelect={onOpen}>
          <PiMagnifyingGlass />
          Locate…
        </Item>
        <Item onSelect={onForget}>
          <PiX />
          Remove from Recents
        </Item>
      </>
    );
  }
  return (
    <>
      <Item onSelect={onOpen}>
        <PiFolderOpen />
        Open
      </Item>
      <Item onSelect={onRename}>
        <PiPencilSimple />
        Rename
      </Item>
      <Item onSelect={onDuplicate}>
        <PiCopy />
        Duplicate
      </Item>
      <Item onSelect={onReveal}>
        <PiMagnifyingGlass />
        Show in {FILE_MANAGER}
      </Item>
      <Item onSelect={onSaveTemplate}>
        <PiPushPin />
        Use as starting point
      </Item>
      <Separator />
      <Item onSelect={onForget}>
        <PiX />
        Remove from Recents
      </Item>
      <Item variant="destructive" onSelect={onTrash}>
        <PiTrash />
        Move to Trash…
      </Item>
    </>
  );
}

/** A chat's state: "Working 2m" in the accent colour, "Done", "Failed", "Needs you", over the card's picture. */
function StatusPill({ status }: { status: ChatStatus }) {
  const body = (() => {
    switch (status.kind) {
      case "working":
        return <Working since={status.since} />;
      case "waiting":
        return (
          <span className="flex items-center gap-1 text-amber-300">
            <PiHandPalm className="size-3.5" />
            Needs you
          </span>
        );
      case "done":
        return (
          <span className="flex items-center gap-1 text-emerald-300">
            <PiCheckCircle className="size-3.5" />
            Done
          </span>
        );
      case "failed":
        return (
          <span className="flex items-center gap-1 text-red-300">
            <PiWarningCircle className="size-3.5" />
            Failed
          </span>
        );
    }
  })();
  return (
    <span className="flex h-5 items-center gap-1.5 rounded-sm bg-black/65 px-1.5 text-[10.5px] font-medium text-white backdrop-blur-sm">
      <ProviderIcon provider={status.provider} className="size-3" />
      {body}
    </span>
  );
}

/** Its own component: it ticks every second. */
function Working({ since }: { since: number }) {
  const now = useNow(1000);
  return (
    <span className="flex items-center gap-1 text-sky-300 tabular-nums">
      <PiCircleDashedBold className="size-3 animate-[spin_3s_linear_infinite]" />
      Working {formatElapsed(now - since)}
    </span>
  );
}

/** A small picture of a project (the ⌘P search's rows): its own, else its suite's icon. */
export function Thumbnail({ project }: { project: ProjectSummary }) {
  const { icon: Icon, tint } = clientSuite(project.suite);
  return (
    <div
      className={cn(
        "grid size-10 shrink-0 place-items-center overflow-hidden rounded-md ring-1 ring-line ring-inset",
        project.thumbnail ? "bg-black" : tint,
        project.missing && "opacity-50 grayscale",
      )}
    >
      {project.thumbnail ? <img src={project.thumbnail} alt="" draggable={false} className="size-full object-cover" /> : <Icon className="size-4" />}
    </div>
  );
}
