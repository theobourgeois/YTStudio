#!/usr/bin/env node
/**
 * A stand-in for Codex's CLI in the e2e tests (`CODEX_PATH`): answers
 * `--version` and `login status`, and as `app-server` speaks enough of its
 * JSON-RPC protocol (model/list, threads, turns, interrupts) to act out the
 * tool calls a message asks for, through the editor's real MCP server.
 *
 * Message lines work like e2e/fake-claude.mjs's (`call <tool> <json>`, "$clip",
 * "$media", `wait`), plus `sleep <ms>`. The answer names the model (and thinking level) it ran on.
 */
import { randomUUID } from "node:crypto";
import readline from "node:readline";

const args = process.argv.slice(2);
if (args.includes("--version")) {
  console.log("codex-cli 9.9.9");
  process.exit(0);
}
if (args[0] === "login") {
  console.log("Logged in using ChatGPT");
  process.exit(0);
}

const config = args.flatMap((a, i) => (args[i - 1] === "-c" ? [a] : []));
const url = JSON.parse(config.find((c) => c.startsWith("mcp_servers.editor.url="))?.split("=").slice(1).join("=") ?? '""');

const write = (message) => process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`);
const notify = (method, params) => write({ method, params });

const MODELS = [
  { id: "gpt-6-astra", model: "gpt-6-astra", displayName: "GPT-6-Astra", description: "Frontier intelligence.", hidden: false, isDefault: true, defaultReasoningEffort: "low" },
  {
    id: "gpt-6-sol",
    model: "gpt-6-sol",
    displayName: "GPT-6-Sol",
    description: "Workhorse model.",
    hidden: false,
    isDefault: false,
    supportedReasoningEfforts: ["low", "medium", "high", "xhigh", "max", "ultra"].map((reasoningEffort) => ({ reasoningEffort, description: "" })),
    defaultReasoningEffort: "medium",
  },
  { id: "gpt-5.5", model: "gpt-5.5", displayName: "GPT-5.5", description: "Legacy coding model.", hidden: false, isDefault: false },
];

let rpcId = 0;
async function callTool(name, input, callId) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method: "tools/call", params: { name, arguments: input, _meta: { callId } } }),
  });
  const body = await res.json();
  return body.result ?? { content: [{ type: "text", text: body.error?.message ?? "error" }], isError: true };
}

const seen = { clip: null, media: null };
let interrupt = null;
const pause = (ms) =>
  new Promise((resolve) => {
    const timer = ms === null ? null : setTimeout(() => resolve(false), ms);
    interrupt = () => {
      clearTimeout(timer);
      resolve(true);
    };
  });

async function turn(threadId, turnId, text, model, effort) {
  notify("turn/started", { threadId, turn: { id: turnId, status: "inProgress" } });
  const said = [];
  for (const line of text.split("\n").map((l) => l.trim())) {
    const sleep = /^sleep (\d+)$/.exec(line);
    if (line === "wait" || sleep) {
      if (await pause(sleep ? Number(sleep[1]) : null)) {
        notify("turn/completed", { threadId, turn: { id: turnId, status: "interrupted", error: null } });
        return;
      }
      continue;
    }
    const m = /^call (\w+)\s*(.*)$/.exec(line);
    if (!m) continue;
    const input = JSON.parse((m[2] || "{}").replaceAll('"$clip"', JSON.stringify(seen.clip)).replaceAll('"$media"', JSON.stringify(seen.media)));
    const item = { type: "mcpToolCall", id: `exec-${randomUUID()}`, server: "editor", tool: m[1], arguments: input, status: "inProgress", result: null, error: null };
    notify("item/started", { threadId, turnId, item });
    const result = await callTool(m[1], input, item.id);
    const out = result.content.filter((c) => c.type === "text").map((c) => c.text).join("\n");
    seen.clip ??= /clip_[0-9a-f]{12}/.exec(out)?.[0] ?? null;
    seen.media ??= /media_[0-9a-f]{12}/.exec(out)?.[0] ?? null;
    notify("item/completed", { threadId, turnId, item: { ...item, status: result.isError ? "failed" : "completed", result: { content: result.content } } });
    said.push(`${m[1]}: ${result.isError ? "failed" : "ok"}`);
  }
  const on = `${model}${effort ? ` at ${effort}` : ""}`;
  const reply = said.length ? `Done on ${on}. **${said.join(", ")}**` : `Hello from the fake Codex on ${on}.`;
  const itemId = `msg_${randomUUID()}`;
  notify("item/started", { threadId, turnId, item: { type: "agentMessage", id: itemId, text: "" } });
  for (const [i, word] of reply.split(" ").entries()) notify("item/agentMessage/delta", { threadId, turnId, itemId, delta: i ? ` ${word}` : word });
  notify("item/completed", { threadId, turnId, item: { type: "agentMessage", id: itemId, text: reply } });
  notify("turn/completed", { threadId, turn: { id: turnId, status: "completed", error: null } });
}

let model = "gpt-6-astra";
let queue = Promise.resolve();
readline.createInterface({ input: process.stdin }).on("line", (line) => {
  const msg = JSON.parse(line);
  if (msg.id === undefined || !msg.method) return;
  const reply = (result) => write({ id: msg.id, result });
  const params = msg.params ?? {};
  switch (msg.method) {
    case "initialize":
      return reply({ userAgent: "fake-codex" });
    case "model/list":
      return reply({ data: MODELS, nextCursor: null });
    case "thread/start":
    case "thread/resume": {
      model = params.model ?? model;
      const id = params.threadId ?? randomUUID();
      reply({ thread: { id }, model });
      return notify("thread/started", { thread: { id } });
    }
    case "turn/start": {
      model = params.model ?? model;
      const turnId = randomUUID();
      reply({ turn: { id: turnId, status: "inProgress" } });
      const text = params.input.map((i) => i.text ?? "").join("");
      queue = queue.then(() => turn(params.threadId, turnId, text, model, params.effort ?? null));
      return;
    }
    case "turn/interrupt":
      interrupt?.();
      interrupt = null;
      return reply({});
    default:
      return write({ id: msg.id, error: { code: -32601, message: `Not faked: ${msg.method}` } });
  }
});
