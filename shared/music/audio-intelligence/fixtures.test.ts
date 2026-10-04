import { describe, expect, it } from "vitest";
import { leakingItem, splitByFamily } from "./families.ts";
import { FIXTURES, FIXTURE_ROLES, beatHits, dbToGain, fixtureById, gainToDb, renderFixture, seeded, validateFixtures, voicePhrases, type FixtureSpec } from "./fixtures.ts";

// Independent measurements of generated audio: straightforward sums, not the app's analysers (which don't exist yet).
const peakDb = (x: ArrayLike<number>, from = 0, to = x.length) => {
  let peak = 0;
  for (let i = from; i < to; i++) peak = Math.max(peak, Math.abs(x[i]));
  return peak === 0 ? -Infinity : gainToDb(peak);
};
const rmsDb = (x: ArrayLike<number>) => {
  let sum = 0;
  for (let i = 0; i < x.length; i++) sum += x[i] * x[i];
  return 10 * Math.log10(sum / x.length);
};
const correlation = (a: ArrayLike<number>, b: ArrayLike<number>) => {
  let ab = 0;
  let aa = 0;
  let bb = 0;
  for (let i = 0; i < a.length; i++) {
    ab += a[i] * b[i];
    aa += a[i] * a[i];
    bb += b[i] * b[i];
  }
  return ab / Math.sqrt(aa * bb);
};

const spec = (id: string): FixtureSpec => {
  const found = fixtureById(id);
  if (!found) throw new Error(`no fixture ${id}`);
  return found;
};
const audio = (id: string) => renderFixture(spec(id), FIXTURES);

describe("seeded", () => {
  it("is the same sequence for the same seed, and a different one for another", () => {
    const a = seeded(1);
    const b = seeded(1);
    const c = seeded(2);
    const first = Array.from({ length: 5 }, () => a());
    expect(Array.from({ length: 5 }, () => b())).toEqual(first);
    expect(Array.from({ length: 5 }, () => c())).not.toEqual(first);
  });

  it("stays in [0, 1) and is spread over it", () => {
    const random = seeded(42);
    const values = Array.from({ length: 10_000 }, () => random());
    expect(Math.min(...values)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...values)).toBeLessThan(1);
    expect(values.reduce((a, b) => a + b, 0) / values.length).toBeGreaterThan(0.48);
    expect(values.reduce((a, b) => a + b, 0) / values.length).toBeLessThan(0.52);
  });
});

describe("the collection", () => {
  it("is a valid manifest", () => {
    const read = validateFixtures(JSON.parse(JSON.stringify(FIXTURES)));
    expect(read.ok && read.value).toEqual(FIXTURES);
  });

  it("has a vocal, a beat, a mix of them and the known signals", () => {
    const roles = new Set(FIXTURES.map((f) => f.role));
    for (const role of FIXTURE_ROLES) expect(roles.has(role), role).toBe(true);
    expect(FIXTURES.filter((f) => f.role === "vocal").length).toBeGreaterThanOrEqual(2);
  });

  it("is cleared: generated here, nothing for training until someone decides", () => {
    for (const f of FIXTURES) {
      expect(f.license).toBe("generated");
      expect(f.permissions).toMatchObject({ localAnalysis: true, training: false });
    }
  });

  it("gives each recording its own family, and a mix the families of its sources", () => {
    const recordings = FIXTURES.filter((f) => f.role !== "mix");
    const all = recordings.flatMap((f) => f.families);
    expect(new Set(all).size).toBe(all.length);
    for (const f of FIXTURES.filter((x) => x.role === "mix")) {
      if (f.generator.kind !== "mix") throw new Error("a mix is made by mixing");
      const sources = f.generator.sources.map((s) => spec(s.fixture).families[0]).sort();
      expect([...f.families].sort()).toEqual(sources);
    }
  });

  it("stays together in a split: the mix lands where its vocal and its beat do", () => {
    for (const seed of ["a", "b", "c", "d", "e", "f"]) {
      const { assignment } = splitByFamily(FIXTURES, { seed, testFraction: 0.4 });
      expect(leakingItem(FIXTURES, assignment), seed).toBeNull();
      expect(assignment.fixture_mix_uneven_over_120).toBe(assignment.fixture_vocal_uneven);
      expect(assignment.fixture_mix_uneven_over_120).toBe(assignment.fixture_beat_120);
    }
  });

  it("has fixtures short enough to keep tests fast", () => {
    expect(FIXTURES.reduce((total, f) => total + f.seconds * f.channels, 0)).toBeLessThan(120);
  });
});

describe("every fixture is what it says it is", () => {
  for (const f of FIXTURES) {
    it(`${f.id}: has the format its spec says`, () => {
      const { sampleRate, channels } = audio(f.id);
      expect(sampleRate).toBe(f.sampleRate);
      expect(channels).toHaveLength(f.channels);
      for (const c of channels) expect(c).toHaveLength(Math.round(f.seconds * f.sampleRate));
    });

    it(`${f.id}: is finite, and within full scale`, () => {
      for (const c of audio(f.id).channels)
        for (let i = 0; i < c.length; i++) {
          if (!Number.isFinite(c[i]) || Math.abs(c[i]) > 1) throw new Error(`${f.id}[${i}] = ${c[i]}`);
        }
    });

    it(`${f.id}: is the same twice`, () => {
      const a = audio(f.id);
      const b = audio(f.id);
      a.channels.forEach((c, i) => expect(Buffer.from(c.buffer).equals(Buffer.from(b.channels[i].buffer))).toBe(true));
    });

    it(`${f.id}: has the peak, level and correlation its spec says`, () => {
      const { channels } = audio(f.id);
      const tolerance = f.expected.toleranceDb;
      const peak = Math.max(...channels.map((c) => peakDb(c)));
      if (f.expected.peakDbfs !== undefined) expect(peak).toBeCloseTo(f.expected.peakDbfs, 1 - Math.floor(Math.log10(tolerance || 1)));
      if (f.expected.peakDbfs !== undefined) expect(Math.abs(peak - f.expected.peakDbfs)).toBeLessThanOrEqual(tolerance + 1e-6);
      if (f.expected.peakAtMostDbfs !== undefined) expect(peak).toBeLessThanOrEqual(f.expected.peakAtMostDbfs + tolerance);
      if (f.expected.rmsDbfs !== undefined) expect(Math.abs(rmsDb(channels[0]) - f.expected.rmsDbfs)).toBeLessThanOrEqual(tolerance + 1e-6);
      if (f.expected.correlation !== undefined) expect(Math.abs(correlation(channels[0], channels[channels.length - 1]) - f.expected.correlation)).toBeLessThan(0.02);
    });
  }
});

describe("the voices", () => {
  it("peak each phrase at its level, and are silent between them", () => {
    for (const id of ["fixture_vocal_uneven", "fixture_vocal_steady"]) {
      const f = spec(id);
      const [mono] = audio(id).channels;
      for (const phrase of f.expected.phrases ?? []) {
        const from = Math.floor(phrase.startSeconds * f.sampleRate);
        const to = Math.floor(phrase.endSeconds * f.sampleRate);
        expect(peakDb(mono, from, to), `${id} at ${phrase.startSeconds}`).toBeCloseTo(phrase.peakDbfs, 1);
      }
      // The gap after the last phrase, and the lead-in before the first, are silent.
      const phrases = f.expected.phrases ?? [];
      expect(peakDb(mono, 0, Math.floor(phrases[0].startSeconds * f.sampleRate) - 1)).toBe(-Infinity);
      const last = phrases[phrases.length - 1];
      expect(peakDb(mono, Math.ceil(last.endSeconds * f.sampleRate) + 1, mono.length)).toBe(-Infinity);
    }
  });

  it("differ in dynamics: the uneven one spans 16 dB between phrases, the steady one under 2", () => {
    const spread = (id: string) => {
      const peaks = (spec(id).expected.phrases ?? []).map((p) => p.peakDbfs);
      return Math.max(...peaks) - Math.min(...peaks);
    };
    expect(spread("fixture_vocal_uneven")).toBe(16);
    expect(spread("fixture_vocal_steady")).toBeLessThan(2);
  });

  it("have pitch: the energy is at the sung harmonics, not smeared like noise", () => {
    const f = spec("fixture_vocal_steady");
    const [mono] = audio(f.id).channels;
    // A pitched sound repeats at its period: normalised autocorrelation of a vowel stretch peaks near it.
    const phrase = voicePhrases(4)[0];
    const start = Math.floor((phrase.startSeconds + 0.15) * f.sampleRate);
    const frame = Array.from(mono.slice(start, start + 4096));
    const auto = (lag: number) => frame.slice(0, 2048).reduce((sum, v, i) => sum + v * frame[i + lag], 0);
    let best = 0;
    let bestLag = 0;
    for (let lag = 40; lag < 1200; lag++) {
      const value = auto(lag);
      if (value > best) [best, bestLag] = [value, lag];
    }
    expect(best / auto(0)).toBeGreaterThan(0.5);
    expect(bestLag).toBeGreaterThan(40);
  });

  it("are mono in the file but two channels of the same signal when stereo is asked for", () => {
    const base = spec("fixture_vocal_uneven");
    const stereo = renderFixture({ ...base, channels: 2 });
    expect(stereo.channels).toHaveLength(2);
    expect(Buffer.from(stereo.channels[0].buffer).equals(Buffer.from(stereo.channels[1].buffer))).toBe(true);
  });

  it("change with the seed", () => {
    const a = renderFixture(spec("fixture_vocal_uneven")).channels[0];
    const b = renderFixture({ ...spec("fixture_vocal_uneven"), generator: { ...(spec("fixture_vocal_uneven").generator as Extract<FixtureSpec["generator"], { kind: "voice" }>), seed: 12 } }).channels[0];
    expect(Buffer.from(a.buffer).equals(Buffer.from(b.buffer))).toBe(false);
  });
});

describe("the beat", () => {
  it("hits where its grid says: a hit's onset is the loudest thing in its first milliseconds", () => {
    const f = spec("fixture_beat_120");
    const [left] = audio(f.id).channels;
    const hits = beatHits(120, f.seconds);
    expect(hits.length).toBeGreaterThan(40);
    // The kicks are on beats 1, 3 and before 4 of each bar.
    const kicks = hits.filter((h) => h.kind === "kick").map((h) => h.at);
    expect(kicks.slice(0, 3)).toEqual([0, 1, 1.75]);
    for (const hit of hits.filter((h) => h.kind !== "hat").slice(0, 8)) {
      const from = Math.floor(hit.at * f.sampleRate);
      expect(peakDb(left, from, from + Math.floor(0.02 * f.sampleRate)), `${hit.kind} at ${hit.at}`).toBeGreaterThan(-40);
    }
    // Between the grid's hits there is silence: the 100 ms before a hit that follows a gap.
    expect(f.expected.hitsSeconds).toEqual(hits.map((h) => h.at));
  });

  it("is stereo: the hats are panned apart and the kick and snare sit in the middle", () => {
    const f = spec("fixture_beat_120");
    const [left, right] = audio(f.id).channels;
    const all = beatHits(120, f.seconds);
    const allHats = all.filter((h) => h.kind === "hat");
    // Hats that sound alone (no kick or snare on the same eighth), with their place among all the hats.
    const alone = allHats.map((h, index) => ({ h, index })).filter(({ h }) => !all.some((o) => o.kind !== "hat" && o.at === h.at));
    const window = Math.floor(0.03 * f.sampleRate);
    const level = (channel: Float32Array, at: number) => peakDb(channel, Math.floor(at * f.sampleRate), Math.floor(at * f.sampleRate) + window);
    expect(alone.length).toBeGreaterThan(8);
    // Every other hat is panned to the left (index even), the rest to the right.
    for (const { h, index } of alone.slice(0, 10)) {
      const difference = level(left, h.at) - level(right, h.at);
      expect(index % 2 === 0 ? difference : -difference, `hat ${index} at ${h.at}`).toBeGreaterThan(3);
    }
    const kick = beatHits(120, f.seconds).find((h) => h.kind === "kick" && h.at > 0.5) as { at: number };
    // 100 ms in, the hat on the same eighth (50 ms long) has ended and the kick is still ringing: it's the same in both.
    expect(level(left, kick.at + 0.1)).toBeGreaterThan(-40);
    expect(Math.abs(level(left, kick.at + 0.1) - level(right, kick.at + 0.1))).toBeLessThan(0.1);
  });

  it("is a different feel at another tempo", () => {
    expect(beatHits(90, 8).length).toBeLessThan(beatHits(120, 8).length);
    expect(beatHits(120, 8).every((h) => h.at >= 0 && h.at < 8)).toBe(true);
  });
});

describe("the mix", () => {
  it("is the sum of its sources at the gains the spec gives, and doesn't clip", () => {
    const f = spec("fixture_mix_uneven_over_120");
    const mix = audio(f.id).channels;
    const vocal = audio("fixture_vocal_uneven").channels[0];
    const beat = audio("fixture_beat_120").channels;
    for (const i of [10_000, 50_000, 123_456, 300_000]) {
      expect(mix[0][i]).toBeCloseTo(vocal[i] * dbToGain(-6) + beat[0][i] * dbToGain(-6), 6);
      expect(mix[1][i]).toBeCloseTo(vocal[i] * dbToGain(-6) + beat[1][i] * dbToGain(-6), 6);
    }
    expect(peakDb(mix[0])).toBeLessThan(0);
  });

  it("refuses a source that isn't in the collection, a different sample rate, and a loop", () => {
    const mix = spec("fixture_mix_uneven_over_120");
    expect(() => renderFixture(mix, [mix])).toThrow(/isn't in the collection/);
    const other = { ...spec("fixture_beat_120"), sampleRate: 44100 };
    expect(() => renderFixture(mix, [mix, spec("fixture_vocal_uneven"), other])).toThrow(/44100 Hz, not 48000/);
    const loop: FixtureSpec = { ...mix, id: "fixture_loop", generator: { kind: "mix", sources: [{ fixture: "fixture_loop", gainDb: 0 }] } };
    expect(() => renderFixture(loop, [loop])).toThrow(/nest too deep/);
  });
});

describe("the known signals", () => {
  it("a tone's RMS is 3.01 dB under its peak", () => {
    const [left] = audio("fixture_tone_1k").channels;
    expect(peakDb(left) - rmsDb(left)).toBeCloseTo(3.0103, 2);
  });

  it("a square wave is as loud as its peak: no crest", () => {
    const [left] = audio("fixture_clipped_square").channels;
    expect(peakDb(left) - rmsDb(left)).toBeCloseTo(0, 6);
  });

  it("stereo noise has the correlation it's named for", () => {
    const corr = (id: string) => {
      const [l, r] = audio(id).channels;
      return correlation(l, r);
    };
    expect(corr("fixture_stereo_antiphase")).toBeCloseTo(-1, 6);
    expect(Math.abs(corr("fixture_stereo_independent"))).toBeLessThan(0.02);
    expect(corr("fixture_noise_m20")).toBeCloseTo(1, 6);
  });

  it("an anti-phase pair sums to silence", () => {
    const [l, r] = audio("fixture_stereo_antiphase").channels;
    for (let i = 0; i < l.length; i += 997) expect(l[i] + r[i]).toBe(0);
  });

  it("silence is digital zero", () => {
    for (const c of audio("fixture_silence").channels) expect(peakDb(c)).toBe(-Infinity);
  });

  it("dB and gain convert back", () => {
    for (const db of [-60, -6.02, 0, 12]) expect(gainToDb(dbToGain(db))).toBeCloseTo(db, 9);
    expect(dbToGain(-6.0206)).toBeCloseTo(0.5, 4);
  });
});

describe("validateFixtures", () => {
  const good = () => JSON.parse(JSON.stringify(FIXTURES));
  const errorsOf = (value: unknown) => {
    const read = validateFixtures(value);
    return read.ok ? [] : read.errors;
  };
  const edit = (index: number, change: (f: Record<string, unknown>) => void) => {
    const list = good();
    change(list[index]);
    return list;
  };

  it("refuses what isn't a list", () => {
    expect(errorsOf(null).length).toBeGreaterThan(0);
    expect(errorsOf({}).length).toBeGreaterThan(0);
  });

  it("refuses two fixtures with one id, and a badly named one", () => {
    expect(errorsOf([...good(), good()[0]]).join()).toMatch(/appears twice/);
    expect(errorsOf(edit(0, (f) => (f.id = "Vocal 1"))).join()).toMatch(/must be fixture_/);
  });

  it("makes every fixture name its family, and a non-mix just one", () => {
    expect(errorsOf(edit(0, (f) => (f.families = []))).join()).toMatch(/must name the recording/);
    expect(errorsOf(edit(0, (f) => (f.families = ["a", "b"]))).join()).toMatch(/is one recording, not 2/);
  });

  it("makes a mix's families the families of its sources, so it can't land apart from them", () => {
    const mixAt = FIXTURES.findIndex((f) => f.role === "mix");
    expect(errorsOf(edit(mixAt, (f) => (f.families = ["family_vocal_uneven"]))).join()).toMatch(/must be the families of what it mixes/);
    const gone = edit(mixAt, (f) => ((f.generator as { sources: { fixture: string }[] }).sources[0].fixture = "fixture_nothing"));
    expect(errorsOf(gone).join()).toMatch(/fixture_nothing, which isn't in the collection/);
  });

  it("keeps mixes and mixing together", () => {
    const mixAt = FIXTURES.findIndex((f) => f.role === "mix");
    expect(errorsOf(edit(mixAt, (f) => (f.generator = { kind: "silence" }))).join()).toMatch(/a mix is made by mixing/);
    expect(errorsOf(edit(0, (f) => (f.generator = { kind: "mix", sources: [] }))).join()).toMatch(/only a mix is made by mixing/);
  });

  it("only takes generated audio for now: a recording's licence has to be modelled first", () => {
    expect(errorsOf(edit(0, (f) => (f.license = "CC BY 4.0"))).join()).toMatch(/must be "generated"/);
  });

  it("checks the generator's numbers", () => {
    expect(errorsOf(edit(0, (f) => ((f.generator as Record<string, unknown>).f0Hz = 5))).join()).toMatch(/generator.f0Hz: must be at least 40/);
    expect(errorsOf(edit(0, (f) => ((f.generator as Record<string, unknown>).phrasePeaksDb = []))).join()).toMatch(/needs at least one phrase/);
    expect(errorsOf(edit(2, (f) => ((f.generator as Record<string, unknown>).tempo = 'fast'))).join()).toMatch(/generator.tempo/);
    expect(errorsOf(edit(0, (f) => (f.generator = { kind: "theremin" }))).join()).toMatch(/generator.kind: must be one of/);
  });

  it("checks the expectation", () => {
    expect(errorsOf(edit(0, (f) => ((f.expected as Record<string, unknown>).correlation = 3))).join()).toMatch(/expected.correlation/);
    expect(errorsOf(edit(0, (f) => delete (f.expected as Record<string, unknown>).toleranceDb)).join()).toMatch(/expected.toleranceDb/);
  });

  it("checks format and channels", () => {
    expect(errorsOf(edit(0, (f) => (f.channels = 6))).join()).toMatch(/channels/);
    expect(errorsOf(edit(0, (f) => (f.sampleRate = 100))).join()).toMatch(/sampleRate/);
    expect(errorsOf(edit(0, (f) => (f.seconds = 0))).join()).toMatch(/seconds/);
  });

  it("never throws on junk", () => {
    for (const junk of [[null], [{}], [{ generator: 3 }], [{ expected: [] }], [{ permissions: "x" }]]) expect(() => validateFixtures(junk)).not.toThrow();
  });
});
