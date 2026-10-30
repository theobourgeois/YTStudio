"""Round 2 of the blind test, from round 1's votes (Blind test/results-round1.json):

Mixing: round 1's winner (rule-balance) against versions that keep your balance inside each group (round 1 levelled
members, so song3's side snare came up as loud as the main one) with the lead (vocal, or the melody where there's none)
3 or 6 dB louder, one with the kick up too, one with cleanup on the vocals only (no bus compression, no ducking).

Mastering: your master against one chain (round 1's rule chain with no high boost: brightening read as tinny) at your
loudness and 2, 4 and 6 LU under it, to find where loudness starts costing more than it gives.

Same excerpts as round 1, every clip played at the same loudness."""
import json
import os
import secrets
import sys
import numpy as np
import dsp
import roles
import mix
import master
import build

SONGS = ["song1", "song2", "song3", "song4"]
EXCERPTS = {"song1": 89.0, "song2": 51.5, "song3": 98.0, "song4": 48.5}  # round 1's
build.PAGE = PAGE = f"{roles.ROOT}/Blind test 2"
LOCAL = "C:/Users/goali/flrender/contest/out2"

ABOUT = {
    "mix": {
        "rule-balance": "Round 1's winner, unchanged: groups (vocal, 808, kick, snare, synths…) at set levels, every member of a group levelled with the others.",
        "keep-lead+3": "The same group levels, but your own balance kept inside each group, and the lead (vocal, or the melody when there's no vocal) 3 dB louder.",
        "keep-lead+6": "Your balance inside each group, lead 6 dB louder.",
        "keep-lead+3-kick+2": "Your balance inside each group, lead 3 dB louder, kick 2 dB louder.",
        "keep-lead+3-clean": "Your balance inside each group, lead 3 dB louder, and the vocals cleaned up: high-pass, resonance cuts, de-essing, light compression. Nothing else processed: no bus compression, no ducking. (song2, with no vocal: the synths get the high-pass and resonance cuts.)",
    },
    "master": {
        "your-master": "Your own master chain, as the FLP plays.",
        "warm-at-yours": "Gentle EQ toward the reference curve that only cuts above 2 kHz, mono bass, light glue, clip and limit: at your master's loudness.",
        "warm-2-quieter": "The same chain, 2 LU quieter than your master.",
        "warm-4-quieter": "The same chain, 4 LU quieter than your master.",
        "warm-6-quieter": "The same chain, 6 LU quieter than your master.",
    },
}
INTRO = {
    "mix": "Each song mixed five ways from its stems, all through the same plain master at the same loudness. "
           "This round is mostly about how loud the lead should sit, and whether a little cleanup helps.",
    "master": "Each song's premaster mastered five ways. One is your own master; the others are one chain at "
              "different loudness. You'll hear them all at the same level, so what's left is what loudness costs "
              "(distortion, flatness) and what it gives (density, punch).",
}


def lead_group(stems):
    return "vocal_lead" if any(s.role == "vocal" for s in stems) else "synth"


def balance(stems, tracks, boosts, keep):
    """Round 1's two-stage balance with two changes on offer: `keep` leaves the members of a group at the levels they
    have relative to each other (your balance), `boosts` moves groups by dB. Returns the mix and the lead's part of it."""
    has_vocal = any(s.role == "vocal" for s in stems)
    groups = {}
    for s, t in zip(stems, tracks):
        groups.setdefault(mix.group_of(s), []).append(t if keep else dsp.gain_to(t, -30))
    lead = lead_group(stems)
    out, lead_part = [], None
    for g, members in groups.items():
        target = (mix.NO_VOCAL_SYNTH if g == "synth" and not has_vocal else mix.TARGETS[g]) + boosts.get(g, 0)
        part = mix.total(members)
        level = dsp.lufs(part)
        if not np.isfinite(level):
            continue
        part = part * dsp.undb(target - level)
        out.append(part)
        if g == lead:
            lead_part = part
    return mix.total(out), lead_part


def clean(stems):
    """The vocals' cleanup alone (no compression on anything else, no ducking, no bus glue); song2's synths when there's
    no vocal: high-pass and resonance cuts."""
    has_vocal = any(s.role == "vocal" for s in stems)
    out = []
    for s in stems:
        x = s.audio
        if s.role == "vocal":
            x = dsp.filt(x, dsp.hpf(90 if s.lead else 150))
            x = mix.tame_resonances(x)
            x = mix.de_ess(x)
            x = dsp.compress(x, 2.5, 3, 5, 80)
        elif s.role == "synth" and not has_vocal:
            x = dsp.filt(x, dsp.hpf(40 if dsp.band_share(x, 20, 150) > 0.2 else 120))
            x = mix.tame_resonances(x)
        out.append(x.astype(np.float32))
    return out


def mixes(stems, song):
    for s in stems:
        s.role = mix.OVERRIDES.get(f"{song}/{s.name}", s.role)
    raw = [s.audio for s in stems]
    lead = lead_group(stems)
    built = {
        "rule-balance": balance(stems, raw, {}, keep=False),
        "keep-lead+3": balance(stems, raw, {lead: 3}, keep=True),
        "keep-lead+6": balance(stems, raw, {lead: 6}, keep=True),
        "keep-lead+3-kick+2": balance(stems, raw, {lead: 3, "kick": 2}, keep=True),
        "keep-lead+3-clean": balance(stems, clean(stems), {lead: 3}, keep=True),
    }
    lead_to_mix = {k: round(dsp.lufs(lp) - dsp.lufs(m), 2) for k, (m, lp) in built.items()}
    return {k: mix.neutral_master(m) for k, (m, _) in built.items()}, lead_to_mix


def warm_chain(pre, target):
    x = master.tonal_eq(pre, boost_highs=False)
    x = master.mono_bass(x)
    x = master.glue(x)
    return master.final(x, target)


def masters(song):
    pre = dsp.read(f"{roles.ROOT}/{song}/{song} - premaster.wav")
    yours = dsp.read(f"{roles.ROOT}/{song}/{song} - mixdown.wav")
    t = dsp.lufs(yours)
    return {
        "your-master": yours,
        "warm-at-yours": warm_chain(pre, t),
        "warm-2-quieter": warm_chain(pre, t - 2),
        "warm-4-quieter": warm_chain(pre, t - 4),
        "warm-6-quieter": warm_chain(pre, t - 6),
    }


def main(songs):
    os.makedirs(f"{PAGE}/audio", exist_ok=True)
    os.makedirs(LOCAL, exist_ok=True)
    trials, measurements, leads = [], {}, {}
    for song in songs:
        print(song, flush=True)
        stems = roles.load(song)
        mx, leads[song] = mixes(stems, song)
        print("  lead vs mix (LU, before the master):", leads[song], flush=True)
        start = EXCERPTS[song]
        for rnd, group in (("mix", mx), ("master", masters(song))):
            items = []
            for name, x in group.items():
                dsp.write(f"{LOCAL}/{song}-{rnd}-{name}.wav", x)
                ex = build.excerpt(x, start)
                measurements[f"{song}/{rnd}/{name}"] = {"full": build.measure(x), "excerpt": build.measure(ex)}
                y = dsp.gain_to(ex, build.MATCH_LUFS)
                assert np.max(np.abs(y)) < 1, (song, rnd, name)
                fid = secrets.token_hex(6)
                build.write_clip(fid, y)
                items.append({"id": fid, "name": name})
                print(f"  {rnd:6} {name:20} {dsp.lufs(x):6.1f} LUFS  tp {dsp.db(dsp.true_peak(x)):5.1f}", flush=True)
            trials.append({"song": song, "round": rnd, "excerptStart": start, "items": items})
    with open(f"{PAGE}/trials.js", "w", encoding="utf8") as f:
        f.write("window.TRIALS = " + json.dumps({"about": ABOUT, "intro": INTRO, "trials": trials}) + ";\n")
    for path in (f"{LOCAL}/measurements.json", f"{PAGE}/measurements.json"):
        with open(path, "w", encoding="utf8") as f:
            json.dump({"leadToMix": leads, "contenders": measurements}, f, indent=1)
    print("done", len(trials), "trials")


if __name__ == "__main__":
    main(sys.argv[1:] or SONGS)
