import { useMemo, useState } from "react";
import { PiCaretRight, PiGearSix, PiMagnifyingGlass, PiNotePencil, PiSidebarSimple } from "react-icons/pi";
import type { ProjectSummary } from "@shared/types";
import { useNow } from "@/hooks/use-now";
import { SETTINGS_KEYS } from "@/components/settings/settings-window";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { SHORTCUT_KEYS } from "@/hooks/shortcuts";
import { cn } from "cn";
import { useLayout } from "@/stores/layout";
import { activeProjects, projectSuite, settledProjects, useProjects } from "@/stores/projects";
import { useSettings } from "@/stores/settings";
import { ProjectItem } from "./project-item";
import { NEW_PROJECT_KEYS, PROJECT_SEARCH_KEYS } from "./project-search-dialog";

const SETTLED_OPEN_KEY = "editor-settled-open";

/** Collapsible project list (every suite's): projects in progress on top, the settled pile below. */
export function Sidebar() {
  const open = useLayout((s) => s.sidebarOpen);
  const projects = useProjects((s) => s.projects);
  const openId = useProjects((s) => s.openId);
  const [query, setQuery] = useState("");
  const [settledOpen, setSettledOpen] = useState(() => localStorage.getItem(SETTLED_OPEN_KEY) === "true");
  const now = useNow(30_000);

  const { active, settled } = useMemo(() => {
    const q = query.trim().toLowerCase();
    const match = (p: ProjectSummary) => !q || p.name.toLowerCase().includes(q);
    return {
      active: activeProjects(projects).filter(match),
      settled: settledProjects(projects).filter(match),
    };
  }, [projects, query]);

  const toggleSettled = () => {
    localStorage.setItem(SETTLED_OPEN_KEY, String(!settledOpen));
    setSettledOpen(!settledOpen);
  };
  // Searching reveals matches in the settled pile too.
  const showSettled = settledOpen || (query.trim() !== "" && settled.length > 0);

  return (
    <aside
      aria-label="Projects"
      inert={!open}
      className={cn(
        "h-full shrink-0 overflow-hidden bg-sidebar transition-[width] duration-200 ease-out",
        open ? "w-76 border-r" : "w-0",
      )}
    >
      <div className="flex h-full w-76 flex-col">
        {/* The toggle floats over this bar's left end (SidebarToggle); New project is at its right. */}
        <div data-titlebar="sidebar" className="flex h-13 shrink-0 items-center justify-end px-2.5">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                className="text-muted-foreground hover:text-foreground [&_svg:not([class*='size-'])]:size-4.5"
                aria-label="New project"
                onClick={() => useLayout.getState().setNewProjectOpen(true)}
              >
                <PiNotePencil />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              New project
              <kbd className="ml-2 rounded border bg-muted px-1 font-sans text-[10px] leading-4 text-muted-foreground">{NEW_PROJECT_KEYS}</kbd>
            </TooltipContent>
          </Tooltip>
        </div>

        <div className="px-2.5 pb-3">
          <label className="flex h-9 min-w-0 items-center gap-2.5 rounded-lg px-2.5 text-muted-foreground transition-colors focus-within:bg-accent hover:bg-accent/60">
            <PiMagnifyingGlass className="size-4.5 shrink-0" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Escape" && setQuery("")}
              placeholder="Search"
              aria-label="Search projects"
              title={`Search these projects (${PROJECT_SEARCH_KEYS} finds one from anywhere)`}
              className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
            />
          </label>
        </div>

        <nav className="min-h-0 flex-1 overflow-y-auto px-2.5 pb-2" aria-label="In progress">
          {active.length > 0 ? (
            <div className="flex flex-col gap-1">
              {active.map((p) => (
                <ProjectItem key={p.id} project={p} selected={p.id === openId} now={now} />
              ))}
            </div>
          ) : (
            <p className="px-3 py-6 text-center text-[13px] leading-5 text-muted-foreground">
              {query ? "Nothing matches." : "Nothing in progress. Start a new project to get going."}
            </p>
          )}
        </nav>

        {settled.length > 0 && (
          <div className={cn("flex min-h-0 flex-col", showSettled && "max-h-[45%]")}>
            <button
              type="button"
              aria-expanded={showSettled}
              onClick={toggleSettled}
              className="flex h-10 shrink-0 items-center gap-2 px-5 text-[13px] font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              <span>
                Settled <span className="tabular-nums">({settled.length})</span>
              </span>
              <span aria-hidden className="h-px flex-1 bg-border" />
              <PiCaretRight className={cn("size-3.5 transition-transform", showSettled && "rotate-90")} />
            </button>
            {showSettled && (
              <nav className="min-h-0 overflow-y-auto px-2.5 pb-2" aria-label="Settled">
                <div className="flex flex-col gap-1">
                  {settled.map((p) => (
                    <ProjectItem key={p.id} project={p} selected={p.id === openId} now={now} />
                  ))}
                </div>
              </nav>
            )}
          </div>
        )}

        <div className="shrink-0 border-t border-line px-2.5 py-2">
          <button
            type="button"
            onClick={() => useSettings.getState().show(projectSuite(openId) ?? "general")}
            className="flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-[13px] text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground"
          >
            <PiGearSix className="size-4.5 shrink-0" />
            Settings
            <kbd className="ml-auto font-sans text-xs">{SETTINGS_KEYS}</kbd>
          </button>
        </div>
      </div>
    </aside>
  );
}

/**
 * Shows and hides the sidebar. One button for the whole window, pinned to its top-left corner (beside a Mac's
 * window buttons in the desktop app, `.sidebar-toggle` in index.css), so it stays put whether the sidebar is
 * open or not and whichever suite's header is below it; headers leave it room while the sidebar is hidden.
 */
export function SidebarToggle() {
  const open = useLayout((s) => s.sidebarOpen);
  const label = open ? "Hide sidebar" : "Show sidebar";
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={label}
          aria-expanded={open}
          className="sidebar-toggle fixed top-3 z-40 text-muted-foreground hover:text-foreground [&_svg:not([class*='size-'])]:size-4.5"
          onClick={() => useLayout.getState().toggleSidebar()}
        >
          <PiSidebarSimple />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        {label}
        <kbd className="ml-2 rounded border bg-muted px-1 font-sans text-[10px] leading-4 text-muted-foreground">{SHORTCUT_KEYS.toggleSidebar}</kbd>
      </TooltipContent>
    </Tooltip>
  );
}

/** Re-render every `interval` ms so relative times stay fresh. */
