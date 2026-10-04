import { describe, expect, it, vi } from "vitest";
import { GeminiPerception, GEMINI_DESTINATION } from "./perception.ts";
import { validatePerceptionOutput } from "../../../shared/music/audio-intelligence/hearing.ts";
import type { HearingAttempt } from "../../../shared/music/audio-intelligence/hearing.ts";
const output = { findings: [{ task: "tone", claim: "A sustained bright sound.", startSeconds: 0, endSeconds: 1 }], limitations: [] };
const response = (value: unknown = output) => new Response(JSON.stringify({ status: "completed", model: "gemini-3.8-flash", steps: [{ type: "model_output", content: [{ type: "text", text: JSON.stringify(value) }] }], usage: { total_input_tokens: 123, total_output_tokens: 45 } }));
const input = () => ({ audio: new Uint8Array([1, 2, 3]), durationSeconds: 2, task: "tone" as const, question: "Describe the tone", signal: new AbortController().signal, beforeSend: vi.fn(async () => {}), onAttempt: vi.fn(async (_a: HearingAttempt) => {}) });
describe("Gemini byte adapter", () => {
  it("sends inline audio without remote storage and records actual usage", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => response());
    const provider = new GeminiPerception({ apiKey: "test-secret", fetch: fetcher });
    const request = input();
    const result = await provider.perceive(request);
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe(GEMINI_DESTINATION);
    expect(url).not.toContain("test-secret");
    const body = JSON.parse(String(init?.body));
    expect(body.store).toBe(false);
    expect(body.input[1]).toEqual({ type: "audio", data: "AQID", mime_type: "audio/wav" });
    expect(body).not.toHaveProperty("tools");
    expect(init?.redirect).toBe("error");
    expect(result.output).toEqual(output);
    expect(request.beforeSend).toHaveBeenCalledTimes(1);
    expect(request.onAttempt.mock.calls[1][0]).toMatchObject({ status: "completed", inputTokens: 123, outputTokens: 45, costUsd: null });
    expect(provider.capabilities().verifiedTasks).toEqual([]);
  });
  it("bounds retries and rechecks consent before each attempt", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response("", { status: 429 })).mockResolvedValueOnce(response());
    const request = input();
    await new GeminiPerception({ apiKey: "test", fetch: fetcher, retryDelayMs: 0 }).perceive(request);
    expect(request.beforeSend).toHaveBeenCalledTimes(2);
    expect(request.onAttempt.mock.calls.map(([a]) => a.status)).toEqual(["pending", "failed", "pending", "completed"]);
    const down = vi.fn<typeof fetch>(async () => new Response("", { status: 503 }));
    await expect(new GeminiPerception({ apiKey: "test", fetch: down, retryDelayMs: 0 }).perceive(input())).rejects.toThrow(/503/);
    expect(down).toHaveBeenCalledTimes(2);
  });
  it("does not retry authentication, malformed responses, or invalid times", async () => {
    for (const result of [new Response("", { status: 401 }), response({ ...output, findings: [{ ...output.findings[0], endSeconds: 3 }] }), response({ findings: "bad", limitations: [] })]) {
      const fetcher = vi.fn<typeof fetch>(async () => result);
      await expect(new GeminiPerception({ apiKey: "test", fetch: fetcher }).perceive(input())).rejects.toThrow();
      expect(fetcher).toHaveBeenCalledTimes(1);
    }
  });
  it("retains billed usage even when findings are invalid", async () => {
    const request = input();
    await expect(new GeminiPerception({ apiKey: "test", fetch: async () => response({ findings: [], limitations: "bad" }) }).perceive(request)).rejects.toThrow();
    expect(request.onAttempt.mock.calls.at(-1)?.[0]).toMatchObject({ status: "completed", inputTokens: 123 });
  });
  it("never sends without consent, key, size bounds, or after cancellation", async () => {
    const fetcher = vi.fn<typeof fetch>();
    const provider = new GeminiPerception({ apiKey: "test", fetch: fetcher });
    const denied = input(); denied.beforeSend.mockRejectedValue(new Error("revoked"));
    await expect(provider.perceive(denied)).rejects.toThrow("revoked");
    await expect(new GeminiPerception({ fetch: fetcher }).perceive(input())).rejects.toThrow(/key/);
    await expect(provider.perceive({ ...input(), durationSeconds: 121 })).rejects.toThrow(/limit/);
    const controller = new AbortController(); controller.abort();
    await expect(provider.perceive({ ...input(), signal: controller.signal })).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("suppresses exact settings, spatial claims and mismatched tasks", () => {
    const findings = ["Stereo is wide", "Use a threshold of -12 dB", "Boost 200 Hz", "A soft sound"].map(claim => ({ ...output.findings[0], claim }));
    expect(validatePerceptionOutput({ findings, limitations: [] }, 2, "tone").findings).toHaveLength(1);
    expect(validatePerceptionOutput(output, 2, "dynamics").findings).toEqual([]);
  });
});
