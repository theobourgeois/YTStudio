import { ProjectPreviewPicture } from "./project-preview";
import { type ComponentType, memo, type ReactNode, useState } from "react";
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
import { clamp } from "@shared/math";
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
import { clientSuite, describeProject, projectAspect } from "@/suites";
import { type ChatStatus, chatStatus } from "./chat-status";
import { showOpenDialog } from "./open-project-dialog";
import { TrashProjectDialog } from "./trash-project-dialog";

/** Where a project is, shortly: its folder, with the home folder as ~ ("~/Documents/YTStudio"). */
export function folderOf(path: string): string {
  const parent = path.replace(/[/\\][^/\\]*$/, "") || "/";
  return parent
    .replace(/^\/Users\/[^/]+(?=\/|$)/, "~")
    .replace(/^\/home\/[^/]+(?=\/|$)/, "~")
    // Windows: C:\Users\name\Documents\YTStudio is ~\Documents\YTStudio.
    .replace(/^[A-Za-z]:[/\\]Users[/\\][^/\\]+(?=[/\\]|$)/i, "~");
}

/** How Home lists the recents: a table (the default, Premiere's), cards (FL's Playlist clips), or a sheet of pictures at their own shapes. */
export type HomeView = "list" | "cards" | "sheet";

/** The list's columns: picture, name, kind, details, opened, where, its ⋯ (Home's header row uses the same). */
export const LIST_COLUMNS = "grid grid-cols-[104px_minmax(0,2fr)_88px_minmax(0,1.5fr)_88px_minmax(0,1.3fr)_28px] items-center gap-x-4";

/** The sheet's pictures are this tall (its `h-[200px]`), as wide as their shape makes them. */
export const SHEET_HEIGHT = 200;

interface ProjectCardProps {
  project: ProjectSummary;
  /** Current time, passed down so relative times refresh together. */
  now: number;
  view?: HomeView;
}

/**
 * A recent project on the Home screen, in any of its views: its picture, name, what it is and when it was last
 * opened; click to open it, right-click (or ⋯) for its menu, double-click its name to rename it.
 */
export const ProjectCard = memo(function ProjectCard({ project, now, view = "cards" }: ProjectCardProps) {
  const activity = useAssistant((s) => s.chatActivity[project.id]);
  const seenAt = useAssistant((s) => s.seen[project.id]);
  const waiting = useAssistant((s) => s.confirmations.some((c) => c.projectId === project.id));
  const status = chatStatus(activity, { seenAt, isOpen: false, waiting });
  const [confirmTrash, setConfirmTrash] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const missing = !!project.missing;
  const damaged = !!project.damaged;

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

  const name = renaming ? (
    <RenameField
      name={project.name}
      onDone={(next) => {
        setRenaming(false);
        if (next !== null) void projects().rename(project.id, next);
      }}
    />
  ) : (
    <span
      className={cn("truncate", (missing || damaged) && "opacity-60")}
      onDoubleClick={(e) => {
        if (missing || damaged) return;
        e.stopPropagation();
        setRenaming(true);
      }}
    >
      {project.name}
    </span>
  );
  /** What it is, or what's wrong with it, or what its assistant is doing. */
  const line = missing ? (
    <span className="flex min-w-0 items-center gap-1 font-medium text-amber-700 dark:text-amber-400">
      <PiWarningCircle className="size-3.5 shrink-0" />
      <span className="truncate">Not where it was</span>
    </span>
  ) : damaged ? (
    <span className="flex min-w-0 items-center gap-1 font-medium text-amber-700 dark:text-amber-400" title={project.damaged}>
      <PiWarningCircle className="size-3.5 shrink-0" />
      <span className="truncate">Damaged: can't be opened</span>
    </span>
  ) : status?.kind === "working" && status.step ? (
    <span className="truncate">{status.step}</span>
  ) : (
    <span className="truncate">{describeProject(project)}</span>
  );
  const when = <span className="shrink-0 tabular-nums">{formatRelative(lastTouched(project), now)}</span>;
  const more = (
    <div
      className={cn("opacity-0 transition-opacity group-hover/card:opacity-100 group-focus-within/card:opacity-100", menuOpen && "opacity-100")}
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
  );
  const pill = status && (
    <div className="pointer-events-none absolute bottom-1.5 left-1.5">
      <StatusPill status={status} />
    </div>
  );
  const { swatch, tint, icon: Icon } = clientSuite(project.suite);

  const body = (() => {
    switch (view) {
      case "list":
        return (
          <>
            <div className="relative overflow-hidden rounded-sm ring-1 ring-line">
              <Picture project={project} className="aspect-video" compact />
            </div>
            <div className="flex min-w-0 flex-col">
              <span className="flex min-w-0 text-[13px] leading-5 font-semibold">{name}</span>
              {status ? <span className="mt-0.5 self-start"><StatusPill status={status} /></span> : (missing || damaged) && <span className="text-xs">{line}</span>}
            </div>
            <span className="flex min-w-0 items-center gap-2 text-muted-foreground">
              <span className={cn("size-2 shrink-0 rounded-[2px]", swatch)} />
              {SUITES[project.suite].label}
            </span>
            <span className="truncate text-muted-foreground">{missing || damaged ? "" : describeProject(project)}</span>
            <span className="text-muted-foreground">{when}</span>
            <span className="truncate font-mono text-[11px] text-muted-foreground/80">{folderOf(project.path)}</span>
            {more}
          </>
        );
      case "cards":
        return (
          <>
            {/* FL's clip title strip, muted: the suite's colour as a line along its top and a wash under its name. */}
            <div className="relative flex h-7 min-w-0 items-center gap-2 border-b border-line bg-surface-3 px-2.5 text-[12.5px] font-semibold">
              <span aria-hidden className={cn("absolute inset-0 opacity-[0.16]", missing || damaged ? "bg-muted-foreground" : swatch)} />
              <span aria-hidden className={cn("absolute inset-x-0 top-0 h-0.5", missing || damaged ? "bg-muted-foreground" : swatch)} />
              <Icon className={cn("relative size-3.5 shrink-0", textOf(tint))} />
              <span className="relative flex min-w-0">{name}</span>
            </div>
            <div className="relative">
              <Picture project={project} />
              {pill}
              <div className="absolute top-1.5 right-1.5">{more}</div>
            </div>
            <div className="flex min-w-0 items-center gap-3 border-t border-line bg-surface-1 px-2.5 py-1.5 text-[11.5px] leading-4 text-muted-foreground">
              {line}
              <span className="ml-auto" />
              {when}
            </div>
          </>
        );
      case "sheet":
        return (
          <>
            <div className="relative overflow-hidden rounded-sm shadow-[0_0_0_1px_var(--line),0_6px_16px_-8px_rgb(0_0_0/0.6)] group-hover/card:shadow-[0_0_0_2px_var(--brand)]">
              <Picture project={project} className="h-[200px] w-full" />
              {pill}
              <div className="absolute top-1.5 right-1.5">{more}</div>
            </div>
            <div className="mt-2 flex min-w-0 items-center gap-2 text-[13px] leading-5">
              <span className={cn("size-2 shrink-0 rounded-full", swatch)} />
              <span className="flex min-w-0 font-semibold">{name}</span>
            </div>
            <div className="flex min-w-0 gap-2 pl-4 text-xs text-muted-foreground">{line}</div>
          </>
        );
    }
  })();

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
            data-damaged={damaged || undefined}
            style={view === "sheet" ? { width: Math.round(SHEET_HEIGHT * sheetAspect(project)) } : undefined}
            className={cn(
              "group/card relative cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-ring/60",
              view === "list" && [LIST_COLUMNS, "rounded-sm px-2 py-1.5 text-[13px] hover:bg-surface-2 data-[state=open]:bg-brand/12"],
              view === "cards" && [
                "flex flex-col overflow-hidden rounded-md border border-line-strong bg-surface-2 shadow-[0_2px_4px_rgb(0_0_0/0.25)] transition-colors",
                "hover:border-brand/70 data-[state=open]:border-brand data-[state=open]:ring-1 data-[state=open]:ring-brand/50",
              ],
              view === "sheet" && "flex shrink-0 flex-col",
            )}
          >
            {body}
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

/** A suite's tint without its background: its colour for an icon or text. */
const textOf = (tint: string) => tint.split(" ").filter((c) => !c.startsWith("bg-"));

/** A picture's shape in the sheet: its own, within reason (a panorama doesn't take a whole row). */
const sheetAspect = (project: ProjectSummary) => clamp(projectAspect(project), 0.5, 2.4);

/** Its picture (a video's first frame, a song's Playlist), else its suite's icon; a missing or damaged one says what to do. */
function Picture({ project, className, compact = false }: { project: ProjectSummary; className?: string; compact?: boolean }) {
  const box = cn("flex flex-col items-center justify-center gap-2 bg-sunken px-4 text-center", className ?? "aspect-[16/10]");
  if (compact && (project.damaged || project.missing)) {
    return (
      <div className={box}>
        {project.damaged ? <PiWarningCircle className="size-5 text-muted-foreground" /> : <PiMagnifyingGlass className="size-5 text-muted-foreground" />}
      </div>
    );
  }
  if (project.damaged) {
    return (
      <div className={box} title={project.damaged}>
        <PiWarningCircle className="size-6 text-muted-foreground" />
        <span className="text-xs leading-4 text-muted-foreground">Its document is damaged. Nothing was changed.</span>
        <span className="flex gap-1.5" onClick={(e) => e.stopPropagation()}>
          <Button variant="outline" size="xs" onClick={() => void useProjects.getState().reveal(project.id)}>
            Show in Finder
          </Button>
          <Button variant="ghost" size="xs" onClick={() => void useProjects.getState().forget(project.id)}>
            Remove
          </Button>
        </span>
      </div>
    );
  }
  if (project.missing) {
    return (
      <div className={box}>
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
  return <ProjectPreviewPicture project={project} className={className} compact={compact} />;
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
        (project.missing || project.damaged) && "opacity-50 grayscale",
      )}
    >
      {project.thumbnail ? <img src={project.thumbnail} alt="" draggable={false} className="size-full object-cover" /> : <Icon className="size-4" />}
    </div>
  );
}
