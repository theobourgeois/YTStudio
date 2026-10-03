/**
 * Every suite's side in the tab (see `shared/suites.ts`), keyed by `SuiteId` so a new suite doesn't
 * build until it's here. Import suites from here, never a suite's own module (they're wired up in order).
 */
import type { SuiteId } from "@shared/suites";
import type { ProjectSummary } from "@shared/types";
import { musicSuite } from "./music";
import type { ClientSuite } from "./types";
import { videoSuite } from "./video";

export type { ClientSuite, ToolRunContext } from "./types";

const CLIENT_SUITES: { [S in SuiteId]: ClientSuite<S> } = {
  video: videoSuite,
  music: musicSuite,
};

export const clientSuite = <S extends SuiteId>(suite: S): ClientSuite<S> => CLIENT_SUITES[suite];

/** The line under a project's name on the Home screen, from its suite. */
export function describeProject(project: ProjectSummary): string {
  return (CLIENT_SUITES[project.suite].describe as (p: ProjectSummary) => string)(project);
}
