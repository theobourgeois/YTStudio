"""
Basic Pitch's own note picking, the fixture `shared/music/transcribe.test.ts` holds `pickFrameNotes` to:
synthetic activations (16-bit, as the worker hands them over, stored sparse) and what Spotify's
`output_to_notes_polyphonic` (basic-pitch 0.4.0) picks from them at four settings.

    python3 -m venv .venv && .venv/bin/pip install basic-pitch
    .venv/bin/python -I scripts/basic-pitch-fixtures.py shared/music/transcribe-fixtures.json
"""
import json, sys
import numpy as np
import basic_pitch.note_creation as nc
rng = np.random.default_rng(7)
T, K = 360, 88
note = np.zeros((T, K), np.float32); onset = np.zeros((T, K), np.float32)
# Notes with onsets: (start, length, key, strength); some chords, a repeated key, and a note with no onset (for Melodia).
events = [(10, 40, 39, 0.8), (10, 40, 43, 0.7), (10, 40, 46, 0.6), (60, 25, 41, 0.9), (90, 8, 50, 0.9), (100, 60, 27, 0.75),
          (120, 30, 55, 0.65), (150, 30, 55, 0.7), (190, 50, 63, 0.55), (250, 45, 30, 0.85), (300, 40, 70, 0.6)]
for s, n, k, a in events:
    env = a * (0.85 + 0.15 * np.cos(np.linspace(0, np.pi, n)))
    note[s:s + n, k] = np.maximum(note[s:s + n, k], env)
    note[s:s + n, k + 1] = np.maximum(note[s:s + n, k + 1], env * 0.4)  # a neighbour leaking
    onset[s, k] = a * 0.9; onset[s - 1, k] = a * 0.3; onset[s + 1, k] = a * 0.35
# No onset: only Melodia finds it.
note[200:240, 20] = 0.62
# Faint noise everywhere.
mask = rng.random((T, K)) < 0.03
note[mask] = np.maximum(note[mask], rng.random(mask.sum()).astype(np.float32) * 0.35)
mask = rng.random((T, K)) < 0.02
onset[mask] = np.maximum(onset[mask], rng.random(mask.sum()).astype(np.float32) * 0.6)
q = lambda a: np.round(np.clip(a, 0, 1) * 65535).astype(np.uint16)
nq, oq = q(note), q(onset)
nf, of = nq.astype(np.float32) / 65535, oq.astype(np.float32) / 65535
sparse = lambda a: [[int(t), int(k), int(a[t, k])] for t, k in zip(*np.nonzero(a))]
out = {"frames": T, "notes": sparse(nq), "onsets": sparse(oq), "expected": {}}
for name, (ot, ft, ml, infer, melodia) in {"default": (0.5, 0.3, 11, True, True), "loose": (0.3, 0.2, 5, True, True), "tight": (0.7, 0.45, 20, True, True), "plain": (0.5, 0.3, 11, False, False)}.items():
    ev = nc.output_to_notes_polyphonic(nf.copy(), of.copy(), onset_thresh=ot, frame_thresh=ft, min_note_len=ml, infer_onsets=infer, max_freq=None, min_freq=None, melodia_trick=melodia)
    out["expected"][name] = {"settings": [ot, ft, ml, infer, melodia], "notes": sorted([[int(a), int(b), int(p), round(float(amp), 6)] for a, b, p, amp in ev])}
json.dump(out, open(sys.argv[1], "w"), separators=(",", ":"))
print({k: len(v["notes"]) for k, v in out["expected"].items()}, len(out["notes"]), len(out["onsets"]))
