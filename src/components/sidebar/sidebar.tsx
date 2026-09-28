import { useEffect, useMemo, useState } from "react";
import { PiCaretRight, PiMagnifyingGlass, PiNotePencil, PiSidebarSimple } from "react-icons/pi";
import type { ProjectSummary } from "@shared/types";
import { LogoMark } from "@/components/brand/logo-mark";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { SIDEBAR_SHORTCUT_LABEL } from "@/hooks/shortcuts";
import { cn } from "@/lib/utils";
import { useEditor } from "@/stores/editor";
import { useLayout } from "@/stores/layout";
import { activeProjects, settledProjects, useProjects } from "@/stores/projects";
import { ProjectItem } from "./project-item";

const SETTLED_OPEN_KEY = "editor-settled-open";

/** Collapsible project list: videos in progress on top, the settled pile below. */
export function Sidebar() {
  const open = useLayout((s) => s.sidebarOpen);
  const projects = useProjects((s) => s.projects);
  const openId = useEditor((s) => s.projectId);
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
      aria-label="Videos"
      inert={!open}
      className={cn(
        "h-full shrink-0 overflow-hidden bg-sidebar transition-[width] duration-200 ease-out",
        open ? "w-64 border-r" : "w-0",
      )}
    >
      <div className="flex h-full w-64 flex-col">
        <div className="flex h-12 shrink-0 items-center gap-2 px-3">
          <LogoMark />
          <span className="text-sm font-semibold tracking-tight">Editor</span>
          <SidebarToggle className="ml-auto" />
        </div>

        <div className="flex flex-col gap-2 px-3 pb-3">
          <Button
            variant="outline"
            size="sm"
            className="w-full justify-start gap-2"
            onClick={() => void useProjects.getState().create()}
          >
            <PiNotePencil />
            New video
          </Button>
          <label className="flex h-8 items-center gap-2 rounded-md px-2 text-muted-foreground ring-1 ring-border focus-within:ring-2 focus-within:ring-ring/60">
            <PiMagnifyingGlass className="size-3.5 shrink-0" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Escape" && setQuery("")}
              placeholder="Search videos"
              className="min-w-0 flex-1 bg-transparent text-[13px] text-foreground outline-none placeholder:text-muted-foreground"
            />
          </label>
        </div>

        <nav className="min-h-0 flex-1 overflow-y-auto px-2 pb-2" aria-label="In progress">
          {active.length > 0 ? (
            <div className="flex flex-col gap-0.5">
              {active.map((p) => (
                <ProjectItem key={p.id} project={p} selected={p.id === openId} now={now} />
              ))}
            </div>
          ) : (
            <p className="px-2 py-6 text-center text-xs leading-5 text-muted-foreground">
              {query ? "No videos match." : "Nothing in progress. Start a new video to get going."}
            </p>
          )}
        </nav>

        {settled.length > 0 && (
          <div className={cn("flex min-h-0 flex-col border-t", showSettled && "max-h-[45%]")}>
            <button
              type="button"
              aria-expanded={showSettled}
              onClick={toggleSettled}
              className="flex h-10 shrink-0 items-center gap-2 px-4 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              Settled
              <span className="tabular-nums">({settled.length})</span>
              <PiCaretRight className={cn("ml-auto size-3.5 transition-transform", showSettled && "rotate-90")} />
            </button>
            {showSettled && (
              <nav className="min-h-0 overflow-y-auto px-2 pb-2" aria-label="Settled">
                <div className="flex flex-col gap-0.5">
                  {settled.map((p) => (
                    <ProjectItem key={p.id} project={p} selected={p.id === openId} now={now} />
                  ))}
                </div>
              </nav>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}

/** Show/hide the sidebar. Rendered in the sidebar and, when it's hidden, in the header. */
export function SidebarToggle({ className }: { className?: string }) {
  const open = useLayout((s) => s.sidebarOpen);
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          className={cn("text-muted-foreground hover:text-foreground", className)}
          onClick={() => useLayout.getState().toggleSidebar()}
        >
          <PiSidebarSimple />
          <span className="sr-only">{open ? "Hide sidebar" : "Show sidebar"}</span>
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        {open ? "Hide sidebar" : "Show sidebar"}
        <kbd className="ml-2 font-sans text-background/60">{SIDEBAR_SHORTCUT_LABEL}</kbd>
      </TooltipContent>
    </Tooltip>
  );
}

/** Re-render every `interval` ms so relative times stay fresh. */
function useNow(interval: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), interval);
    return () => clearInterval(id);
  }, [interval]);
  return now;
}
