import { describe, expect, it } from "vitest";
import { SAMPLE_RATE, analyseSpeech, originalSpan, originalTime, snapToSpeech, speechRegions, squeeze, wavFile } from "./audio.ts";
import { wordsFromPieces } from "./engine.ts";
import { parseVerboseJson } from "./openai.ts";
import { parseWhisperJson } from "./whisper-cpp.ts";

/** PCM with a 440 Hz tone over each `[start, end)` and near-silence (a faint hiss) elsewhere. */
function pcmWith(duration: number, tones: [number, number][]): Int16Array {
  const pcm = new Int16Array(Math.round(duration * SAMPLE_RATE));
  for (let i = 0; i < pcm.length; i++) {
    const t = i / SAMPLE_RATE;
    const on = tones.some(([a, b]) => t >= a && t < b);
    pcm[i] = on ? Math.round(8000 * Math.sin(2 * Math.PI * 440 * t)) : ((i * 7919) % 11) - 5;
  }
  return pcm;
}

describe("speechRegions + squeeze", () => {
  const pcm = pcmWith(10, [[2, 3], [3.4, 4], [7, 8]]);

  it("finds the sound, keeps short pauses and pads each stretch", () => {
    const regions = speechRegions(pcm);
    expect(regions).toHaveLength(2);
    expect(regions[0].start).toBeCloseTo(1.75, 1);
    expect(regions[0].end).toBeCloseTo(4.25, 1);
    expect(regions[1].start).toBeCloseTo(6.75, 1);
    expect(regions[1].end).toBeCloseTo(8.25, 1);
  });

  it("squeezes out the long silences and maps times back", () => {
    const regions = speechRegions(pcm);
    const { pcm: out, segments } = squeeze(pcm, regions);
    // 2.5 s + 0.2 s gap + 1.5 s.
    expect(out.length / SAMPLE_RATE).toBeCloseTo(4.2, 1);
    expect(originalTime(segments, 0)).toBeCloseTo(1.75, 1);
    expect(originalTime(segments, 1)).toBeCloseTo(2.75, 1);
    // The second stretch starts after the first plus the gap.
    expect(originalTime(segments, segments[1].squeezed + 0.25)).toBeCloseTo(7, 1);
    // In the gap: the nearer side.
    expect(originalTime(segments, segments[0].length + 0.05)).toBeCloseTo(regions[0].end, 2);
    expect(originalTime(segments, segments[1].squeezed - 0.05)).toBeCloseTo(regions[1].start, 2);
    expect(originalTime(segments, 99)).toBeCloseTo(regions[1].end, 2);
    // A word across the gap stays on the side of its middle.
    const across = originalSpan(segments, segments[0].length - 0.05, segments[1].squeezed + 0.02);
    expect(across.start).toBeCloseTo(regions[0].end - 0.05, 2);
    expect(across.end).toBeCloseTo(regions[0].end, 2);
    const later = originalSpan(segments, segments[0].length - 0.02, segments[1].squeezed + 0.1);
    expect(later.start).toBeCloseTo(regions[1].start, 2);
    expect(later.end).toBeCloseTo(regions[1].start + 0.1, 2);
  });

  it("never cuts a recording that's loud throughout", () => {
    const music = pcmWith(6, [[0, 6]]);
    expect(speechRegions(music)).toEqual([{ start: 0, end: 6 }]);
    expect(speechRegions(new Int16Array(SAMPLE_RATE * 3))).toEqual([]);
  });

  it("writes a WAV header", () => {
    const wav = wavFile(new Int16Array([1, -1, 2]));
    expect(wav.length).toBe(44 + 6);
    expect(wav.toString("ascii", 0, 4)).toBe("RIFF");
    expect(wav.readUInt32LE(24)).toBe(SAMPLE_RATE);
    expect(wav.readInt16LE(46)).toBe(-1);
  });
});

describe("snapToSpeech", () => {
  const voiced = [{ start: 3, end: 4 }, { start: 7, end: 8 }];

  it("starts a word where its sound does", () => {
    expect(snapToSpeech([{ start: 2.5, end: 3.4 }], voiced)).toEqual([{ start: 3, end: 3.4 }]);
    expect(snapToSpeech([{ start: 3.8, end: 4.6 }], voiced)).toEqual([{ start: 3.8, end: 4 }]);
  });

  it("moves a word timed in the silence ahead to the next sound", () => {
    const words = [
      { text: "end.", start: 3.5, end: 3.9 },
      { text: "Hey", start: 4.2, end: 4.4 },
      { text: "there", start: 7.2, end: 7.6 },
    ];
    expect(snapToSpeech(words, voiced).map((w) => [w.text, w.start, w.end])).toEqual([
      ["end.", 3.5, 3.9],
      ["Hey", 7, 7.2],
      ["there", 7.2, 7.6],
    ]);
  });

  it("leaves words alone when there's no sound to move them to", () => {
    const words = [{ start: 8.5, end: 9 }, { start: 9.1, end: 9.4 }];
    expect(snapToSpeech(words, voiced)).toEqual(words);
    expect(snapToSpeech(words, [])).toEqual(words);
  });

  it("finds the sound exactly, across the gaps inside words", () => {
    const { voiced: found } = analyseSpeech(pcmWith(6, [[1, 1.5], [1.6, 2], [4, 4.5]]));
    expect(found.map((r) => [+r.start.toFixed(2), +r.end.toFixed(2)])).toEqual([[1, 2], [4, 4.5]]);
  });
});

describe("wordsFromPieces", () => {
  it("joins word pieces, punctuation and contractions onto the word before", () => {
    const pieces = [" Hey", " every", "one", ".", " I", "'m", " here", "!"].map((text, i) => ({ text, start: i, end: i + 0.5 }));
    expect(wordsFromPieces(pieces)).toEqual([
      { text: " Hey", start: 0, end: 0.5 },
      { text: " everyone.", start: 1, end: 3.5 },
      { text: " I'm", start: 4, end: 5.5 },
      { text: " here!", start: 6, end: 7.5 },
    ]);
  });

  it("makes every piece a word in scripts without spaces", () => {
    const pieces = ["こんにちは", "。", "今日は", "動画"].map((text, i) => ({ text, start: i, end: i + 1 }));
    expect(wordsFromPieces(pieces).map((w) => w.text)).toEqual(["こんにちは", "。", "今日は", "動画"]);
  });
});

describe("parseWhisperJson", () => {
  it("reads token times (ms) and skips special tokens", () => {
    const result = parseWhisperJson({
      result: { language: "en" },
      transcription: [
        {
          tokens: [
            { text: "[_BEG_]", offsets: { from: 0, to: 0 } },
            { text: " Hello", offsets: { from: 120, to: 480 } },
            { text: ",", offsets: { from: 480, to: 500 } },
            { text: " world", offsets: { from: 520, to: 900 } },
            { text: "[_TT_45]", offsets: { from: 900, to: 900 } },
          ],
        },
      ],
    });
    expect(result).toEqual({
      language: "en",
      words: [
        { text: " Hello,", start: 0.12, end: 0.5 },
        { text: " world", start: 0.52, end: 0.9 },
      ],
    });
  });
});

describe("parseVerboseJson", () => {
  it("takes punctuation and capitals from the full text", () => {
    const result = parseVerboseJson({
      language: "english",
      text: "Hello, world. It's 3.5 dollars!",
      words: [
        { word: "Hello", start: 0, end: 0.4 },
        { word: "world", start: 0.5, end: 0.9 },
        { word: "its", start: 1, end: 1.2 },
        { word: "3.5", start: 1.2, end: 1.6 },
        { word: "dollars", start: 1.6, end: 2 },
      ],
    });
    expect(result.language).toBe("en");
    expect(result.words.map((w) => w.text)).toEqual([" Hello,", " world.", " It's", " 3.5", " dollars!"]);
  });

  it("keeps the words as they are when they don't line up", () => {
    const result = parseVerboseJson({ text: "twenty-five people", words: [{ word: "twenty", start: 0, end: 0.3 }, { word: "five", start: 0.3, end: 0.6 }, { word: "people", start: 0.6, end: 1 }] });
    expect(result.words.map((w) => w.text)).toEqual([" twenty", " five", " people"]);
    expect(parseVerboseJson({ text: "你好世界", words: [{ word: "你好", start: 0, end: 1 }] }).words[0].text).toBe("你好");
  });
});
