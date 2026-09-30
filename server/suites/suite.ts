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
   * Validate and repair an untrusted document (from disk or a request) against the project's own
   * media. Throws if it's beyond repair.
   */
  normalize(doc: unknown, media: Record<string, MediaAsset>): SuiteDocument<S>;
  stats(doc: SuiteDocument<S>): DocStats<S>;
  /** The document with its media ids replaced (a duplicated project has its own copies of the media). */
  remapMedia(doc: SuiteDocument<S>, ids: ReadonlyMap<string, string>): SuiteDocument<S>;
  assistant: SuiteAssistant;
}
