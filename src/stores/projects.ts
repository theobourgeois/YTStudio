import { create } from "zustand";
import { toast } from "sonner";
import { DEFAULT_SUITE, SUITE_IDS, type SuiteId, suiteNoun } from "@shared/suites";
import type { ProjectStatus, ProjectSummary } from "@shared/types";
import { errorMessage } from "@shared/errors";
import { api } from "@/lib/api";
import { projectIdFromUrl, setUrlProject } from "@/lib/route";
import { clientSuite } from "@/suites";
import { onProjectSaved } from "./autosave";

/**
 * The workspace: every project (a video, a song... see `shared/suites.ts`) is either `active` (being
 * worked on) or `settled` (done and put away). This store says which one is open (the URL tracks
 * it) and hands it to its suite (`src/suites/`), which loads it into its own store.
 */
interface ProjectsState {
  projects: ProjectSummary[];
  loaded: boolean;
  loadError: string | null;
  /** The open project, of any suite (its suite may still be loading it). */
  openId: string | null;

  /** Load the list and open the project from the URL (or the most recent active one). */
  init: () => Promise<void>;
  open: (projectId: string) => Promise<void>;
  /** Create a new project of a suite (video by default), open it, and optionally import files into it. */
  create: (options?: { suite?: SuiteId; files?: File[] }) => Promise<void>;
  settle: (projectId: string) => Promise<void>;
  unsettle: (projectId: string) => Promise<void>;
  /** Copy a project (and its media) into a new active one. */
  duplicate: (projectId: string) => Promise<void>;
  remove: (projectId: string) => Promise<void>;
  /** A project's summary changed (e.g. a suite renamed it). */
  setSummary: (summary: ProjectSummary) => void;
  /** Save every suite's unsaved changes now (before the app quits). */
  flush: () => Promise<void>;
}

const byRecent = (a: ProjectSummary, b: ProjectSummary) => b.updatedAt - a.updatedAt;
const bySettled = (a: ProjectSummary, b: ProjectSummary) => (b.settledAt ?? 0) - (a.settledAt ?? 0);

export function activeProjects(projects: ProjectSummary[]) {
  return projects.filter((p) => p.status === "active").sort(byRecent);
}

export function settledProjects(projects: ProjectSummary[]) {
  return projects.filter((p) => p.status === "settled").sort(bySettled);
}

/** A project's suite, if it's in the list. */
export function projectSuite(projectId: string | null): SuiteId | undefined {
  return projectId ? useProjects.getState().projects.find((p) => p.id === projectId)?.suite : undefined;
}

let initStarted = false;
/** Bumped by every open/close, so a switch that's been overtaken stops. */
let openToken = 0;
/** The suite holding a project (the open one's, or one still loading or closing). */
let loadedSuite: SuiteId | null = null;

export const useProjects = create<ProjectsState>((set, get) => {
  const upsert = (summary: ProjectSummary) =>
    set({ projects: [summary, ...get().projects.filter((p) => p.id !== summary.id)] });
  const noun = (projectId: string) => suiteNoun(get().projects.find((p) => p.id === projectId)?.suite ?? DEFAULT_SUITE);

  /** Show `projectId` (null: nothing), closing the suite that had the last one if it's another. */
  const show = async (projectId: string | null) => {
    const token = ++openToken;
    const suite = projectId ? projectSuite(projectId) : undefined;
    set({ openId: projectId });
    if (loadedSuite && loadedSuite !== suite) {
      const closing = loadedSuite;
      loadedSuite = null;
      await clientSuite(closing).close();
      if (token !== openToken) return;
    }
    if (!projectId || !suite) return;
    loadedSuite = suite;
    await clientSuite(suite).open(projectId);
  };

  /** Open the most recent active project other than `exceptId`, or show the empty state. */
  const openNext = async (exceptId: string) => {
    const next = activeProjects(get().projects).find((p) => p.id !== exceptId);
    if (next) await get().open(next.id);
    else {
      setUrlProject(null);
      await show(null);
    }
  };

  const setStatus = async (projectId: string, status: ProjectStatus) => {
    try {
      upsert(await api.updateProject(projectId, { status }));
    } catch (err) {
      toast.error(`Couldn't ${status === "settled" ? "settle" : "unsettle"} ${noun(projectId)}`, {
        description: errorMessage(err),
      });
      return false;
    }
    return true;
  };

  return {
    projects: [],
    loaded: false,
    loadError: null,
    openId: null,

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
      window.addEventListener("popstate", () => {
        const id = projectIdFromUrl();
        void show(id && get().projects.some((p) => p.id === id) ? id : null);
      });

      const fromUrl = projectIdFromUrl();
      const initial = get().projects.some((p) => p.id === fromUrl)
        ? fromUrl
        : (activeProjects(get().projects)[0]?.id ?? null);
      setUrlProject(initial, { replace: true });
      await show(initial);
    },

    async open(projectId) {
      setUrlProject(projectId);
      await show(projectId);
    },

    async create({ suite = DEFAULT_SUITE, files } = {}) {
      let summary: ProjectSummary;
      try {
        summary = await api.createProject({ suite });
      } catch (err) {
        toast.error(`Couldn't create a new ${suiteNoun(suite)}`, { description: errorMessage(err) });
        return;
      }
      upsert(summary);
      await get().open(summary.id);
      const { importFiles } = clientSuite(suite);
      if (files?.length && importFiles && get().openId === summary.id) await importFiles(files);
    },

    async settle(projectId) {
      if (!(await setStatus(projectId, "settled"))) return;
      const wasOpen = get().openId === projectId;
      const name = get().projects.find((p) => p.id === projectId)?.name ?? "Project";
      toast.success(`Settled “${name}”`, {
        action: {
          label: "Undo",
          onClick: () => {
            void get().unsettle(projectId);
            if (wasOpen) void get().open(projectId);
          },
        },
      });
      if (wasOpen) await openNext(projectId);
    },

    async unsettle(projectId) {
      await setStatus(projectId, "active");
    },

    async duplicate(projectId) {
      let summary: ProjectSummary;
      try {
        // Copy the latest edits, not the last autosave.
        const suite = projectSuite(projectId);
        if (suite && get().openId === projectId) await clientSuite(suite).flush();
        summary = await api.duplicateProject(projectId);
      } catch (err) {
        toast.error(`Couldn't duplicate ${noun(projectId)}`, { description: errorMessage(err) });
        return;
      }
      upsert(summary);
      toast.success(`Duplicated as “${summary.name}”`, {
        action: { label: "Open", onClick: () => void get().open(summary.id) },
      });
    },

    async remove(projectId) {
      const suite = projectSuite(projectId);
      try {
        await api.deleteProject(projectId);
      } catch (err) {
        toast.error(`Couldn't delete ${noun(projectId)}`, { description: errorMessage(err) });
        return;
      }
      if (suite) clientSuite(suite).discard(projectId);
      const wasOpen = get().openId === projectId;
      set({ projects: get().projects.filter((p) => p.id !== projectId) });
      if (wasOpen) await openNext(projectId);
    },

    setSummary: upsert,

    async flush() {
      await Promise.all(SUITE_IDS.map((suite) => clientSuite(suite).flush()));
    },
  };
});
