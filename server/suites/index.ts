/**
 * Every suite's server side (see `shared/suites.ts`). Keyed by `SuiteId`, so adding a suite there
 * doesn't build until it has a backend here.
 */
import type { SuiteId } from "../../shared/suites.ts";
import { musicSuite } from "./music.ts";
import { photoSuite } from "./photo.ts";
import type { SuiteBackend } from "./suite.ts";
import { videoSuite } from "./video.ts";

export type { DocStats, SuiteAssistant, SuiteBackend } from "./suite.ts";

const BACKENDS: { [S in SuiteId]: SuiteBackend<S> } = {
  video: videoSuite,
  music: musicSuite,
  photo: photoSuite,
};

export const suiteBackend = <S extends SuiteId>(suite: S): SuiteBackend<S> => BACKENDS[suite];
