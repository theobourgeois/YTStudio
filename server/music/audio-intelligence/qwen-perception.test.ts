import { describe, expect, it, vi } from "vitest";
import { QwenPerception } from "./qwen-perception.ts";
import type { HearingAttempt } from "../../../shared/music/audio-intelligence/hearing.ts";
const output = { findings: [{ task: "tone", claim: "A sustained sound.", startSeconds: 0, endSeconds: 1 }], limitations: [] };
const input = () => ({ audio: new Uint8Array([1, 2, 3]), durationSeconds: 2, task: "tone" as const, question: "Describe tone", signal: new AbortController().signal, beforeSend: vi.fn(async () => {}), onAttempt: vi.fn(async (_attempt: HearingAttempt) => {}), onRaw: vi.fn(async (_raw: unknown) => {}) });
const response = (result: unknown = output, finish = "stop", done = true) => {
  const chunks = [
    { model: "qwen3.8-omni-flash", choices: [{ delta: { reasoning_content: "Reasoning excluded from observations" } }] },
    { model: "qwen3.8-omni-flash", choices: [{ delta: { content: JSON.stringify(result) }, finish_reason: finish }] },
    { choices: [], usage: { prompt_tokens: 150, completion_tokens: 90 } },
  ];
  return new Response(chunks.map(c => `data: ${JSON.stringify(c)}\r\n\r\n`).join("") + (done ? "data: [DONE]\r\n\r\n" : ""), { headers: { "content-type": "text/event-stream" } });
};
describe("Qwen streaming audio adapter", () => {
  it("uploads inline WAV and validates only final text while retaining usage and raw output", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => response());
    const request = input();
    const provider = new QwenPerception({ apiKey: "test-secret", fetch: fetcher });
    const result = await provider.perceive(request);
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe("https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions");
    expect(url).not.toContain("test-secret"); expect(init?.redirect).toBe("error");
    const body = JSON.parse(String(init?.body));
    expect(body.messages[1].content[1]).toEqual({ type: "input_audio", input_audio: { data: "data:audio/wav;base64,AQID", format: "wav" } });
    expect(body.modalities).toEqual(["text"]);
    expect(body.stream_options.include_usage).toBe(true);
    expect(body.use_multichannel).toBe(false);
    expect(body).not.toHaveProperty("tools");
    expect(result.output).toEqual(output);
    expect(request.onAttempt.mock.calls.at(-1)?.[0]).toMatchObject({ status: "completed", inputTokens: 150, outputTokens: 90, costUsd: null });
    expect(request.onRaw).toHaveBeenCalledTimes(1);
    expect(provider.capabilities().verifiedTasks).toEqual([]);
  });
  it("handles split UTF-8 stream chunks", async () => {
    const original = response({ ...output, limitations: ["音色"] });
    const bytes = new Uint8Array(await original.arrayBuffer());
    const stream = new ReadableStream<Uint8Array>({ start(controller) { for (const b of bytes) controller.enqueue(new Uint8Array([b])); controller.close(); } });
    const provider = new QwenPerception({ apiKey: "test", fetch: async () => new Response(stream) });
    expect((await provider.perceive(input())).output.limitations).toEqual(["音色"]);
  });
  it("bounds retries and rechecks consent; auth failures are not retried", async () => {
    const request = input();
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response("", { status: 503 })).mockResolvedValueOnce(response());
    await new QwenPerception({ apiKey: "test", fetch: fetcher, retryDelayMs: 0 }).perceive(request);
    expect(request.beforeSend).toHaveBeenCalledTimes(2);
    expect(request.onAttempt.mock.calls.map(([a]) => a.status)).toEqual(["pending", "failed", "pending", "completed"]);
    const auth = vi.fn<typeof fetch>(async () => new Response("", { status: 401 }));
    await expect(new QwenPerception({ apiKey: "test", fetch: auth }).perceive(input())).rejects.toThrow(/401/);
    expect(auth).toHaveBeenCalledTimes(1);
    const down = vi.fn<typeof fetch>(async () => new Response("", { status: 429 }));
    await expect(new QwenPerception({ apiKey: "test", fetch: down, retryDelayMs: 0 }).perceive(input())).rejects.toThrow(/429/);
    expect(down).toHaveBeenCalledTimes(2);
  });
  it("rejects incomplete/invalid responses without discarding known billed usage", async () => {
    for (const result of [response(output, "length"), response(output, "stop", false), response({ ...output, findings: [{ ...output.findings[0], endSeconds: 3 }] })]) {
      const request = input();
      await expect(new QwenPerception({ apiKey: "test", fetch: async () => result }).perceive(request)).rejects.toThrow();
      expect(request.onAttempt.mock.calls.at(-1)?.[0]).toMatchObject({ status: "completed", inputTokens: 150 });
      expect(request.onRaw).toHaveBeenCalledTimes(1);
    }
  });
  it("refuses arbitrary destinations, unsupported models, missing keys and oversized audio", async () => {
    expect(() => new QwenPerception({ baseUrl: "https://example.com" })).toThrow(/official/);
    expect(() => new QwenPerception({ model: "qwen3.8-omni-flash-realtime" })).toThrow(/realtime/);
    const fetcher = vi.fn<typeof fetch>();
    await expect(new QwenPerception({ fetch: fetcher }).perceive(input())).rejects.toThrow(/KEY/);
    const provider = new QwenPerception({ apiKey: "test", fetch: fetcher });
    await expect(provider.perceive({ ...input(), durationSeconds: NaN })).rejects.toThrow(/limit/);
    await expect(provider.perceive({ ...input(), audio: new Uint8Array(12_000_001) })).rejects.toThrow(/limit/);
    const denied = input(); denied.beforeSend.mockRejectedValue(new Error("revoked"));
    await expect(provider.perceive(denied)).rejects.toThrow(/revoked/);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("cancels an active request without retrying", async () => {
    const controller = new AbortController();
    const fetcher = vi.fn<typeof fetch>(async (_url, init) => await new Promise((_, reject) => {
      init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
      controller.abort(new Error("cancelled"));
    }));
    const request = { ...input(), signal: controller.signal };
    await expect(new QwenPerception({ apiKey: "test", fetch: fetcher }).perceive(request)).rejects.toThrow(/cancelled/);
    expect(request.onAttempt.mock.calls.at(-1)?.[0].status).toBe("cancelled");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("caps response bytes even when no content-length is provided", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response("a".repeat(1_000_001)));
    await expect(new QwenPerception({ apiKey: "test", fetch: fetcher }).perceive(input())).rejects.toThrow(/limit/);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
