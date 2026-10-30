"""The mastering round's contenders, each made from a song's premaster (your mix, master chain off) and pushed to the
loudness of your own master, so they spend the same loudness budget and differ only in how they get there."""
import os
import tempfile
import numpy as np
import pedalboard as pb
import matchering as mg
import dsp

CEILING = -0.5
REFERENCE = "reference.wav"  # a finished master to match: not kept in the repo
CENTRES = np.array([31.5, 63, 125, 250, 500, 1000, 2000, 4000, 8000, 16000])
BANDS = [(c / 2**0.5, c * 2**0.5) for c in CENTRES]
# Mean of two engineer masters, dB re 1 kHz, same measure as dsp.ltas.
TARGET = np.array([19.5, 21.7, 10.0, 5.7, 4.3, 0.0, -2.5, -6.8, -11.5, -19.7])


def final(x, target):
    """The same last stage for every contender: a soft clipper takes the peaks a limiter alone can't (it stalls well short
    of a trap master's loudness), the limiter catches what's left between samples."""
    return dsp.push_to(x, target, lambda y: dsp.limit(dsp.soft_clip(y, CEILING), CEILING))


def tonal_eq(x, max_db=3.0, passes=2, boost_highs=True):
    """Octave EQ toward the target curve, at most ±max_db per band in total: correction, not a new sound. Without
    boost_highs, bands from 2 kHz up may only be cut (round 1: anything brightened read as tinny)."""
    total = np.zeros(len(CENTRES))
    top = np.where(CENTRES >= 2000, 0.0 if not boost_highs else max_db, max_db)
    for _ in range(passes):
        spec = dsp.ltas(x, BANDS)
        spec -= spec[5]
        want = np.clip(total + (TARGET - spec), -max_db, top) - total
        for i, (c, g) in enumerate(zip(CENTRES, want)):
            if abs(g) < 0.2:
                continue
            sos = dsp.shelf(c * 1.4, g, False) if i == 0 else dsp.shelf(c / 1.4, g, True) if i == len(CENTRES) - 1 \
                else dsp.peaking(c, g, 1.4)
            x = dsp.filt(x, sos)
        total += want
    return x


def mono_bass(x, f=120):
    mid, side = (x[:, 0] + x[:, 1]) / 2, (x[:, 0] - x[:, 1]) / 2
    side = dsp.filt(side[:, None], dsp.hpf(f, 2))[:, 0]
    return np.stack([mid + side, mid - side], axis=1).astype(np.float32)


def glue(x, gr=1.5):
    return dsp.compress(x, 1.5, gr, 30, 150, pct=95)


def bands3(x, lo=120, hi=2500):
    """Linkwitz–Riley 4th-order split into three bands that sum back flat in magnitude."""
    low = dsp.filt(dsp.filt(x, dsp.lpf(lo, 2)), dsp.lpf(lo, 2))
    rest = dsp.filt(dsp.filt(x, dsp.hpf(lo, 2)), dsp.hpf(lo, 2))
    mid = dsp.filt(dsp.filt(rest, dsp.lpf(hi, 2)), dsp.lpf(hi, 2))
    high = dsp.filt(dsp.filt(rest, dsp.hpf(hi, 2)), dsp.hpf(hi, 2))
    return low, mid, high


def widen(x, lo=2000, hi=10000, gain_db=2.0):
    mid, side = (x[:, 0] + x[:, 1]) / 2, (x[:, 0] - x[:, 1]) / 2
    band = dsp.filt(side[:, None], dsp.bpf(lo, hi))[:, 0]
    side = side + band * (dsp.undb(gain_db) - 1)
    return np.stack([mid + side, mid - side], axis=1).astype(np.float32)


# Contenders -------------------------------------------------------------------------------------------------------

def clip_and_limit(pre, target):
    return final(pre, target)


def rule_chain(pre, target):
    x = tonal_eq(pre)
    x = mono_bass(x)
    x = glue(x)
    return final(x, target)


def matchering(pre, target):
    with tempfile.TemporaryDirectory() as d:
        src, out = os.path.join(d, "in.wav"), os.path.join(d, "out.wav")
        dsp.write(src, pre)
        mg.log(lambda *_: None)
        mg.process(target=src, reference=REFERENCE, results=[mg.Result(out, subtype="FLOAT", use_limiter=False)])
        x = dsp.read(out)
    return final(x, target)


def loud_and_wide(pre, target):
    low, mid, high = bands3(pre)
    # Each band's dynamics are tightened, then it's put back at its own loudness (makeup), so the balance holds.
    low = dsp.gain_to(dsp.compress(low, 3, 3, 20, 150), dsp.lufs(low))
    mid = dsp.gain_to(dsp.compress(mid, 3, 3, 10, 100), dsp.lufs(mid))
    high = dsp.gain_to(dsp.compress(high, 3, 3, 5, 60), dsp.lufs(high))
    high = high + 0.15 * np.tanh(high * 4) / 4  # a little harmonic excitement up top
    x = widen(mono_bass(low + mid + high))
    x = dsp.filt(x, dsp.shelf(10000, 1.5, True))
    return final(x, target)


def contenders(pre, yours):
    target = dsp.lufs(yours)
    return target, {
        "your-master": yours,
        "clip-and-limit": clip_and_limit(pre, target),
        "rule-chain": rule_chain(pre, target),
        "matchering": matchering(pre, target),
        "loud-and-wide": loud_and_wide(pre, target),
    }
