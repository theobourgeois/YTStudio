/**
 * The apps of the suite. Every project belongs to one suite (chosen when it's made), which decides
 * what its document is, how it's edited and what its assistant can do. The sidebar, the URL, the
 * assistant's chats and the MCP server are the same for all of them.
 *
 * A suite is registered in four places, each keyed by `SuiteId` so TypeScript insists on all of them:
 * - here: its name for people (`SUITES`) and its document type (`SuiteDocuments`);
 * - `shared/suite-tools.ts`: the assistant's tools;
 * - `server/suites/`: creating, validating and summarising its documents, and what its assistant is told;
 * - `src/suites/`: opening a project, its workspace, and running its assistant's tools in the tab.
 *
 * The video editor came first and lives at the roots of `shared/`, `server/` and `src/`; every other
 * suite keeps its code in a folder of its own (`shared/music/`, `src/suites/music/`...).
 */
import type { SongOutline } from "./music/outline.ts";
import type { MusicProject } from "./music/types.ts";
import type { PhotoProject } from "./photo/types.ts";
import type { Project } from "./types.ts";

/** What a song's Home card draws (its playlist in miniature), kept in its summary: `SuiteSummaries` is the platform's. */
export type { SongOutline };

export type SuiteId = "video" | "music" | "photo";

/** Each suite's project document, as saved in `project.json`. */
export interface SuiteDocuments {
  video: Project;
  music: MusicProject;
  photo: PhotoProject;
}

export type SuiteDocument<S extends SuiteId = SuiteId> = SuiteDocuments[S];

/** What every suite's document has, so the project list can rename and copy any of them. */
export interface DocumentBase {
  version: number;
  name: string;
}

export interface SuiteInfo {
  id: SuiteId;
  /** The app's name ("Video", "Music"). */
  label: string;
  /** What one project is called, lower case ("video", "song"): "New song", "Couldn't settle song". */
  noun: string;
  /** One line for the New project picker. */
  description: string;
  /** What the assistant works in, for its prompt ("a video editor that works like Premiere Pro"). */
  app: string;
  /** Its packages' extension (`Summer edit.ytvid`), so Finder and Explorer open each in its own app. */
  extension: string;
}

/** In the order the New project picker lists them. */
export const SUITES: Record<SuiteId, SuiteInfo> = {
  video: {
    id: "video",
    label: "Video",
    noun: "video",
    description: "Cut clips, add effects, captions and music. Short-form first.",
    app: "a video editor that works like Premiere Pro",
    extension: ".ytvid",
  },
  music: {
    id: "music",
    label: "Music",
    noun: "song",
    description: "Make a song: tracks, instruments, plugins and a mixer.",
    app: "a music editor (a DAW that works like FL Studio)",
    extension: ".ytsng",
  },
  photo: {
    id: "photo",
    label: "Photo",
    noun: "photo",
    description: "Compose and light images: layers, transforms, light effects. Thumbnails first.",
    app: "a photo editor that works like Photoshop",
    extension: ".ytimg",
  },
};

export const SUITE_IDS = Object.keys(SUITES) as SuiteId[];

/** A new project's name, in every suite, until it's given one. */
export const DEFAULT_PROJECT_NAME = "Untitled";

/** Projects made before there were suites are videos. */
export const DEFAULT_SUITE: SuiteId = "video";

export const isSuiteId = (v: unknown): v is SuiteId => typeof v === "string" && Object.hasOwn(SUITES, v);

export const suiteInfo = (id: SuiteId): SuiteInfo => SUITES[id];

/** "video"/"videos", "song"/"songs". */
export const suiteNoun = (id: SuiteId, count = 1): string => `${SUITES[id].noun}${count === 1 ? "" : "s"}`;
