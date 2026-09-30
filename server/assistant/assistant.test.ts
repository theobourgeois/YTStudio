import http from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ChatEvent } from "../../shared/assistant.ts";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { FFMPEG } from "../config.ts";
import { analyseMusic, parseSceneLog, parseSoundLog } from "../media-analysis.ts";
import { run } from "../process.ts";
import { parseResult } from "./bridge.ts";
import { TurnTranslator, claudeArgs } from "./claude.ts";
import { CodexTranslator, codexArgs, configuredMcpServers, parseModelList } from "./codex.ts";
import { type McpCall, handleRpc, mcpHandler } from "./mcp.ts";

const calls: McpCall[] = [];
const opts = {
  version: "1",
  suiteFor: (query: Record<string, string>) => (query.suite === "music" ? ("music" as const) : ("video" as const)),
  instructions: (suite: string) => (suite === "music" ? "Use the music tools." : "Use the tools."),
  callTool: async (call: McpCall) => {
    calls.push(call);
    return { content: [{ type: "text" as const, text: `ran ${call.name}` }], changes: { added: [], changed: [], removed: 0 } };
  },
};

describe("MCP server", () => {
  it("initializes with a version it knows, and instructions", async () => {
    const res = await handleRpc({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } }, opts, {});
    expect(res).toMatchObject({ id: 1, result: { protocolVersion: "2025-06-18", instructions: "Use the tools.", capabilities: { tools: {} } } });
    const newer = await handleRpc({ jsonrpc: "2.0", id: 2, method: "initialize", params: { protocolVersion: "2099-01-01" } }, opts, {});
    expect(newer).toMatchObject({ result: { protocolVersion: "2025-11-25" } });
  });

  it("lists tools with annotations and runs calls (without the changes)", async () => {
    const list = (await handleRpc({ jsonrpc: "2.0", id: 1, method: "tools/list" }, opts, {})) as { result: { tools: { name: string; annotations: object }[] } };
    expect(list.result.tools.find((t) => t.name === "get_timeline")?.annotations).toMatchObject({ readOnlyHint: true });
    expect(list.result.tools.find((t) => t.name === "delete_media")?.annotations).toMatchObject({ destructiveHint: true });

    const res = await handleRpc(
      { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "split_clips", arguments: { at: 1 }, _meta: { "claudecode/toolUseId": "toolu_1" } } },
      opts,
      { chat: "project_000000000001" },
    );
    expect(res).toEqual({ jsonrpc: "2.0", id: 3, result: { content: [{ type: "text", text: "ran split_clips" }] } });
    expect(calls.at(-1)).toEqual({ name: "split_clips", input: { at: 1 }, toolUseId: "toolu_1" });
    // Codex names its calls differently.
    await handleRpc({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "get_timeline", arguments: {}, _meta: { callId: "exec-1" } } }, opts, {});
    expect(calls.at(-1)).toEqual({ name: "get_timeline", input: {}, toolUseId: "exec-1" });
  });

  it("lists and runs only the suite's tools", async () => {
    const init = await handleRpc({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }, opts, { suite: "music" });
    expect(init).toMatchObject({ result: { instructions: "Use the music tools." } });
    const list = (await handleRpc({ jsonrpc: "2.0", id: 2, method: "tools/list" }, opts, { suite: "music" })) as { result: { tools: { name: string }[] } };
    expect(list.result.tools.map((t) => t.name)).toContain("get_song");
    expect(list.result.tools.map((t) => t.name)).not.toContain("split_clips");
    const call = { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "split_clips", arguments: {} } };
    expect(await handleRpc(call, opts, { suite: "music" })).toMatchObject({ error: { code: -32602 } });
  });

  it("answers errors the JSON-RPC way, and notifications not at all", async () => {
    expect(await handleRpc({ jsonrpc: "2.0", method: "notifications/initialized" }, opts, {})).toBeNull();
    expect(await handleRpc({ jsonrpc: "2.0", id: 4, method: "server/discover" }, opts, {})).toMatchObject({ error: { code: -32601 } });
    expect(await handleRpc({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "nope" } }, opts, {})).toMatchObject({ error: { code: -32602 } });
    expect(await handleRpc({ id: 6 }, opts, {})).toMatchObject({ id: 6, error: { code: -32600 } });
  });

  describe("over HTTP", () => {
    let server: http.Server;
    let url: string;
    beforeAll(async () => {
      const app = express();
      app.all("/mcp", express.json(), mcpHandler(opts));
      server = http.createServer(app);
      await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
      url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`;
    });
    afterAll(() => new Promise<void>((r) => server.close(() => r())));

    const post = (body: unknown, headers: Record<string, string> = {}) =>
      fetch(url, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });

    it("handles batches and notifications", async () => {
      const res = await post([{ jsonrpc: "2.0", id: 1, method: "ping" }, { jsonrpc: "2.0", method: "notifications/initialized" }]);
      expect(await res.json()).toEqual([{ jsonrpc: "2.0", id: 1, result: {} }]);
      expect((await post({ jsonrpc: "2.0", method: "notifications/initialized" })).status).toBe(202);
    });

    it("refuses web pages and GET", async () => {
      expect((await post({ jsonrpc: "2.0", id: 1, method: "ping" }, { Origin: "https://evil.example" })).status).toBe(403);
      expect((await post({ jsonrpc: "2.0", id: 1, method: "ping" }, { Origin: "http://localhost:5310" })).status).toBe(200);
      expect((await fetch(url)).status).toBe(405);
    });
  });
});

describe("bridge results", () => {
  it("keeps valid text, pictures and changes from a tab", () => {
    expect(
      parseResult({
        content: [{ type: "text", text: "hi" }, { type: "image", data: "abc", mimeType: "image/jpeg" }, { type: "image", data: "x", mimeType: "text/html" }, 42],
        isError: true,
        changes: { added: ["a", 3], changed: [], removed: 2.4 },
      }),
    ).toEqual({
      content: [{ type: "text", text: "hi" }, { type: "image", data: "abc", mimeType: "image/jpeg" }],
      isError: true,
      changes: { added: ["a"], changed: [], removed: 2 },
    });
    expect(() => parseResult({})).toThrow();
  });
});

describe("Claude Code", () => {
  it("runs with only the editor's tools", () => {
    const args = claudeArgs({ mcpUrl: "http://127.0.0.1:5311/mcp?chat=x", systemPrompt: "Be helpful.", model: "claude-sonnet-5-5", resume: "s1" });
    expect(args).toEqual(
      expect.arrayContaining(["-p", "--strict-mcp-config", "--tools", "", "--allowedTools", "mcp__editor", "--model", "claude-sonnet-5-5", "--resume", "s1"]),
    );
    expect(JSON.parse(args[args.indexOf("--mcp-config") + 1])).toEqual({ mcpServers: { editor: { type: "http", url: "http://127.0.0.1:5311/mcp?chat=x" } } });
    expect(claudeArgs({ mcpUrl: "u", systemPrompt: "p", model: "claude-opus-5-5", resume: null })).not.toContain("--resume");
    expect(claudeArgs({ mcpUrl: "u", systemPrompt: "p", model: "claude-opus-5-5", effort: "xhigh", resume: null })).toEqual(
      expect.arrayContaining(["--effort", "xhigh"]),
    );
    expect(claudeArgs({ mcpUrl: "u", systemPrompt: "p", model: "claude-opus-5-5", effort: null, resume: null })).not.toContain("--effort");
  });

  it("turns its stream-json output into chat events", () => {
    const t = new TurnTranslator("a1");
    const events: ChatEvent[] = [];
    const feed = (line: unknown) => {
      const out = t.handle(line);
      events.push(...out.events);
      return out.result;
    };
    feed({ type: "system", subtype: "init", session_id: "s1" });
    feed({ type: "stream_event", event: { type: "message_start", message: { id: "m1" } } });
    feed({ type: "stream_event", event: { type: "content_block_start", index: 0, content_block: { type: "thinking" } } });
    feed({ type: "stream_event", event: { type: "content_block_stop", index: 0 } });
    feed({ type: "stream_event", event: { type: "content_block_start", index: 1, content_block: { type: "tool_use", id: "t1", name: "mcp__editor__get_timeline" } } });
    feed({ type: "assistant", message: { id: "m1", content: [{ type: "tool_use", id: "t1", name: "mcp__editor__get_timeline", input: { captions: true } }] } });
    feed({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t1", content: [{ type: "text", text: "tracks" }, { type: "text", text: "[Image: source: x.png]" }] }] } });
    feed({ type: "stream_event", event: { type: "message_start", message: { id: "m2" } } });
    feed({ type: "stream_event", event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "All " } } });
    feed({ type: "stream_event", event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "done." } } });
    // The complete copy of streamed text is skipped.
    feed({ type: "assistant", message: { id: "m2", content: [{ type: "text", text: "All done." }] } });
    const result = feed({ type: "result", subtype: "success", is_error: false });

    expect(t.sessionId).toBe("s1");
    expect(result).toEqual({ isError: false });
    expect(events).toEqual([
      { type: "thinking", messageId: "a1", key: "m1:0", done: false },
      { type: "thinking", messageId: "a1", key: "m1:0", done: true },
      { type: "tool_start", messageId: "a1", id: "t1", name: "get_timeline", input: {} },
      { type: "tool_start", messageId: "a1", id: "t1", name: "get_timeline", input: { captions: true } },
      { type: "tool_end", id: "t1", status: "done", output: "tracks" },
      { type: "text_delta", messageId: "a1", key: "m2:0", text: "All " },
      { type: "text_delta", messageId: "a1", key: "m2:0", text: "done." },
    ]);
  });

  it("explains a failed turn, and a usage limit", () => {
    const t = new TurnTranslator("a1");
    expect(t.handle({ type: "result", subtype: "error_during_execution", is_error: true, errors: ["Boom"] }).result).toEqual({ isError: true, error: "Boom" });
    t.handle({ type: "rate_limit_event", rate_limit_info: { status: "rejected" } });
    expect(t.handle({ type: "result", subtype: "success", is_error: true, result: "limit" }).result?.error).toMatch(/usage limit/);
  });
});

describe("Codex", () => {
  it("runs with only the editor's tools, the user's other MCP servers off", () => {
    const args = codexArgs({ mcpUrl: "http://127.0.0.1:5311/mcp?chat=x", disabledServers: ["pencil", "my server"] });
    expect(args[0]).toBe("app-server");
    const config = args.filter((_, i) => args[i - 1] === "-c");
    expect(config).toEqual(
      expect.arrayContaining([
        'mcp_servers.editor.url="http://127.0.0.1:5311/mcp?chat=x"',
        'mcp_servers.editor.default_tools_approval_mode="approve"',
        "mcp_servers.pencil.enabled=false",
        'mcp_servers."my server".enabled=false',
        'web_search="disabled"',
        "features.shell_tool=false",
        "features.unified_exec=false",
      ]),
    );
  });

  it("finds the MCP servers in a config.toml", () => {
    const toml = '[mcp_servers.pencil]\ncommand = "x"\n[mcp_servers."a b".env]\nK = "v"\n[tui]\n[projects."/x"]\n';
    expect(configuredMcpServers(toml)).toEqual(["pencil", "a b"]);
  });

  it("turns app-server notifications into chat events", () => {
    const t = new CodexTranslator("a1");
    const events: ChatEvent[] = [];
    const feed = (method: string, params: Record<string, unknown>) => {
      const out = t.handle(method, params);
      events.push(...out.events);
      return out.result;
    };
    feed("item/started", { item: { type: "userMessage", id: "u" } });
    feed("item/started", { item: { type: "reasoning", id: "r1" } });
    feed("item/completed", { item: { type: "reasoning", id: "r1" } });
    feed("item/started", { item: { type: "mcpToolCall", id: "c1", server: "editor", tool: "get_timeline", arguments: { captions: true }, status: "inProgress" } });
    feed("item/completed", { item: { type: "mcpToolCall", id: "c1", server: "editor", tool: "get_timeline", status: "completed", result: { content: [{ type: "text", text: "tracks" }] } } });
    feed("item/started", { item: { type: "mcpToolCall", id: "c2", server: "pencil", tool: "draw", arguments: {} } });
    feed("item/completed", { item: { type: "mcpToolCall", id: "c3", server: "editor", tool: "split_clips", status: "failed", result: null, error: { message: "Nope" } } });
    feed("item/agentMessage/delta", { itemId: "m1", delta: "All " });
    feed("item/agentMessage/delta", { itemId: "m1", delta: "done." });
    feed("item/completed", { item: { type: "agentMessage", id: "m1", text: "All done." } });
    const result = feed("turn/completed", { turn: { id: "t1", status: "completed", error: null } });

    expect(result).toEqual({ isError: false });
    expect(events).toEqual([
      { type: "thinking", messageId: "a1", key: "r1", done: false },
      { type: "thinking", messageId: "a1", key: "r1", done: true },
      { type: "tool_start", messageId: "a1", id: "c1", name: "get_timeline", input: { captions: true } },
      { type: "tool_end", id: "c1", status: "done", output: "tracks" },
      { type: "tool_end", id: "c3", status: "error", output: "Nope" },
      { type: "text_delta", messageId: "a1", key: "m1", text: "All " },
      { type: "text_delta", messageId: "a1", key: "m1", text: "done." },
      { type: "text", messageId: "a1", key: "m1", text: "All done." },
    ]);
  });

  it("explains a failed or stopped turn, and a usage limit", () => {
    const t = new CodexTranslator("a1");
    t.handle("error", { error: { message: "Reconnecting" }, willRetry: true });
    t.handle("error", { error: { message: "Model not found" }, willRetry: false });
    expect(t.handle("turn/completed", { turn: { status: "failed", error: null } }).result).toEqual({ isError: true, error: "Model not found" });
    expect(t.handle("turn/completed", { turn: { status: "interrupted" } }).result).toEqual({ isError: true, error: "Stopped." });
    t.handle("account/rateLimits/updated", { rateLimits: { rateLimitReachedType: "rate_limit_reached", primary: { resetsAt: 1790716066 } } });
    expect(t.handle("turn/completed", { turn: { status: "failed", error: { message: "429" } } }).result?.error).toMatch(/Codex usage limit until/);
  });

  it("reads its model list: default first, hidden ones out, older ones as legacy", () => {
    expect(
      parseModelList([
        { model: "gpt-5.5", displayName: "GPT-5.5", description: "Legacy coding model.", hidden: false },
        { model: "gpt-6-sol", displayName: "GPT-6-Sol", description: "Workhorse model.", hidden: false },
        {
          model: "gpt-6-astra",
          displayName: "GPT-6-Astra",
          description: "Frontier.",
          hidden: false,
          isDefault: true,
          supportedReasoningEfforts: [{ reasoningEffort: "low" }, { reasoningEffort: "ultra" }],
          defaultReasoningEffort: "low",
        },
        { model: "secret", displayName: "Secret", hidden: true },
      ]),
    ).toEqual([
      { id: "gpt-6-astra", label: "GPT-6-Astra", hint: "Frontier.", efforts: ["low", "ultra"], defaultEffort: "low" },
      { id: "gpt-6-sol", label: "GPT-6-Sol", hint: "Workhorse model." },
      { id: "gpt-5.5", label: "GPT-5.5", hint: "Legacy coding model.", legacy: true },
    ]);
    expect(parseModelList("nope")).toBeNull();
  });
});

describe("media analysis", () => {
  it("reads silences and loudness, from where decoding started", () => {
    const log = [
      "[silencedetect @ 0x1] silence_start: 1.5",
      "[silencedetect @ 0x1] silence_end: 2.25 | silence_duration: 0.75",
      "[silencedetect @ 0x1] silence_start: 9",
      "[Parsed_volumedetect_1 @ 0x2] mean_volume: -21.3 dB",
      "[Parsed_volumedetect_1 @ 0x2] max_volume: -1.5 dB",
    ].join("\n");
    expect(parseSoundLog(log, 10, 20)).toEqual({
      silences: [
        { start: 11.5, end: 12.25 },
        { start: 19, end: 20 },
      ],
      meanVolume: -21.3,
      maxVolume: -1.5,
    });
    expect(parseSoundLog("mean_volume: -inf dB", 0, 1)).toEqual({ silences: [], meanVolume: null, maxVolume: null });
  });

  it("reads shot changes", () => {
    const log = "[Parsed_showinfo_2 @ 0x1] n:   0 pts:  98304 pts_time:3.2 duration: 512\nframe=  10\n[Parsed_showinfo_2 @ 0x1] n:   1 pts: 1 pts_time:7.8333";
    expect(parseSceneLog(log)).toEqual([3.2, 7.833]);
  });

  it("finds the beat of a file, in its source times", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "music-"));
    const file = path.join(dir, "kick.wav");
    // A kick every half second (120 BPM) for 12 s.
    const kick = "0.6*sin(2*PI*60*mod(t,0.5))*exp(-15*mod(t,0.5))";
    await run(FFMPEG, ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", `aevalsrc=exprs='${kick}':sample_rate=44100:duration=12`, file]);
    try {
      const music = await analyseMusic(file, 2, 10);
      expect(Math.abs((music.bpm ?? 0) - 120)).toBeLessThan(1.5);
      expect(music.beats[0]).toBeGreaterThanOrEqual(2);
      for (const t of music.beats) expect(Math.abs(t * 2 - Math.round(t * 2))).toBeLessThan(0.04);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
