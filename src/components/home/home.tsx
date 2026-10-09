import { useEffect, useMemo, useState } from "react";
import type { IconType } from "react-icons";
import { PiFolderOpen, PiImages, PiListBullets, PiMagnifyingGlass, PiSquaresFour, PiUploadSimple } from "react-icons/pi";
import { appIconUrl } from "@shared/app-icons";
import { SUITES, SUITE_IDS, type SuiteId, suiteNoun } from "@shared/suites";
import { WindowButtons } from "@/components/header/window-buttons";
import { SettingsButton } from "@/components/settings/settings-button";
import { useFileDrop } from "@/hooks/use-file-drop";
import { useNow } from "@/hooks/use-now";
import { cn } from "cn";
import { useAppIcon } from "@/stores/app-icon";
import { useProjects } from "@/stores/projects";
import { useSettings } from "@/stores/settings";
import { clientSuite } from "@/suites";
import { folderOf, type HomeView, LIST_COLUMNS, ProjectCard } from "./project-card";
import { groupByWhen, searchProjects } from "./project-search";
import { OPEN_KEYS, NEW_PROJECT_KEYS, PROJECT_SEARCH_KEYS } from "./project-search-dialog";
import { showOpenDialog } from "./open-project-dialog";

const MOD = navigator.platform.toLowerCase().includes("mac") ? "⌘" : "Ctrl+";
/** Which suite's projects the Home screen lists (all of them by default), kept in this browser. */
const FILTER_KEY = "editor-home-suite";

/** How Home shows the recents (`HomeView`): the list by default. */
const VIEW_KEY = "editor-home-view";

type Filter = SuiteId | "all";

const VIEWS: { id: HomeView; label: string; Icon: IconType }[] = [
  { id: "list", label: "List", Icon: PiListBullets },
  { id: "cards", label: "Cards", Icon: PiSquaresFour },
  { id: "sheet", label: "Sheet", Icon: PiImages },
];

const savedView = (): HomeView => {
  const saved = localStorage.getItem(VIEW_KEY);
  return VIEWS.some((v) => v.id === saved) ? (saved as HomeView) : "list";
};

const savedFilter = (): Filter => {
  const saved = localStorage.getItem(FILTER_KEY);
  return saved && (SUITE_IDS as string[]).includes(saved) ? (saved as SuiteId) : "all";
};

/**
 * The Home screen, shown while no project is open (Premiere's, Resolve's): start a project in any suite,
 * or open one of this computer's recents (each a file on disk) or any other (Open…). Files dropped here
 * start a project of the first suite that takes them; a project's package dropped here (desktop) opens.
 */
export function Home() {
  const projects = useProjects((s) => s.projects);
  const location = useProjects((s) => s.location);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>(savedFilter);
  const [view, setView] = useState<HomeView>(savedView);
  const now = useNow(30_000);

  const shown = useMemo(() => {
    const ofSuite = filter === "all" ? projects : projects.filter((p) => p.suite === filter);
    return searchProjects(ofSuite, query, (p) => SUITES[p.suite].label);
  }, [projects, query, filter]);

  const pickFilter = (next: Filter) => {
    localStorage.setItem(FILTER_KEY, next);
    setFilter(next);
  };

  const drop = useFileDrop((files) => void useProjects.getState().startWith(files));

  // Packages may have been moved, renamed or deleted in Finder: read the list again when Home shows or comes back.
  useEffect(() => {
    const refresh = () => void useProjects.getState().refresh();
    refresh();
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, []);

  // ⌘F finds a project here, as it does in a list anywhere; ⌘1, ⌘2… start one (⌥: blank), as the New tiles say.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.repeat) return;
      const digit = /^Digit([1-9])$/.exec(e.code);
      if (e.code === "KeyF" && !e.altKey) {
        e.preventDefault();
        document.getElementById("home-search")?.focus();
      } else if (digit && SUITE_IDS[Number(digit[1]) - 1]) {
        e.preventDefault();
        void useProjects.getState().create({ suite: SUITE_IDS[Number(digit[1]) - 1], blank: e.altKey });
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const pickView = (next: HomeView) => {
    localStorage.setItem(VIEW_KEY, next);
    setView(next);
  };

  return (
    <div className="relative flex h-full min-w-0 flex-1 flex-col bg-surface-1" {...drop.handlers}>
      <header data-titlebar="home" className="flex h-13 shrink-0 items-center gap-3 border-b border-line bg-surface-0 px-4">
        <AppMark />
        <label className="sunken mx-auto flex h-8 w-full max-w-md min-w-40 items-center gap-2 rounded-md px-2.5 text-muted-foreground focus-within:ring-2 focus-within:ring-ring/60">
          <PiMagnifyingGlass className="size-4 shrink-0" />
          <input
            id="home-search"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && setQuery("")}
            placeholder="Search projects"
            aria-label="Search projects"
            className="min-w-0 flex-1 bg-transparent text-[13px] text-foreground outline-none placeholder:text-muted-foreground"
          />
          <kbd className="shrink-0 font-sans text-[11px]">{MOD}F</kbd>
        </label>
        <SettingsButton />
        <WindowButtons className="-ml-1" />
      </header>

      <div className="flex min-h-0 flex-1">
        <aside aria-label="Start" className="flex w-60 shrink-0 flex-col gap-1.5 overflow-y-auto border-r border-line bg-surface-0 px-3.5 pt-5 pb-4">
          {SUITE_IDS.map((id, i) => (
            <NewTile key={id} suite={id} index={i} />
          ))}
          <div className="mx-1 my-2.5 h-px bg-line shadow-[0_1px_0_var(--bevel-highlight)]" />
          <OpenTile />
          <p className="mt-auto px-1.5 pt-4 text-[11px] leading-[1.6] text-muted-foreground">
            New projects are saved in
            <br />
            <span className="font-mono text-[11px] text-foreground/80" title={location?.path}>
              {location ? folderOf(`${location.path}/x`) : "…"}
            </span>{" "}
            <button type="button" className="text-brand hover:underline" onClick={() => useSettings.getState().show("general")}>
              Change
            </button>
          </p>
        </aside>

        <main className="flex min-h-0 min-w-0 flex-1 flex-col" aria-label="Home">
          <div className="flex shrink-0 flex-wrap items-center gap-x-5 gap-y-2 px-8 pt-6 pb-3">
            <h2 id="home-recent" className="text-[17px] font-bold tracking-tight">
              Recent
            </h2>
            <div role="radiogroup" aria-label="Show" className="flex items-center gap-0.5">
              {(["all", ...SUITE_IDS] as Filter[]).map((id) => (
                <button
                  key={id}
                  type="button"
                  role="radio"
                  aria-checked={filter === id}
                  onClick={() => pickFilter(id)}
                  className={cn(
                    "h-7 rounded-sm border border-transparent px-2.5 text-[13px] text-muted-foreground transition-colors hover:text-foreground",
                    filter === id && "raised text-foreground",
                  )}
                >
                  {id === "all" ? "All" : capitalise(suiteNoun(id, 2))}
                </button>
              ))}
            </div>
            <div role="radiogroup" aria-label="View" className="sunken ml-auto flex h-7 items-center gap-0.5 rounded-md p-0.5">
              {VIEWS.map(({ id, label, Icon }) => (
                <button
                  key={id}
                  type="button"
                  role="radio"
                  aria-checked={view === id}
                  aria-label={label}
                  title={label}
                  onClick={() => pickView(id)}
                  className={cn(
                    "grid h-full w-7 place-items-center rounded-sm border border-transparent text-muted-foreground transition-colors hover:text-foreground",
                    view === id && "raised text-foreground",
                  )}
                >
                  <Icon className="size-4" />
                </button>
              ))}
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-8 pb-12">
            {shown.length === 0 ? (
              <Empty searching={query.trim() !== "" || filter !== "all"} hasAny={projects.length > 0} />
            ) : view === "list" ? (
              <>
                <div aria-hidden className={cn(LIST_COLUMNS, "sticky top-0 z-[1] border-b border-line bg-surface-1 px-2 py-2 text-[11px] font-semibold text-muted-foreground")}>
                  <span />
                  <span>Name</span>
                  <span>Kind</span>
                  <span>Details</span>
                  <span>Opened</span>
                  <span>Where</span>
                  <span />
                </div>
                <div role="list" aria-label="Recent projects" className="flex flex-col pt-1">
                  {shown.map((p) => (
                    <div role="listitem" key={p.id}>
                      <ProjectCard project={p} now={now} view="list" />
                    </div>
                  ))}
                </div>
              </>
            ) : view === "cards" ? (
              <div role="list" aria-label="Recent projects" className="grid grid-cols-[repeat(auto-fill,minmax(230px,1fr))] gap-3.5 pt-1">
                {shown.map((p) => (
                  <div role="listitem" key={p.id}>
                    <ProjectCard project={p} now={now} view="cards" />
                  </div>
                ))}
              </div>
            ) : (
              <div role="list" aria-label="Recent projects" className="flex flex-col gap-7 pt-1">
                {groupByWhen(shown, now).map((group) => (
                  <section key={group.label} aria-label={group.label}>
                    <h3 className="mb-2.5 text-xs font-semibold text-muted-foreground">{group.label}</h3>
                    <div className="flex flex-wrap items-start gap-x-4 gap-y-5">
                      {group.projects.map((p) => (
                        <div role="listitem" key={p.id}>
                          <ProjectCard project={p} now={now} view="sheet" />
                        </div>
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            )}
          </div>
        </main>
      </div>

      {drop.active && (
        <div className="pointer-events-none absolute inset-3 z-10 grid place-items-center rounded-md border-2 border-dashed border-brand bg-brand/8">
          <span className="floating flex items-center gap-2 rounded-md px-4 py-3 text-sm font-medium">
            <PiUploadSimple className="size-5 text-brand" />
            Drop clips to start a new {suiteNoun(SUITE_IDS[0])}, images to start a photo, or a project to open it
          </span>
        </div>
      )}
    </div>
  );
}

/** The app's icon and name, in the corner (after a Mac's window buttons in the desktop app). */
function AppMark() {
  const icon = useAppIcon((s) => s.choice);
  return (
    <div className="flex shrink-0 items-center gap-2 select-none">
      <img src={appIconUrl(icon)} alt="" className="size-6" draggable={false} />
      <span className="text-[14px] font-semibold tracking-tight">YTStudio</span>
    </div>
  );
}

/** Open a project from a file, under the New buttons. */
export function OpenTile() {
  return (
    <button
      type="button"
      onClick={() => showOpenDialog()}
      title="Open a .yt file: a copy, a backup, one sent to you"
      className="flex h-9 items-center gap-2.5 rounded-sm px-3 text-left text-[13px] font-medium transition-colors hover:bg-surface-2"
    >
      <PiFolderOpen className="size-4.5 shrink-0 text-muted-foreground" />
      Open…
      <kbd className="ml-auto font-mono text-[11px] text-muted-foreground">{OPEN_KEYS}</kbd>
    </button>
  );
}

/** A suite's New button: click (⌥: blank, whatever its starting point) to make one, ⌘1, ⌘2… from anywhere on Home. */
export function NewTile({ suite, index }: { suite: SuiteId; index: number }) {
  const { label, noun, description } = SUITES[suite];
  const { icon: Icon, tint } = clientSuite(suite);
  const template = useProjects((s) => s.templates[suite]);
  return (
    <button
      type="button"
      data-suite={suite}
      aria-label={`New ${noun}`}
      title={template ? `Starts as “${template.name}” (⌥ for blank)` : description}
      onClick={(e) => void useProjects.getState().create({ suite, blank: e.altKey })}
      className="raised flex h-10 items-center gap-2.5 rounded-sm px-3 text-left text-[13px] font-semibold hover:raised-hover active:pressed"
    >
      {/* The tint's colour alone: the button is the tile. */}
      <Icon className={cn("size-4.5 shrink-0", tint.split(" ").filter((c) => !c.startsWith("bg-")))} />
      New {noun}
      {template && <span className="size-1.5 shrink-0 rounded-full bg-brand" aria-hidden />}
      {index < 9 && (
        <kbd className="ml-auto font-mono text-[11px] font-normal text-muted-foreground tabular-nums">
          {MOD}
          {index + 1}
        </kbd>
      )}
      <span className="sr-only">{label}</span>
    </button>
  );
}

function Empty({ searching, hasAny }: { searching: boolean; hasAny: boolean }) {
  if (searching && hasAny) return <p className="py-14 text-center text-[13px] text-muted-foreground">Nothing matches.</p>;
  return (
    <div className="flex flex-col items-center rounded-md border border-dashed border-muted-foreground/35 px-8 py-14 text-center">
      <span className="grid size-12 place-items-center rounded-md bg-surface-2 text-muted-foreground">
        <PiUploadSimple className="size-6" />
      </span>
      <h3 className="mt-4 text-[15px] font-semibold">Nothing here yet</h3>
      <p className="mt-1.5 max-w-sm text-[13px] leading-5 text-muted-foreground">
        Start something on the left, drop your clips here to start a {suiteNoun(SUITE_IDS[0])} (images alone start a photo), or open a project you already have
        ({OPEN_KEYS}). Projects you open show up here.
      </p>
      <p className="mt-3 text-xs text-muted-foreground">
        <Kbd>{NEW_PROJECT_KEYS}</Kbd> new project · <Kbd>{PROJECT_SEARCH_KEYS}</Kbd> find one
      </p>
    </div>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return <kbd className="ml-1.5 rounded border border-line bg-surface-2 px-1 font-sans text-[10px] leading-4 text-muted-foreground">{children}</kbd>;
}

const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
