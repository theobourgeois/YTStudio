/**
 * What an assistant tool is, for every suite: its spec (name, JSON schema, kind), schema helpers,
 * and results. Each suite lists its tools in its own file (`assistant-tools.ts` for video,
 * `music/tools.ts`...); `suite-tools.ts` gathers them.
 */

export type Schema = Record<string, unknown>;

export const num = (description: string, extra: Schema = {}): Schema => ({ type: "number", description, ...extra });
export const int = (description: string, extra: Schema = {}): Schema => ({ type: "integer", description, ...extra });
export const str = (description: string, extra: Schema = {}): Schema => ({ type: "string", description, ...extra });
export const bool = (description: string): Schema => ({ type: "boolean", description });
export const oneOf = (values: readonly string[], description: string): Schema => ({ type: "string", enum: values, description });
export const arr = (items: Schema, description: string, extra: Schema = {}): Schema => ({ type: "array", items, description, ...extra });
export const obj = (properties: Record<string, Schema>, required: string[] = [], description?: string): Schema => ({
  type: "object",
  properties,
  ...(required.length && { required }),
  additionalProperties: false,
  ...(description && { description }),
});

/** What a tool does to the project, which decides how it's run and shown. */
export type ToolKind =
  /** Only reads (safe to repeat, no undo step). */
  | "look"
  /** A synchronous edit of the document: one undo step, can go in a `batch`. */
  | "edit"
  /** Anything slower or outside the document (captions, imports, the Library, export). */
  | "action";

export interface ToolSpec {
  /** Unique across every suite (`shared/suite-tools.ts` checks), so a chat step is known by its name alone. */
  name: string;
  /** Short title for people (the chat shows `describeToolCall` instead where it can). */
  title: string;
  description: string;
  inputSchema: Schema;
  kind: ToolKind;
  /** Deletes something undo can't bring back: the user confirms it in the app first. */
  destructive?: boolean;
  /** How long the tab may take (seconds); 120 by default. */
  timeout?: number;
}

export const tool = <N extends string, K extends ToolKind>(spec: ToolSpec & { name: N; kind: K }) => spec;

/** The MCP server's name: Claude Code calls its tools `mcp__editor__<tool>`. */
export const MCP_SERVER_NAME = "editor";

/** A tool's own name from what an MCP client calls it (`mcp__editor__split_clips` -> `split_clips`). */
export function bareToolName(name: string): string {
  const prefix = `mcp__${MCP_SERVER_NAME}__`;
  return name.startsWith(prefix) ? name.slice(prefix.length) : name;
}

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

/** MCP tool result content. */
export type ToolContent = { type: "text"; text: string } | { type: "image"; data: string; mimeType: string };

/** What an edit did to the document (ids of what it added and changed), for highlighting it and for the chat's summary. */
export interface ToolChanges {
  added: string[];
  changed: string[];
  removed: number;
}

export interface ToolResult {
  content: ToolContent[];
  isError?: boolean;
  /** Not sent to the model: what changed (edits). */
  changes?: ToolChanges;
}

export const textResult = (text: string, changes?: ToolChanges): ToolResult => ({
  content: [{ type: "text", text }],
  ...(changes && { changes }),
});

export const errorResult = (message: string): ToolResult => ({ content: [{ type: "text", text: message }], isError: true });
