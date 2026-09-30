import { describe, expect, it } from "vitest";
import { addChannels, addPattern, setSteps, setTempo } from "@shared/music/edits";
import { FIRST_PATTERN_ID, createMusicProject } from "@shared/music/project";
import { activeDraft, editWithDraft, stepPattern, withDraftPattern } from "./patterns";

const song = () => addPattern(addChannels(createMusicProject("Beat"), [{ id: "chan_kick", name: "Kick", sampleId: null }]), { id: "pat_2" });

describe("the pattern selector's steps", () => {
  it("go through the song's patterns, then to one draft past the last", () => {
    const s = song();
    expect(stepPattern(s, FIRST_PATTERN_ID, null, 1)).toEqual({ patternId: "pat_2", draft: null });
    expect(stepPattern(s, FIRST_PATTERN_ID, null, -1)).toEqual({ patternId: FIRST_PATTERN_ID, draft: null });
    const up = stepPattern(s, "pat_2", null, 1);
    expect(up.draft).toMatchObject({ name: "Pattern 3" });
    expect(up.patternId).toBe(up.draft!.id);
    // Further up stays on the draft; down leaves it.
    expect(stepPattern(s, up.patternId, up.draft, 1)).toEqual(up);
    expect(stepPattern(s, up.patternId, up.draft, -1)).toEqual({ patternId: "pat_2", draft: null });
  });
});

describe("a draft pattern", () => {
  const draft = { id: "pat_draft", name: "Pattern 3" };

  it("joins the song when an edit puts something in it, and not otherwise", () => {
    const s = song();
    const drawn = editWithDraft(s, draft, (x) => setSteps(x, draft.id, "chan_kick", [0], true));
    expect(drawn.patterns.map((p) => p.id)).toEqual([FIRST_PATTERN_ID, "pat_2", "pat_draft"]);
    expect(drawn.patterns[2]).toMatchObject({ name: "Pattern 3" });
    // Another edit: the draft stays out.
    const faster = editWithDraft(s, draft, (x) => setTempo(x, 150));
    expect(faster.patterns.map((p) => p.id)).toEqual([FIRST_PATTERN_ID, "pat_2"]);
    expect(faster.settings.tempo).toBe(150);
    // Nothing changed: the same song.
    expect(editWithDraft(s, draft, (x) => x)).toBe(s);
    expect(editWithDraft(s, draft, (x) => setSteps(x, draft.id, "chan_kick", [0], false))).toBe(s);
  });

  it("is shown while it's the pattern picked and isn't in the song, and plays empty", () => {
    const s = song();
    expect(activeDraft(s, draft.id, draft)).toBe(draft);
    expect(activeDraft(s, "pat_2", draft)).toBeNull();
    expect(activeDraft(addPattern(s, draft), draft.id, draft)).toBeNull();
    expect(withDraftPattern(s, draft).patterns[2]).toEqual({ id: "pat_draft", name: "Pattern 3", length: null, notes: {} });
    expect(withDraftPattern(s, null)).toBe(s);
  });
});
