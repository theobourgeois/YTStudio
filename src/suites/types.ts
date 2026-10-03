import type { ComponentType } from "react";
import type { IconType } from "react-icons";
import type { SuiteId } from "@shared/suites";
import type { ToolResult } from "@shared/tool-spec";
import type { SuiteProjectSummary } from "@shared/types";

/** A tool call to run in this tab (see `src/assistant/bridge.ts`). */
export interface ToolRunContext {
  /** The chat the call is for (its project's id), or null for an agent outside the app (the open project). */
  chat: string | null;
  /** The chat's assistant message it's part of. */
  turn: string | null;
  signal: AbortSignal;
  progress: (fraction: number | null, label?: string) => void;
}

/** How the assistant's panel talks about a suite's projects. The `use*` are hooks. */
export interface SuiteChat {
  /** The empty chat's pitch, after the assistant's name: "can watch your footage, … and style your video." */
  pitch: string;
  /** Ideas to start with, for an empty chat (they can depend on what's in the project). */
  useSuggestions(): string[];
  /** What the composer asks for, after the assistant's name: "edit your video". */
  ask: string;
  /** The composer's live label of what's sent with a message (see `messageContext`), and its tooltip. */
  useContextLabel(): string;
  contextHint: string;
}

/** A suite's section of Settings (`components/settings/`). */
export interface SuiteSettings {
  /** The section's name ("Video editor"). */
  title: string;
  /** One line under it, on what's there. */
  description: string;
  /**
   * Its groups of settings (`SettingsGroup` from `components/settings/settings-ui.tsx`); Settings adds where
   * new projects start from after them. Suites other than video load theirs on first use (`lazy`).
   */
  Panel: ComponentType;
}

/**
 * A suite in the tab: its store behind `open`/`close`, its workspace, and its assistant's side (the
 * context sent with each message, and the handlers of its tools). `useProjects` decides which
 * project is open and calls these; nothing else needs to know which suites exist.
 */
export interface ClientSuite<S extends SuiteId = SuiteId> {
  id: S;
  icon: IconType;
  /** Classes for its icon's tile (background and colour), on the Home screen and in the New project picker. */
  tint: string;
  /**
   * Load a project into the suite's store. `useProjects` closes the previous project's suite first, and
   * calls `open` again with another id to switch (the suite drops a load that's been overtaken).
   */
  open(projectId: string): Promise<void>;
  /** Close its project (saving it first), cancelling a load in progress. */
  close(): Promise<void>;
  /** Save what's still unsaved, now (before a project is copied or the app quits). */
  flush(): Promise<void>;
  /** Forget unsaved changes of a project that's been deleted. */
  discard(projectId: string): void;
  /**
   * The whole main column while one of its projects is open; it shows its own loading state. Suites
   * other than video load theirs on first use (`lazy`), so nobody downloads an app they don't open.
   */
  Workspace: ComponentType;
  /** Its section of Settings (⌘, opens on it while one of its projects is open). */
  settings: SuiteSettings;
  /** The line under a project's name on the Home screen. */
  describe(summary: SuiteProjectSummary<S>): string;
  /** Hook: the project's name while it's open and being edited (before it's saved), else null. */
  useLiveName(projectId: string): string | null;
  chat: SuiteChat;
  /** What the assistant is told with each message (the `<editor-context>` block) and the label under it. */
  messageContext(): { context: string; label: string } | null;
  /** Run one of the suite's assistant tools (`shared/suite-tools.ts`). Throwing is fine: it becomes an error result. */
  runTool(name: string, input: Record<string, unknown>, ctx: ToolRunContext): Promise<ToolResult>;
  /**
   * Of files dropped on the Home screen, those it starts a project with (the first suite in `SUITE_IDS` that
   * takes any gets them, put in the new project by `importFiles`).
   */
  startsWith?(files: File[]): File[];
  /** Put files dropped to start a project into the new project, for suites that take them. */
  importFiles?(files: File[]): Promise<void>;
  /** The suite's choices for a new project, kept in this browser (`CreateProjectRequest.options`: music's default tempo). */
  newProjectOptions?(): unknown;
}
