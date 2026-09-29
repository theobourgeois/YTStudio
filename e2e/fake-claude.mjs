#!/usr/bin/env node
/**
 * A stand-in for Claude Code's CLI in the e2e tests (`CLAUDE_PATH`): answers
 * `--version` and `auth status --json`, and in `-p` stream-json mode acts out
 * the tool calls a message asks for, through the editor's real MCP server.
 *
 * Each line of a message like `call split_clips {"at": 1}` is one tool call,
 * made in order. In the JSON, "$clip" is the first clip id and "$media" the
 * first media id seen in an earlier result (call get_timeline or list_media first).
 * `wait` holds the turn until it's interrupted.
 */
import { randomUUID } from "node:crypto";
import readline from "node:readline";

const args = process.argv.slice(2);
if (args.includes("--version")) {
  console.log("9.9.9 (Claude Code)");
  process.exit(0);
}
if (args[0] === "auth") {
  console.log(JSON.stringify({ loggedIn: true, authMethod: "claude.ai", subscriptionType: "max" }));
  process.exit(0);
}

const config = JSON.parse(args[args.indexOf("--mcp-config") + 1]);
const url = Object.values(config.mcpServers)[0].url;
const sessionId = args.includes("--resume") ? args[args.indexOf("--resume") + 1] : randomUUID();
const emit = (message) => process.stdout.write(`${JSON.stringify({ ...message, session_id: sessionId })}\n`);

let rpcId = 0;
async function callTool(name, input, toolUseId) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method: "tools/call", params: { name, arguments: input, _meta: { "claudecode/toolUseId": toolUseId } } }),
  });
  const body = await res.json();
  return body.result ?? { content: [{ type: "text", text: body.error?.message ?? "error" }], isError: true };
}

let interrupted = null;
const seen = { clip: null, media: null };

async function turn(text) {
  emit({ type: "system", subtype: "init", tools: [], mcp_servers: [{ name: "editor", status: "connected" }] });
  const messageId = `msg_${randomUUID()}`;
  const said = [];
  for (const line of text.split("\n").map((l) => l.trim())) {
    if (line === "wait") {
      await new Promise((resolve) => (interrupted = resolve));
      emit({ type: "result", subtype: "error_during_execution", is_error: true });
      return;
    }
    const m = /^call (\w+)\s*(.*)$/.exec(line);
    if (!m) continue;
    const input = JSON.parse((m[2] || "{}").replaceAll('"$clip"', JSON.stringify(seen.clip)).replaceAll('"$media"', JSON.stringify(seen.media)));
    const id = `toolu_${randomUUID().replaceAll("-", "")}`;
    emit({ type: "assistant", message: { id: messageId, role: "assistant", content: [{ type: "tool_use", id, name: `mcp__editor__${m[1]}`, input }] } });
    const result = await callTool(m[1], input, id);
    const out = result.content.filter((c) => c.type === "text").map((c) => c.text).join("\n");
    seen.clip ??= /clip_[0-9a-f]{12}/.exec(out)?.[0] ?? null;
    seen.media ??= /media_[0-9a-f]{12}/.exec(out)?.[0] ?? null;
    emit({ type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, content: result.content, is_error: !!result.isError }] } });
    said.push(`${m[1]}: ${result.isError ? "failed" : "ok"}`);
  }
  const reply = said.length ? `Done. **${said.join(", ")}** at 0:01.` : "Hello from the fake Claude.";
  emit({ type: "stream_event", event: { type: "message_start", message: { id: `${messageId}_text` } } });
  for (const [i, word] of reply.split(" ").entries()) {
    emit({ type: "stream_event", event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: i ? ` ${word}` : word } } });
  }
  emit({ type: "result", subtype: "success", is_error: false, result: reply });
}

let queue = Promise.resolve();
readline.createInterface({ input: process.stdin }).on("line", (line) => {
  const message = JSON.parse(line);
  if (message.type === "control_request" && message.request?.subtype === "interrupt") {
    emit({ type: "control_response", response: { subtype: "success", request_id: message.request_id } });
    interrupted?.();
    interrupted = null;
    return;
  }
  if (message.type !== "user") return;
  const text = message.message.content.map((c) => c.text ?? "").join("");
  queue = queue.then(() => turn(text));
});
