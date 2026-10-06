import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ExampleLibrary } from "./example-library.ts";
import { mixParamsExample } from "./mixparams-examples.ts";
import { selectReferenceSubset } from "../../../shared/music/mix-reference.ts";
import { createEngineerProfile, createMixExample, parseMixExample, searchMixExamples, type DecisionExample } from "../../../shared/music/audio-intelligence/examples.ts";
import { hashJson } from "../../../shared/music/hash.ts";
import { MUSIC_TOOLS } from "../../../shared/music/tools.ts";
import { MIX_WORKFLOWS } from "../../../shared/music/audio-intelligence/workflows.ts";

const project = "proj_0123456789ab", other = "proj_abcdef012345";
function decision(): DecisionExample {
  return createMixExample({ kind: "decision", title: "Reviewed vocal compressor", role: "leadVocal", genre: "acoustic", goal: null, recordingFamilies: ["family-recorded-vocal"],
    provenance: [{ sourceId: "source-1", sha256: hashJson("source"), locator: "reviewed-session/track-1", method: "native annotation" }],
    permissions: { localAnalysis: true, hostedAnalysis: false, retrievalDisplay: true, training: false }, review: { reviewer: "test-reviewer", note: "Data fidelity review; quality unknown." },
    missing: ["verified units", "intent"], limitations: ["No executable settings."], engineer: null, sessionId: null,
    chain: [{ plugin: "Compressor", version: null, controls: [{ name: "threshold", value: 12, unit: null, unitStatus: "unverified", readability: "annotated" }] }], routing: null, automation: null, outcomeArtifactIds: [] }) as DecisionExample;
}
describe("project-scoped reviewed examples and workflow tools", () => {
  let root: string, library: ExampleLibrary;
  beforeEach(async () => { root = await fs.mkdtemp(path.join(os.tmpdir(), "mix-examples-")); library = new ExampleLibrary(root, id => [project, other].includes(id)); });
  afterEach(async () => { await fs.rm(root, { recursive: true, force: true }); });
  it("returns native unknown units, missing context and weak genre matches without executable proposals", async () => {
    const e = decision(); await library.add(project, { examples: [e] });
    const results = await library.tool(project, "search_mix_examples", { role: "leadVocal", plugin: "compressor", genre: "trap" }) as { results: ReturnType<typeof searchMixExamples> };
    expect(results.results).toHaveLength(1);
    expect(results.results[0].example).toEqual(e);
    expect(results.results[0].relevance.genreMatch).toBe("weak");
    expect(results.results[0].eligibility.executableProposal).toBe(false);
    expect(searchMixExamples([e], { purpose: "effect-comparison" })).toEqual([]);
    expect(searchMixExamples([e], { goal: "invented intent" })).toEqual([]);
  });
  it("excludes private/unreviewed examples and isolates closed-tab retrieval across projects/restarts", async () => {
    const e = decision();
    const privateExample = createMixExample({ ...e, permissions: { ...e.permissions, retrievalDisplay: false } });
    const unreviewed = createMixExample({ ...e, review: null });
    await library.add(project, { examples: [e, privateExample, unreviewed] });
    expect((await library.tool(project, "search_mix_examples", {}) as { results: unknown[] }).results).toHaveLength(1);
    await expect(library.tool(other, "get_mix_example", { exampleId: e.id })).rejects.toThrow(/No reviewed/);
    await expect(library.tool(project, "get_mix_example", { exampleId: privateExample.id })).rejects.toThrow(/No reviewed/);
    const reopened = new ExampleLibrary(root, id => id === project);
    expect(await reopened.tool(project, "get_mix_example", { exampleId: e.id })).toMatchObject({ example: e });
    await expect(library.tool("../other", "list_mix_workflows", {})).rejects.toThrow(/No such/);
  });
  it("requires source-backed eligible profiles and preserves exceptions", async () => {
    const e = decision();
    const profile = createEngineerProfile({ name: "Engineer", reviewedBy: "reviewer", tendencies: [{ claim: "A compressor appears in this supplied vocal chain.", exampleIds: [e.id], applicability: "One source session only.", exceptions: ["Intent and broader style are unknown."] }], limitations: ["Not a quality claim."] });
    await expect(library.add(project, { profiles: [profile] })).rejects.toThrow(/cites missing/);
    await library.add(project, { examples: [e], profiles: [profile] });
    expect(await library.tool(project, "get_engineer_profile", { profileId: profile.id })).toEqual(profile);
    await expect(library.tool(other, "get_engineer_profile", { profileId: profile.id })).rejects.toThrow(/No reviewed/);
  });
  it("refuses edited identities, malformed controls and invalid query bounds", async () => {
    const e = decision();
    expect(() => parseMixExample({ ...e, title: "tampered" })).toThrow(/content/);
    expect(() => createMixExample({ ...e, chain: [{ ...e.chain[0], controls: [{ ...e.chain[0].controls[0], unitStatus: "verified" }] }] })).toThrow(/verified units/);
    await expect(library.tool(project, "search_mix_examples", { limit: 100 })).rejects.toThrow(/1–5/);
  });
  it("bridges A annotations without inventing units, intent, preferences or training eligibility", () => {
    const record = selectReferenceSubset([{ song_name: "Song", mix_name: "Mix", track_name: "Vocal", track_instrument_type: "VOCALS", track_instrument_subtype: "LEAD", parameters: { compression: [{ name: "Compressor", threshold: 12, ratio: 3 }] } }]).records[0];
    expect(record).toBeDefined();
    const e = mixParamsExample(record, hashJson(record));
    expect(e.goal).toBeNull(); expect(e.engineer).toBeNull(); expect(e.permissions.training).toBe(false);
    expect(e.chain[0].controls.every(c => c.unit === null && c.unitStatus === "unverified")).toBe(true);
    expect(() => mixParamsExample({ ...record, unitStatus: "verified" }, hashJson(record))).toThrow(/Slice A/);
  });
  it("discovers compact curated workflows whose tools exist", async () => {
    const list = await library.tool(project, "list_mix_workflows", {}) as { id: string; steps?: string[] }[];
    expect(list).toHaveLength(3); expect(list[0].steps).toBeUndefined();
    const workflow = await library.tool(project, "get_mix_workflow", { workflowId: "vocal-eq" });
    expect(workflow).toMatchObject({ id: "vocal-eq", version: 2 });
    const toolNames = new Set(MUSIC_TOOLS.map(t => t.name));
    for (const w of MIX_WORKFLOWS) for (const name of w.tools) expect(toolNames.has(name as typeof MUSIC_TOOLS[number]["name"])).toBe(true);
    await expect(library.tool(project, "get_mix_workflow", { workflowId: "donor-shell-instructions" })).rejects.toThrow(/Unknown/);
  });
});
