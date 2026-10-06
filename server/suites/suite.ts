import type { SuiteDocument, SuiteId } from "../../shared/suites.ts";
import type { MediaAsset, SuiteSummaries } from "../../shared/types.ts";

/** Summary fields derived from a document (cached by the project store; refreshed on every write). */
export type DocStats<S extends SuiteId> = SuiteSummaries[S] & {
  name: string;
  duration: number;
  /** Media whose poster is the project's thumbnail. */
  coverAssetId: string | null;
};

/** What the assistant is told about a suite (`server/assistant/prompt.ts` puts it together). */
export interface SuiteAssistant {
  /** How its tools work and how to use them: sent to every MCP client, and part of the in-app assistant's prompt. */
  instructions: string;
  /** What the `<editor-context>` block at the start of each message says (e.g. "the playhead and the selection"). */
  context: string;
  /** What's different while the user looks at another project (e.g. "nothing is selected"). */
  background: string;
}

/**
 * A suite on the server: how its documents are made, validated and summarised, and what its
 * assistant is told. Documents are opaque to everything else (the project store, the routes).
 */
export interface SuiteBackend<S extends SuiteId> {
  suite: S;
  /** A new, empty document. */
  create(name: string): SuiteDocument<S>;
  /**
   * A new document (empty or a copy of the starting point) with the tab's choices for new projects
   * (`CreateProjectRequest.options`, untrusted: anything it doesn't know is ignored).
   */
  withOptions?(doc: SuiteDocument<S>, options: unknown): SuiteDocument<S>;
  /**
   * Validate and repair an untrusted document (from disk or a request) against the project's own
   * media. Throws if it's beyond repair.
   */
  normalize(doc: unknown, media: Record<string, MediaAsset>): SuiteDocument<S>;
  stats(doc: SuiteDocument<S>): DocStats<S>;
  /** The document with its media ids replaced (a duplicated project has its own copies of the media). */
  remapMedia(doc: SuiteDocument<S>, ids: ReadonlyMap<string, string>): SuiteDocument<S>;
  /**
   * Checks a document about to be saved against its package (`dir`): throws an `HttpError` to refuse it, and the
   * document on disk stays as it was (the photo suite's publication gate: never name pixels the package hasn't got).
   */
  checkSave?(doc: SuiteDocument<S>, dir: string): Promise<void>;
  /**
   * A save passed `checkSave` and is about to replace the saved document in `dir`: what the suite keeps of the one
   * replaced (the photo suite's recovery checkpoint).
   */
  keepPrevious?(dir: string): Promise<void>;
  /**
   * The check on opening (`GET /api/projects/:id`): null when the saved document can be shown as it is; otherwise
   * the document to open instead, which the platform saves, and what to tell the user (the photo suite's: pixels it
   * names are missing from the package).
   */
  check?(doc: SuiteDocument<S>, dir: string): Promise<{ doc: SuiteDocument<S>; notice: string } | null>;
  /**
   * A tab opened the project and no tab had it open: what the suite does with its package then (the photo suite
   * collects the pixels nothing saved names any more).
   */
  opened?(doc: SuiteDocument<S>, dir: string): Promise<void>;
  assistant: SuiteAssistant;
}
