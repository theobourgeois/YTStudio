import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { addWindowListener } from "@/lib/window-events";
import { PiArrowDown, PiArrowUp, PiMagnifyingGlass } from "react-icons/pi";
import { formatRelative } from "@shared/format";
import { SUITES } from "@shared/suites";
import type { ProjectSummary } from "@shared/types";
import { cn } from "cn";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { useMainWindowDialog } from "@/components/windows/native/popups";
import { useLayout } from "@/stores/layout";
import { lastEdited, useProjects } from "@/stores/projects";
import { describeProject } from "@/suites";
import { showOpenDialog } from "./open-project-dialog";
import { Thumbnail } from "./project-card";
import { searchProjects } from "./project-search";

const MOD = navigator.platform.toLowerCase().includes("mac") ? "⌘" : "Ctrl+";
/** The keys of the app's project commands, as the Home screen and tooltips show them. */
export const NEW_PROJECT_KEYS = MOD === "⌘" ? "⇧⌘O" : "Ctrl+Shift+O";
export const PROJECT_SEARCH_KEYS = `${MOD}P`;
export const OPEN_KEYS = `${MOD}O`;
export const CLOSE_TAB_KEYS = `${MOD}W`;
export const HOME_KEYS = MOD === "⌘" ? "⇧⌘H" : "Ctrl+Shift+H";

/**
 * The app's project keys, wherever the keyboard is (any suite, or the Home screen), caught before the
 * editors' keys: ⇧⌘O the New project picker and ⌘P the project search (pressed again, each closes), ⌘O
 * Open…, ⇧⌘H the Home screen (and back to the project), ⌘W closes the open project's tab and ⇧⌘[ / ⇧⌘]
 * and ⌃Tab go through the tabs.
 */
export function useProjectShortcuts() {
  useEffect(() => {
    const onKeyDown = (e: globalThis.KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey || e.isComposing) return;
      const layout = useLayout.getState();
      // By the physical key: Shift doesn't change what's asked.
      if (e.code === "KeyO" && e.shiftKey) {
        e.preventDefault();
        e.stopPropagation();
        if (!e.repeat) layout.setNewProjectOpen(!layout.newProjectOpen);
      } else if (e.code === "KeyP" && !e.shiftKey) {
        // (Also keeps the browser's Print away.)
        e.preventDefault();
        e.stopPropagation();
        if (!e.repeat) layout.setProjectSearchOpen(!layout.projectSearchOpen);
      } else if (e.code === "KeyO" && !e.shiftKey) {
        e.preventDefault();
        e.stopPropagation();
        if (!e.repeat) showOpenDialog();
      } else if (e.code === "KeyW" && !e.shiftKey) {
        // The open project's tab. (A browser keeps ⌘W for its own tab; the desktop app's menu runs it too.)
        e.preventDefault();
        e.stopPropagation();
        const { openId, closeTab } = useProjects.getState();
        if (!e.repeat && openId) void closeTab(openId);
      } else if ((e.code === "BracketRight" || e.code === "BracketLeft") && e.shiftKey && (e.metaKey || (MOD !== "⌘" && e.ctrlKey))) {
        // Chrome's and Safari's keys for the next and previous tab (Ctrl+Shift+[ / ] off a Mac).
        e.preventDefault();
        e.stopPropagation();
        void useProjects.getState().cycleTab(e.code === "BracketRight" ? 1 : -1);
      } else if (e.code === "Tab" && e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        e.stopPropagation();
        void useProjects.getState().cycleTab(e.shiftKey ? -1 : 1);
      } else if (e.code === "KeyH" && e.shiftKey) {
        e.preventDefault();
        e.stopPropagation();
        if (!e.repeat) void useProjects.getState().toggleHome();
      }
    };
    // (In the editor's native windows too.)
    return addWindowListener("keydown", onKeyDown, true);
  }, []);
}

/** ⌘P: find a project by name, in any suite, and open it (arrows + Enter, as the New project picker). */
export function ProjectSearchDialog() {
  const open = useLayout((s) => s.projectSearchOpen);
  // Over the music editor's windows when they're the system's.
  const { container, ready } = useMainWindowDialog(open);
  return (
    <Dialog open={open && ready} modal={!container} onOpenChange={(next) => useLayout.getState().setProjectSearchOpen(next)}>
      <DialogContent container={container} showCloseButton={false} onOpenAutoFocus={(e) => e.preventDefault()} className="top-[22%] translate-y-0 gap-0 overflow-hidden p-0 sm:max-w-xl">
        {/* Remounted on each open, so it starts with an empty search and the latest project. */}
        {open && ready && <Search />}
      </DialogContent>
    </Dialog>
  );
}

/** The most shown at once: a few more come into view as the search narrows. */
const MOST = 50;

function Search() {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const projects = useProjects((s) => s.projects);
  const openId = useProjects((s) => s.openId);
  const found = useMemo(
    () => searchProjects(projects.filter((p) => !p.missing), query, (p) => SUITES[p.suite].label).slice(0, MOST),
    [projects, query],
  );
  const list = useRef<HTMLDivElement>(null);
  const now = Date.now();
  const current = Math.min(active, found.length - 1);

  useEffect(() => {
    list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
  }, [current]);

  const pick = (project: ProjectSummary | undefined) => {
    if (!project) return;
    useLayout.getState().setProjectSearchOpen(false);
    void useProjects.getState().open(project.id);
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const step = e.key === "ArrowDown" ? 1 : -1;
      if (found.length) setActive((i) => (Math.min(i, found.length - 1) + step + found.length) % found.length);
    } else if (e.key === "Enter" && !e.nativeEvent.isComposing) {
      e.preventDefault();
      pick(found[current]);
    }
  };

  return (
    <div onKeyDown={onKeyDown}>
      <DialogTitle className="sr-only">Find a project</DialogTitle>
      <DialogDescription className="sr-only">Type its name, then Enter to open it.</DialogDescription>
      <label className="flex h-14 items-center gap-3 border-b px-4.5 text-muted-foreground">
        <PiMagnifyingGlass className="size-4.5 shrink-0" />
        <input
          autoFocus
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          placeholder="Find a project…"
          aria-label="Find a project"
          aria-controls="project-search-results"
          aria-activedescendant={found[current] ? `project-search-${found[current].id}` : undefined}
          className="min-w-0 flex-1 bg-transparent text-[15px] text-foreground outline-none placeholder:text-muted-foreground"
        />
      </label>

      <div ref={list} id="project-search-results" role="listbox" aria-label="Projects" className="flex max-h-[min(24rem,55vh)] flex-col gap-0.5 overflow-y-auto px-2 py-2">
        {found.map((project, i) => (
          <div
            key={project.id}
            id={`project-search-${project.id}`}
            role="option"
            aria-selected={i === current}
            aria-label={project.name}
            data-project-id={project.id}
            onPointerMove={() => setActive(i)}
            onClick={() => pick(project)}
            className={cn("flex cursor-pointer items-center gap-3 rounded-lg px-2.5 py-2", i === current && "bg-accent")}
          >
            <Thumbnail project={project} />
            <span className="grid min-w-0 flex-1">
              <span className="flex items-center gap-2 text-sm font-medium">
                <span className="truncate">{project.name}</span>
                {project.id === openId && <span className="shrink-0 rounded-md border px-1.5 text-[10px] leading-4 font-medium text-muted-foreground">Open</span>}
              </span>
              <span className="truncate text-xs leading-5 text-muted-foreground">
                {SUITES[project.suite].label} · {describeProject(project)}
              </span>
            </span>
            <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{formatRelative(lastEdited(project), now)}</span>
          </div>
        ))}
        {found.length === 0 && <p className="px-2.5 py-6 text-center text-[13px] text-muted-foreground">{projects.length ? "Nothing matches." : "No projects yet."}</p>}
      </div>

      <div className="flex items-center gap-4 border-t bg-muted/30 px-4 py-2.5 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <Key>
            <PiArrowUp className="size-3" />
          </Key>
          <Key>
            <PiArrowDown className="size-3" />
          </Key>
          Navigate
        </span>
        <span className="flex items-center gap-1.5">
          <Key>Enter</Key>
          Open
        </span>
        <span className="flex items-center gap-1.5">
          <Key>Esc</Key>
          Close
        </span>
        <span className="ml-auto flex items-center gap-1.5">
          <Key>{NEW_PROJECT_KEYS}</Key>
          New project
        </span>
      </div>
    </div>
  );
}

function Key({ children }: { children: React.ReactNode }) {
  return <kbd className="grid h-5 min-w-5 place-items-center rounded border bg-background px-1 font-sans text-[11px] leading-none">{children}</kbd>;
}
