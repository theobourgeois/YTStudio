/**
 * Every suite's side in the tab (see `shared/suites.ts`), keyed by `SuiteId` so a new suite doesn't
 * build until it's here. Import suites from here, never a suite's own module (they're wired up in order).
 */
import type { ReactNode } from "react";
import type { SuiteId } from "@shared/suites";
import type { ProjectSummary } from "@shared/types";
import { musicSuite } from "./music";
import { photoSuite } from "./photo";
import type { ClientSuite } from "./types";
import { videoSuite } from "./video";

export type { ClientSuite, ToolRunContext } from "./types";

const CLIENT_SUITES: { [S in SuiteId]: ClientSuite<S> } = {
  video: videoSuite,
  music: musicSuite,
  photo: photoSuite,
};

export const clientSuite = <S extends SuiteId>(suite: S): ClientSuite<S> => CLIENT_SUITES[suite];

/** The line under a project's name on the Home screen, from its suite. */
export function describeProject(project: ProjectSummary): string {
  return (CLIENT_SUITES[project.suite].describe as (p: ProjectSummary) => string)(project);
}

/** Its Home picture's shape (width over height), from its suite. */
export function projectAspect(project: ProjectSummary): number {
  const aspect = (CLIENT_SUITES[project.suite].aspect as ((p: ProjectSummary) => number) | undefined)?.(project);
  return aspect && Number.isFinite(aspect) && aspect > 0 ? aspect : 16 / 10;
}

/** What a project's Home card draws while it has no picture (its suite's `sketch`), or null. */
export function projectSketch(project: ProjectSummary, progress: number): ReactNode {
  return (CLIENT_SUITES[project.suite].sketch as ((p: ProjectSummary, progress: number) => ReactNode) | undefined)?.(project, progress) ?? null;
}
