import { create } from "zustand";
import { toast } from "sonner";
import { DEFAULT_SUITE, SUITE_IDS, type SuiteId, suiteNoun } from "@shared/suites";
import type { ProjectLocation, ProjectSummary, ProjectTemplates } from "@shared/types";
import { errorMessage } from "@shared/errors";
import { api } from "@/lib/api";
import { chooseProjectFile, noteOpenedProject } from "@/lib/desktop";
import { projectIdFromUrl, setUrlProject } from "@/lib/route";
import { clientSuite } from "@/suites";
import { onProjectSaved } from "./autosave";

/**
 * The projects this computer has opened (its recents: each a package on disk, a video, a song... see
 * `shared/suites.ts`), and which one is open (the URL tracks it; none is the Home screen). It hands the
 * open one to its suite (`src/suites/`), which loads it into its own store.
 */
interface ProjectsState {
  projects: ProjectSummary[];
  loaded: boolean;
  loadError: string | null;
  /** The open project, of any suite (its suite may still be loading it); null on the Home screen. */
  openId: string | null;
  /** The project open before the Home screen was shown (⇧⌘H goes back to it). */
  lastOpenId: string | null;
  /** Each suite's starting point, if it has one: new projects start as a copy of it. */
  templates: ProjectTemplates;
  /** Where new projects are saved. */
  location: ProjectLocation | null;

  /** Load the list and open the project from the URL (or show the Home screen). */
  init: () => Promise<void>;
  /** Read the list again (the Home screen, shown or back in front: packages may have moved in Finder meanwhile). */
  refresh: () => Promise<void>;
  open: (projectId: string) => Promise<void>;
  /** Close the open project and show the Home screen. */
  goHome: () => Promise<void>;
  /** The Home screen and back to the project that was open. */
  toggleHome: () => Promise<void>;
  /**
   * Create a new project of a suite (video by default), from its starting point unless `blank`, open it,
   * and optionally import files into it.
   */
  create: (options?: { suite?: SuiteId; files?: File[]; blank?: boolean }) => Promise<void>;
  /** Open a package from anywhere on this computer (its folder, or a file in it). */
  openFile: (path: string) => Promise<void>;
  /**
   * Pick a package to open: the system's dialog in the desktop app (starting in `folder`, else where new
   * projects go), else `fallback` (a browser asks for a path).
   */
  chooseAndOpen: (fallback?: () => void, folder?: string) => Promise<void>;
  /** Rename a project (and its package, once it's closed). */
  rename: (projectId: string, name: string) => Promise<void>;
  /** Show a project's package in Finder. */
  reveal: (projectId: string) => Promise<void>;
  /** Make (a copy of) a project what new projects of its suite start as. */
  saveTemplate: (projectId: string) => Promise<void>;
  /** New projects of the suite start blank again. */
  clearTemplate: (suite: SuiteId) => Promise<void>;
  /** Copy a project (and its media) into a new one beside it. */
  duplicate: (projectId: string) => Promise<void>;
  /** Remove a project from the recents; its package stays where it is. */
  forget: (projectId: string) => Promise<void>;
  /** Put a project's package in the Trash. */
  remove: (projectId: string) => Promise<void>;
  /** Save new projects in another folder. */
  setLocation: (path: string) => Promise<boolean>;
  /** A project's summary changed (e.g. a suite renamed it). */
  setSummary: (summary: ProjectSummary) => void;
  /** Save every suite's unsaved changes now (before the app quits). */
  flush: () => Promise<void>;
}

/** When a project was last touched here: opened or saved. */
export const lastTouched = (p: ProjectSummary) => Math.max(p.openedAt, p.updatedAt);

/** The recents, the latest first. */
export function recentProjects(projects: readonly ProjectSummary[]): ProjectSummary[] {
  return [...projects].sort((a, b) => lastTouched(b) - lastTouched(a));
}

/** A project's suite, if it's in the list. */
export function projectSuite(projectId: string | null): SuiteId | undefined {
  return projectId ? useProjects.getState().projects.find((p) => p.id === projectId)?.suite : undefined;
}

let initStarted = false;
/** Bumped by every open/close, so a switch that's been overtaken stops. */
let openToken = 0;
/** The suite holding a project (the open one's, or one still loading or closing), and which project. */
let loadedSuite: SuiteId | null = null;
let loadedId: string | null = null;

export const useProjects = create<ProjectsState>((set, get) => {
  const upsert = (summary: ProjectSummary) =>
    set({ projects: [summary, ...get().projects.filter((p) => p.id !== summary.id)] });
  const noun = (projectId: string) => suiteNoun(get().projects.find((p) => p.id === projectId)?.suite ?? DEFAULT_SUITE);
  const nameOf = (projectId: string) => get().projects.find((p) => p.id === projectId)?.name ?? "Project";

  /** Show `projectId` (null: the Home screen), closing the one before (its suite too, if it's another). */
  const show = async (projectId: string | null) => {
    const token = ++openToken;
    const suite = projectId ? projectSuite(projectId) : undefined;
    const previous = get().openId;
    set({ openId: projectId, ...(previous && previous !== projectId && { lastOpenId: previous }) });
    const closing = loadedId !== projectId ? loadedId : null;
    if (loadedSuite && (loadedSuite !== suite || !projectId)) {
      const closingSuite = loadedSuite;
      loadedSuite = null;
      await clientSuite(closingSuite).close();
    } else if (closing && loadedSuite) {
      // The same suite opens the next one, but this one's last edit is saved first.
      await clientSuite(loadedSuite).flush();
    }
    loadedId = projectId;
    // Closed: its package may now take the name it was given while open.
    if (closing) void api.projectClosed(closing).then(upsert, () => {});
    if (token !== openToken) return;
    if (!projectId || !suite) return;
    loadedSuite = suite;
    void api.projectOpened(projectId).then((summary) => {
      upsert(summary);
      noteOpenedProject(summary.path);
    }, () => {});
    await clientSuite(suite).open(projectId);
  };

  const failed = (what: string, err: unknown) => toast.error(what, { description: errorMessage(err) });

  return {
    projects: [],
    loaded: false,
    loadError: null,
    openId: null,
    lastOpenId: null,
    templates: {},
    location: null,

    async init() {
      if (initStarted) return;
      initStarted = true;
      try {
        const projects = await api.listProjects();
        set({ projects, loaded: true, loadError: null });
      } catch (err) {
        initStarted = false;
        set({ loadError: errorMessage(err) });
        return;
      }
      onProjectSaved(upsert);
      api.getTemplates().then(
        (templates) => set({ templates }),
        () => {}, // Without them, new projects start blank.
      );
      api.getProjectLocation().then(
        (location) => set({ location }),
        () => {},
      );
      window.addEventListener("popstate", () => {
        const id = projectIdFromUrl();
        void show(id && get().projects.some((p) => p.id === id && !p.missing) ? id : null);
      });

      const fromUrl = projectIdFromUrl();
      const initial = get().projects.some((p) => p.id === fromUrl && !p.missing) ? fromUrl : null;
      setUrlProject(initial, { replace: true });
      await show(initial);
    },

    async refresh() {
      try {
        set({ projects: await api.listProjects() });
      } catch {
        // The list as it was.
      }
    },

    async open(projectId) {
      if (get().projects.find((p) => p.id === projectId)?.missing) return;
      setUrlProject(projectId);
      await show(projectId);
    },

    async goHome() {
      if (!get().openId) return;
      setUrlProject(null);
      await show(null);
    },

    async toggleHome() {
      const { openId, lastOpenId, projects } = get();
      if (openId) return get().goHome();
      if (lastOpenId && projects.some((p) => p.id === lastOpenId && !p.missing)) await get().open(lastOpenId);
    },

    async create({ suite = DEFAULT_SUITE, files, blank } = {}) {
      let summary: ProjectSummary;
      try {
        const options = clientSuite(suite).newProjectOptions?.();
        summary = await api.createProject({ suite, ...(blank && { blank }), ...(options !== undefined && { options }) });
      } catch (err) {
        failed(`Couldn't create a new ${suiteNoun(suite)}`, err);
        return;
      }
      upsert(summary);
      await get().open(summary.id);
      const { importFiles } = clientSuite(suite);
      if (files?.length && importFiles && get().openId === summary.id) await importFiles(files);
    },

    async openFile(path) {
      let summary: ProjectSummary;
      try {
        summary = await api.openProjectFile(path);
      } catch (err) {
        failed("Couldn't open that project", err);
        return;
      }
      upsert(summary);
      await get().open(summary.id);
    },

    async chooseAndOpen(fallback, folder) {
      const chosen = chooseProjectFile(folder ?? get().location?.path);
      if (!chosen) return fallback?.();
      const path = await chosen;
      if (path) await get().openFile(path);
    },

    async rename(projectId, name) {
      const trimmed = name.trim();
      if (!trimmed || trimmed === nameOf(projectId)) return;
      try {
        upsert(await api.updateProject(projectId, { name: trimmed }));
      } catch (err) {
        failed(`Couldn't rename ${noun(projectId)}`, err);
      }
    },

    async reveal(projectId) {
      try {
        await api.revealProject(projectId);
      } catch (err) {
        failed("Couldn't show it in Finder", err);
      }
    },

    async duplicate(projectId) {
      let summary: ProjectSummary;
      try {
        // Copy the latest edits, not the last autosave.
        const suite = projectSuite(projectId);
        if (suite && get().openId === projectId) await clientSuite(suite).flush();
        summary = await api.duplicateProject(projectId);
      } catch (err) {
        failed(`Couldn't duplicate ${noun(projectId)}`, err);
        return;
      }
      upsert(summary);
      toast.success(`Duplicated as “${summary.name}”`, {
        action: { label: "Open", onClick: () => void get().open(summary.id) },
      });
    },

    async saveTemplate(projectId) {
      const suite = projectSuite(projectId);
      if (!suite) return;
      try {
        // The latest edits, not the last autosave.
        if (get().openId === projectId) await clientSuite(suite).flush();
        set({ templates: await api.saveTemplate(projectId) });
      } catch (err) {
        failed("Couldn't save the starting point", err);
        return;
      }
      toast.success(`New ${suiteNoun(suite, 2)} will start as “${get().templates[suite]?.name ?? "this"}”`, {
        description: "Change it any time; start blank from the New project picker.",
      });
    },

    async clearTemplate(suite) {
      try {
        set({ templates: await api.clearTemplate(suite) });
      } catch (err) {
        failed("Couldn't clear the starting point", err);
      }
    },

    async forget(projectId) {
      const project = get().projects.find((p) => p.id === projectId);
      if (!project) return;
      if (get().openId === projectId) await get().goHome();
      try {
        await api.forgetProject(projectId);
      } catch (err) {
        failed(`Couldn't remove ${noun(projectId)} from the recents`, err);
        return;
      }
      set({ projects: get().projects.filter((p) => p.id !== projectId) });
      if (!project.missing) {
        toast.success(`Removed “${project.name}” from the recents`, {
          description: "Its file stays where it is.",
          action: { label: "Undo", onClick: () => void api.openProjectFile(project.path).then(upsert, (err) => failed("Couldn't add it back", err)) },
        });
      }
    },

    async remove(projectId) {
      const suite = projectSuite(projectId);
      if (get().openId === projectId) await get().goHome();
      try {
        await api.deleteProject(projectId);
      } catch (err) {
        failed(`Couldn't move ${noun(projectId)} to the Trash`, err);
        return;
      }
      if (suite) clientSuite(suite).discard(projectId);
      set({ projects: get().projects.filter((p) => p.id !== projectId), lastOpenId: get().lastOpenId === projectId ? null : get().lastOpenId });
    },

    async setLocation(path) {
      try {
        set({ location: await api.setProjectLocation(path) });
        return true;
      } catch (err) {
        failed("Couldn't use that folder", err);
        return false;
      }
    },

    setSummary: upsert,

    async flush() {
      await Promise.all(SUITE_IDS.map((suite) => clientSuite(suite).flush()));
    },
  };
});
