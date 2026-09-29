import { useMemo, useState } from "react";
import { PiCaretRight, PiMagnifyingGlass, PiNotePencil } from "react-icons/pi";
import type { ProjectSummary } from "@shared/types";
import { useNow } from "@/hooks/use-now";
import { LogoMark } from "@/components/brand/logo-mark";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { SHORTCUT_KEYS } from "@/hooks/shortcuts";
import { cn } from "cn";
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
        open ? "w-76 border-r" : "w-0",
      )}
    >
      <div className="flex h-full w-76 flex-col">
        <div className="flex h-13 shrink-0 items-center gap-2.5 px-3">
          <SidebarToggle />
        </div>

        <div className="flex items-center gap-1 px-2.5 pb-3">
          <label className="flex h-9 min-w-0 flex-1 items-center gap-2.5 rounded-lg px-2.5 text-muted-foreground transition-colors focus-within:bg-accent hover:bg-accent/60">
            <PiMagnifyingGlass className="size-4.5 shrink-0" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Escape" && setQuery("")}
              placeholder="Search"
              aria-label="Search videos"
              className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
            />
          </label>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-9 text-muted-foreground hover:text-foreground [&_svg:not([class*='size-'])]:size-4.5"
                aria-label="New video"
                onClick={() => void useProjects.getState().create()}
              >
                <PiNotePencil />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">New video</TooltipContent>
          </Tooltip>
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
              {query ? "No videos match." : "Nothing in progress. Start a new video to get going."}
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
      </div>
    </aside>
  );
}

/** The logo doubles as the show/hide toggle. Rendered in the sidebar and, when it's hidden, in the header. */
export function SidebarToggle({ className }: { className?: string }) {
  const open = useLayout((s) => s.sidebarOpen);
  const label = open ? "Hide sidebar" : "Show sidebar";
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          aria-expanded={open}
          className={cn(
            "grid shrink-0 cursor-pointer place-items-center rounded-lg outline-none transition-[filter,transform]",
            "hover:brightness-110 active:scale-95 focus-visible:ring-[3px] focus-visible:ring-ring/40",
            className,
          )}
          onClick={() => useLayout.getState().toggleSidebar()}
        >
          <LogoMark />
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        {label}
        <kbd className="ml-2 rounded border bg-muted px-1 font-sans text-[10px] leading-4 text-muted-foreground">{SHORTCUT_KEYS.toggleSidebar}</kbd>
      </TooltipContent>
    </Tooltip>
  );
}

/** Re-render every `interval` ms so relative times stay fresh. */
