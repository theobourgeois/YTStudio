/**
 * The editor's MCP server (Streamable HTTP, stateless): `POST /mcp` takes a
 * JSON-RPC message (or a batch) and answers with JSON. It lists the tools of
 * `shared/assistant-tools.ts` and hands every call to `callTool` (the bridge
 * to the editor tab). No server-to-client stream: `GET` is refused, which the
 * spec allows.
 *
 * Only what clients need is implemented: initialize, ping, tools/list and
 * tools/call. Other requests get "method not found" (clients then fall back,
 * e.g. from the newer `server/discover` probe to `initialize`).
 */
import type { Request, Response } from "express";
import { ASSISTANT_TOOLS, type ToolResult, errorResult, toolSpec } from "../../shared/assistant-tools.ts";
import { errorMessage } from "../../shared/errors.ts";

/** Newest first; a client asking for another gets the newest. */
const PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];

export interface McpCall {
  name: string;
  input: Record<string, unknown>;
  /** Claude Code's id for the call (`_meta["claudecode/toolUseId"]`), when it sends one. */
  toolUseId: string | null;
}

export interface McpServerOptions {
  version: string;
  /** Told to every client at initialize: how to use the tools. */
  instructions: string;
  /** Runs a call; `query` is the request's query string (which chat it's for). */
  callTool: (call: McpCall, query: Record<string, string>) => Promise<ToolResult>;
}

interface JsonRpcMessage {
  jsonrpc?: unknown;
  id?: string | number | null;
  method?: unknown;
  params?: unknown;
}

type JsonRpcResponse =
  | { jsonrpc: "2.0"; id: string | number | null; result: unknown }
  | { jsonrpc: "2.0"; id: string | number | null; error: { code: number; message: string } };

const rpcError = (id: string | number | null, code: number, message: string): JsonRpcResponse => ({
  jsonrpc: "2.0",
  id,
  error: { code, message },
});

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** Tools as MCP lists them. */
export function mcpTools() {
  return ASSISTANT_TOOLS.map((t) => ({
    name: t.name,
    title: t.title,
    description: t.description,
    inputSchema: t.inputSchema,
    annotations: {
      title: t.title,
      readOnlyHint: t.kind === "look",
      destructiveHint: "destructive" in t && t.destructive === true,
      openWorldHint: t.name === "import_media",
    },
  }));
}

/** One JSON-RPC message's response (null for notifications). */
export async function handleRpc(
  raw: unknown,
  opts: McpServerOptions,
  query: Record<string, string>,
): Promise<JsonRpcResponse | null> {
  const msg = (isObject(raw) ? raw : {}) as JsonRpcMessage;
  const id = typeof msg.id === "string" || typeof msg.id === "number" ? msg.id : null;
  if (!isObject(raw) || msg.jsonrpc !== "2.0" || typeof msg.method !== "string") return rpcError(id, -32600, "Invalid request");
  // Notifications get no response.
  if (msg.id === undefined) return null;
  const ok = (result: unknown): JsonRpcResponse => ({ jsonrpc: "2.0", id, result });
  const params = isObject(msg.params) ? msg.params : {};

  switch (msg.method) {
    case "initialize": {
      const asked = typeof params.protocolVersion === "string" ? params.protocolVersion : "";
      return ok({
        protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "editor", title: "Video editor", version: opts.version },
        instructions: opts.instructions,
      });
    }
    case "ping":
      return ok({});
    case "tools/list":
      return ok({ tools: mcpTools() });
    case "tools/call": {
      const name = typeof params.name === "string" ? params.name : "";
      if (!toolSpec(name)) return rpcError(id, -32602, `Unknown tool: ${name}`);
      const input = isObject(params.arguments) ? params.arguments : {};
      const meta = isObject(params._meta) ? params._meta : {};
      const toolUseId = typeof meta["claudecode/toolUseId"] === "string" ? meta["claudecode/toolUseId"] : null;
      let result: ToolResult;
      try {
        result = await opts.callTool({ name, input, toolUseId }, query);
      } catch (err) {
        result = errorResult(errorMessage(err));
      }
      return ok({ content: result.content, ...(result.isError && { isError: true }) });
    }
    default:
      return rpcError(id, -32601, `Method not found: ${msg.method}`);
  }
}

/** Hosts a local server may be reached at (anything else is DNS rebinding). */
function localHost(host: string | undefined): boolean {
  const name = (host ?? "").replace(/:\d+$/, "").toLowerCase();
  return name === "127.0.0.1" || name === "localhost" || name === "[::1]";
}

/** Express handler for `/mcp`. */
export function mcpHandler(opts: McpServerOptions) {
  return async (req: Request, res: Response) => {
    res.setHeader("Cache-Control", "no-store");
    // Web pages may not drive the editor: only local clients (which send no Origin, or a local one).
    const origin = req.headers.origin;
    if (!localHost(req.headers.host) || (origin && !localHost(new URL(origin, "http://x").host))) {
      res.status(403).json(rpcError(null, -32000, "Forbidden"));
      return;
    }
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      res.status(405).json(rpcError(null, -32000, "Method not allowed"));
      return;
    }
    const query = Object.fromEntries(
      Object.entries(req.query).flatMap(([k, v]) => (typeof v === "string" ? [[k, v]] : [])),
    );
    const body: unknown = req.body;
    const batch = Array.isArray(body);
    const messages: unknown[] = batch ? body : [body];
    if (messages.length === 0) {
      res.status(400).json(rpcError(null, -32600, "Empty batch"));
      return;
    }
    const responses = (await Promise.all(messages.map((m) => handleRpc(m, opts, query)))).filter(
      (r): r is JsonRpcResponse => r !== null,
    );
    if (responses.length === 0) {
      res.status(202).end();
      return;
    }
    res.json(batch ? responses : responses[0]);
  };
}
