import fs from "node:fs/promises";
import type { TranscriptionEngineInfo } from "../../shared/types.ts";
import { SAMPLE_RATE } from "./audio.ts";
import type { EngineResult, TranscriptionEngine } from "./engine.ts";

const WORDS = ["This", "is", "a", "caption", "test."];

/** Stands in for the local engine in the e2e tests: one made-up word every 0.4 s of the audio. */
export class FakeEngine implements TranscriptionEngine {
  readonly id = "local" as const;
  readonly model = "fake/1";

  async info(): Promise<TranscriptionEngineInfo> {
    return {
      id: this.id,
      label: "On this Mac",
      description: "A stand-in engine for tests.",
      kind: "local",
      status: "ready",
      message: null,
      progress: null,
      canSetUp: true,
    };
  }

  async setUp(): Promise<void> {}

  async transcribe(wav: string): Promise<EngineResult> {
    const { size } = await fs.stat(wav);
    const duration = (size - 44) / 2 / SAMPLE_RATE;
    const words = [];
    for (let i = 0; (i + 1) * 0.4 <= duration; i++) {
      words.push({ text: `${i ? " " : ""}${WORDS[i % WORDS.length]}`, start: i * 0.4, end: i * 0.4 + 0.3 });
    }
    return { language: "en", words };
  }
}
