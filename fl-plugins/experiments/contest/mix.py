"""The mixing round's contenders, each built from a song's stems and finished by the same neutral master."""
import numpy as np
import pedalboard as pb
import dsp

OVERRIDES = {"song3/06_pbs_amped_up": "kick"}  # a kick sample with no telling name (its file is in the kit's Kicks folder)

# Two-stage balance: each group's summed loudness (LUFS, before the master), members equal within it.
TARGETS = {"vocal_lead": -18, "vocal_bg": -24, "bass": -18, "kick": -20, "snare": -22, "synth": -22,
           "hats": -28, "oh": -30, "perc": -29, "fx": -31}
NO_VOCAL_SYNTH = -19  # with no vocal, the melody carries the song

MIX_LUFS, MIX_CEILING = -9.0, -1.0


def group_of(s):
    return ("vocal_lead" if s.lead else "vocal_bg") if s.role == "vocal" else s.role


def neutral_master(x):
    return dsp.push_to(x, MIX_LUFS, lambda y: dsp.limit(dsp.soft_clip(y, MIX_CEILING), MIX_CEILING))


def total(tracks):
    return np.sum(tracks, axis=0).astype(np.float32)


# Contenders -------------------------------------------------------------------------------------------------------

def your_balance(stems):
    return total([s.audio for s in stems])


def equal_loudness(stems):
    return total([dsp.gain_to(s.audio, -30) for s in stems])


def balance(stems, tracks):
    """Scales tracks (one per stem) so each group reaches its target, members level with each other."""
    has_vocal = any(s.role == "vocal" for s in stems)
    groups = {}
    for s, t in zip(stems, tracks):
        groups.setdefault(group_of(s), []).append(dsp.gain_to(t, -30))
    out = []
    for g, members in groups.items():
        target = NO_VOCAL_SYNTH if g == "synth" and not has_vocal else TARGETS[g]
        mix = total(members)
        gain = dsp.undb(target - dsp.lufs(mix))
        out += [m * gain for m in members]
    return total(out)


def rule_balance(stems):
    return balance(stems, [s.audio for s in stems])


def tame_resonances(x, lo=150, hi=8000, max_cuts=3):
    """Cuts narrow peaks that stand more than 5 dB over the stem's own octave-smoothed spectrum: EQ only where the
    measurement shows an excess, never a blind preset."""
    edges = lo * 2 ** (np.arange(0, np.log2(hi / lo) * 6 + 1) / 6)
    bands = list(zip(edges[:-1], edges[1:]))
    spec = dsp.ltas(x, bands)
    smooth = np.convolve(np.pad(spec, 3, mode="edge"), np.ones(7) / 7, mode="valid")
    excess = spec - smooth
    cuts = []
    for i in np.argsort(-excess):
        if excess[i] < 5 or len(cuts) >= max_cuts:
            break
        if all(abs(i - j) > 2 for j, _ in cuts):
            cuts.append((i, min(6.0, excess[i] - 3)))
    for i, cut in cuts:
        x = dsp.filt(x, dsp.peaking(np.sqrt(bands[i][0] * bands[i][1]), -cut, 4.0))
    return x


def de_ess(x):
    key = dsp.envelope(dsp.filt(x, dsp.bpf(5000, 9000)), 5)
    return dsp.duck_band(x, key, 5000, 10000, 5, sensitivity_pct=85)


def process(stems, song):
    """Per-stem cleanup every engineer does: high-passes, measured resonance cuts, compression by role, de-essing, the
    808 ducking under the kick, the music dipping in the vocal's presence band while it sings, mono percussion spread."""
    for s in stems:
        s.role = OVERRIDES.get(f"{song}/{s.name}", s.role)
    kicks = [s.audio for s in stems if s.role == "kick"]
    kick_env = dsp.envelope(total(kicks), 3) if kicks else None
    leads = [s.audio for s in stems if s.role == "vocal" and s.lead]
    vocal_env = dsp.envelope(total(leads), 30) if leads else None
    out, pans = [], {"hats": [0.15, -0.2], "oh": [-0.25, 0.25], "perc": [0.3, -0.3, 0.2, -0.2], "vocal_bg": [-0.35, 0.35]}
    for s in stems:
        x, g = s.audio, group_of(s)
        if g == "vocal_lead":
            x = dsp.filt(x, dsp.hpf(90))
            x = tame_resonances(x)
            x = de_ess(x)
            x = dsp.compress(x, 3, 5, 5, 80)
        elif g == "vocal_bg":
            x = dsp.filt(x, dsp.hpf(150))
            x = tame_resonances(x)
            x = de_ess(x)
            x = dsp.compress(x, 3, 4, 5, 80)
        elif g == "bass":
            x = dsp.compress(x, 3, 3, 20, 150)
            if kick_env is not None:
                amt = np.clip(kick_env / (np.percentile(kick_env, 99) + 1e-9), 0, 1)
                x = x * dsp.undb(-4 * amt)[:, None]
        elif g == "kick":
            x = dsp.filt(x, dsp.hpf(25, 2))
            x = dsp.compress(x, 2, 2, 10, 60)
        elif g == "snare":
            x = dsp.filt(x, dsp.hpf(120, 2))
            x = tame_resonances(x)
            x = dsp.compress(x, 2, 2, 10, 80)
        elif g in ("hats", "oh"):
            x = dsp.filt(x, dsp.hpf(300))
        elif g == "perc":
            x = dsp.filt(x, dsp.hpf(200))
            x = tame_resonances(x)
        elif g == "fx":
            x = dsp.filt(x, dsp.hpf(150))
        elif g == "synth":
            x = dsp.filt(x, dsp.hpf(40 if dsp.band_share(x, 20, 150) > 0.2 else 120))
            x = tame_resonances(x)
            x = dsp.compress(x, 2, 2, 20, 150)
            if vocal_env is not None:
                x = dsp.duck_band(x, vocal_env, 1500, 5000, 3)
        if g in pans and dsp.correlation(x) > 0.95 and pans[g]:
            x = dsp.pan(x, pans[g].pop(0))
        out.append(x.astype(np.float32))
    return out


def vocal_space(stems, tracks):
    """A plate on the lead vocal, filtered, 16 LU under it."""
    leads = [t for s, t in zip(stems, tracks) if s.role == "vocal" and s.lead]
    if not leads:
        return None
    dry = total(leads)
    send = dsp.filt(dsp.filt(dry, dsp.hpf(300, 2)), dsp.lpf(8000, 2))
    wet = pb.Reverb(room_size=0.45, damping=0.5, wet_level=1.0, dry_level=0.0, width=1.0)(send.T.copy(), dsp.SR).T
    return dsp.gain_to(wet.astype(np.float32), dsp.lufs(dry) - 16)


def glue(x):
    return dsp.compress(x, 2, 2, 30, 200, pct=95)


def full_chain(stems, tracks):
    mix = balance(stems, tracks)
    # The reverb is set against the lead vocal at its balanced level.
    leads_lufs = TARGETS["vocal_lead"]
    space = vocal_space(stems, tracks)
    if space is not None:
        mix = mix + dsp.gain_to(space, leads_lufs - 16)
    return glue(mix)


def your_balance_fixed(stems, tracks):
    """Your levels, kept: each processed stem is matched back to the loudness it had, then the same bus glue."""
    kept = [dsp.gain_to(t, dsp.lufs(s.audio)) if np.isfinite(dsp.lufs(s.audio)) else t for s, t in zip(stems, tracks)]
    return glue(total(kept))


def contenders(stems, song):
    tracks = process(stems, song)
    raw = {
        "your-balance": your_balance(stems),
        "equal-loudness": equal_loudness(stems),
        "rule-balance": rule_balance(stems),
        "full-chain": full_chain(stems, tracks),
        "your-balance-fixed": your_balance_fixed(stems, tracks),
    }
    return {k: neutral_master(v) for k, v in raw.items()}
