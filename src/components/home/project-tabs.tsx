import { type MouseEvent, type PointerEvent, useRef } from "react";
import { PiFilePlus, PiPlus, PiX } from "react-icons/pi";
import { appIconUrl } from "@shared/app-icons";
import { DEFAULT_SUITE } from "@shared/suites";
import { cn } from "cn";
import { useShallow } from "zustand/react/shallow";
import { Button } from "@/components/ui/button";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from "@/components/ui/context-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useFileDrop, useFilesDragged } from "@/hooks/use-file-drop";
import { startPointerDrag } from "@/lib/pointer-drag";
import { FILE_MANAGER } from "@/lib/key-labels";
import { useAppIcon } from "@/stores/app-icon";
import { useLayout } from "@/stores/layout";
import { tabsVisible } from "@/stores/project-tabs";
import { projectSuite, useProjects } from "@/stores/projects";
import { clientSuite } from "@/suites";
import { CLOSE_TAB_KEYS, HOME_KEYS, NEW_PROJECT_KEYS } from "./project-search-dialog";

/** The projects open as tabs that can still be shown (a package moved away has nothing to open). */
function useTabIds(): string[] {
  return useProjects(
    useShallow((s) => s.tabs.filter((id) => s.projects.some((p) => p.id === id && !p.missing))),
  );
}

/** Whether the strip shows (`tabsVisible`); the Home button gives way to it, and headers lose their room for it. */
export function useTabsShown(): boolean {
  const count = useTabIds().length;
  const home = useProjects((s) => s.openId === null);
  return tabsVisible(count, home);
}

/**
 * The open projects as tabs along the top of the window, Photoshop's way: click one to switch (the project
 * you leave is saved first), drag to reorder, × or middle-click to close (the project stays on disk), + for
 * a new one. The Home screen is the app's icon at the left (the one chosen in Settings); the open project's menus are on the row below (`MenuRow`). It's a title bar in the desktop app (the window's
 * buttons sit at its left, as the Home button did). Files dropped on it start a new project, as on Home (an image
 * a photo named after it, footage a video).
 */
export function ProjectTabs() {
  const ids = useTabIds();
  const openId = useProjects((s) => s.openId);
  const icon = useAppIcon((s) => s.choice);
  const strip = useRef<HTMLDivElement>(null);
  const drop = useFileDrop((files) => void useProjects.getState().startWith(files));
  // While files are dragged over the window, the title bar takes drops rather than moving the window.
  const filesDragged = useFilesDragged();

  return (
    <div
      data-titlebar="tabs"
      className={cn("flex h-10 shrink-0 items-end gap-1 border-b border-line bg-surface-0 px-2 pb-1 select-none", drop.active && "bg-brand/10")}
      style={filesDragged ? ({ WebkitAppRegion: "no-drag" } as React.CSSProperties) : undefined}
      data-file-drop={drop.active || undefined}
      {...drop.handlers}
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Home"
            aria-pressed={openId === null}
            className={cn("project-tabs-home mb-px shrink-0", openId === null && "raised")}
            onClick={() => void useProjects.getState().goHome()}
          >
            <img src={appIconUrl(icon)} alt="" className="size-5" draggable={false} />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          Home: all your projects
          <kbd className="ml-2 rounded border bg-muted px-1 font-sans text-[10px] leading-4 text-muted-foreground">{HOME_KEYS}</kbd>
        </TooltipContent>
      </Tooltip>

      <div ref={strip} role="tablist" aria-label="Open projects" className="flex min-w-0 items-end gap-1">
        {ids.map((id) => (
          <ProjectTab key={id} id={id} selected={id === openId} strip={strip} />
        ))}
        {drop.active && (
          <div className="flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-dashed border-brand px-2 text-[13px] font-medium text-brand" data-drop-tab>
            <PiFilePlus className="size-4" /> New project
          </div>
        )}
      </div>

      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="New project"
            className="mb-[3px] shrink-0 text-muted-foreground hover:text-foreground"
            onClick={() => useLayout.getState().setNewProjectOpen(true)}
          >
            <PiPlus />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          New project
          <kbd className="ml-2 rounded border bg-muted px-1 font-sans text-[10px] leading-4 text-muted-foreground">{NEW_PROJECT_KEYS}</kbd>
        </TooltipContent>
      </Tooltip>
    </div>
  );
}

function ProjectTab({ id, selected, strip }: { id: string; selected: boolean; strip: React.RefObject<HTMLDivElement | null> }) {
  const project = useProjects((s) => s.projects.find((p) => p.id === id));
  // A project's suite never changes, so this tab's hooks are the same ones for as long as it's there.
  const suite = clientSuite(useRef(projectSuite(id) ?? DEFAULT_SUITE).current);
  // The open project's name as it's typed; the others' as last saved.
  const liveName = suite.useLiveName(id);
  if (!project) return null;
  const { icon: Icon, tint } = suite;
  const name = liveName ?? project.name;

  const reorder = (e: PointerEvent<HTMLElement>) => {
    // Under the pointer's place in the strip, the tab moves there as the pointer does.
    startPointerDrag(e, {
      threshold: 5,
      cursor: "grabbing",
      onMove: (ev) => {
        const tabs = [...(strip.current?.querySelectorAll<HTMLElement>("[data-tab-id]") ?? [])];
        const at = tabs.findIndex((t) => {
          const r = t.getBoundingClientRect();
          return ev.clientX >= r.left && ev.clientX < r.right;
        });
        if (at >= 0 && tabs[at].dataset.tabId !== id) useProjects.getState().moveTab(id, at);
      },
    });
  };
  const close = (e: MouseEvent) => {
    e.stopPropagation();
    void useProjects.getState().closeTab(id);
  };

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          data-tab-id={id}
          role="tab"
          aria-selected={selected}
          aria-label={name}
          tabIndex={0}
          title={name}
          onPointerDown={reorder}
          onMouseDown={(e) => e.button === 1 && e.preventDefault()}
          onAuxClick={(e) => e.button === 1 && close(e)}
          onClick={() => void useProjects.getState().open(id)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              void useProjects.getState().open(id);
            }
          }}
          className={cn(
            "group flex h-8 min-w-24 max-w-52 shrink cursor-default items-center gap-1.5 rounded-md pr-1 pl-1.5 text-[13px] font-medium outline-none",
            selected ? "raised text-foreground" : "border border-transparent text-muted-foreground hover:bg-accent/60 hover:text-foreground",
          )}
        >
          <span className={cn("grid size-5 shrink-0 place-items-center rounded", tint)}>
            <Icon className="size-3" />
          </span>
          <span className="min-w-0 flex-1 truncate">{name}</span>
          <button
            type="button"
            aria-label={`Close ${name}`}
            tabIndex={-1}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={close}
            className={cn(
              "grid size-5 shrink-0 place-items-center rounded text-muted-foreground hover:bg-foreground/10 hover:text-foreground",
              !selected && "opacity-0 group-hover:opacity-100",
            )}
          >
            <PiX className="size-3" />
          </button>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-52">
        <ContextMenuItem onSelect={() => void useProjects.getState().closeTab(id)}>
          Close tab
          <span className="ml-auto pl-4 text-xs text-muted-foreground">{selected ? CLOSE_TAB_KEYS : ""}</span>
        </ContextMenuItem>
        <ContextMenuItem
          disabled={useProjects.getState().tabs.length < 2}
          onSelect={() => {
            const { tabs, closeTab, open } = useProjects.getState();
            // Keep this one: show it first, so closing the rest doesn't flick through their neighbours.
            void open(id).then(() => tabs.filter((t) => t !== id).forEach((t) => void closeTab(t)));
          }}
        >
          Close other tabs
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={() => void useProjects.getState().reveal(id)}>Show in {FILE_MANAGER}</ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
