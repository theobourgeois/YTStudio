"""Auto Mix's ears and judgement: reads FL Studio's split mixer stems, works out what each insert is and how loud it
reaches the master, and decides new fader levels with the rule that won the blind tests:

- the song's sounds go in groups (lead vocal, backing vocals, 808/bass, kick, snare, synths, hats, open hats, perc, fx)
  and each group gets a set loudness against the others;
- inside a group your own balance stays as it is (the whole group moves by one amount);
- the lead (the main vocal, or the synths when there's no vocal) sits 3 dB over its group target;
- the song as a whole stays as loud as it was, so your master chain sees what it saw before.

Only leaf inserts (the ones sounds play into) move; buses and their effects stay as they are, and the stems tell how
much each bus turns its inputs up or down (its fader and its effects together).

Stems are read in chunks, so a long song with many inserts takes little memory.
"""
import json
import os
import re

import numpy as np
import soundfile as sf
from scipy.signal import lfilter

HERE = os.path.dirname(os.path.abspath(__file__))
CHUNK_S = 10.0

KEYWORDS = [  # first match wins
    ("bass", r"808|bass|\bsub\b"),
    ("kick", r"kick|\bbd\b"),
    ("snare", r"snare|clap|\brim"),
    ("oh", r"\boh\b|open|crash|cymbal|ride"),
    ("hats", r"\bhh\b|hat"),
    ("perc", r"perc|shaker|tamb|chime|conga|bongo|tom\b|\bcowbell"),
    ("fx", r"\bfx\b|riser|impact|sweep|noise|uplift|downlift|transition"),
    ("vocal", r"vocal|vox|record|voice|adlib|ad lib|\bdbl\b|double|harmony|backing|\bbgv|\bvoc\b"),
    ("synth", r"serum|synth|pad|lead|keys|piano|pluck|bell|chord|arp|guitar|string|organ|rhodes|melody|flute|brass|"
              r"sytrus|vital|nexus|omnisphere|kontakt|massive|sylenth|harmor|pigments|diva|keyscape"),
]
ROLES = ["vocal", "bass", "kick", "snare", "synth", "hats", "oh", "perc", "fx"]
ROLE_NAMES = {"vocal": "Vocal", "bass": "808 / bass", "kick": "Kick", "snare": "Snare / clap", "synth": "Synth / melody",
              "hats": "Hats", "oh": "Open hat / cymbal", "perc": "Perc", "fx": "FX"}

# Each group's loudness (LUFS of its part of the mix) relative to the others; only the differences matter.
TARGETS = {"vocal_lead": -18, "vocal_bg": -24, "bass": -18, "kick": -20, "snare": -22, "synth": -22,
           "hats": -28, "oh": -30, "perc": -29, "fx": -31}
NO_VOCAL_SYNTH = -19  # with no vocal, the melody carries the song
GROUP_NAMES = {"vocal_lead": "Lead vocal", "vocal_bg": "Backing vocals", "bass": "808 / bass", "kick": "Kick",
               "snare": "Snare / clap", "synth": "Synths", "hats": "Hats", "oh": "Open hats", "perc": "Perc",
               "fx": "FX"}

DEFAULTS = {"lead_boost": 3.0, "kick_boost": 0.0}


def db(x):
    return 20 * np.log10(np.maximum(x, 1e-12))


def undb(d):
    return 10 ** (d / 20)


# Loudness ---------------------------------------------------------------------------------------------------------

def _k_filters(fs):
    """BS.1770's K-weighting (a high shelf, then a high-pass) at any sample rate, as pyloudnorm builds it."""
    import pyloudnorm as pyln
    f = pyln.Meter(fs)._filters
    return [(f[k].b, f[k].a) for k in ("high_shelf", "high_pass")]


class Blocks:
    """Mean square per fixed-length block of a stream of per-sample powers."""

    def __init__(self, n):
        self.n, self.rest, self.out = n, np.zeros(0), []

    def feed(self, p):
        p = np.concatenate([self.rest, p]) if len(self.rest) else p
        k = len(p) // self.n
        if k:
            self.out.append(p[: k * self.n].reshape(k, self.n).mean(axis=1))
        self.rest = p[k * self.n:]

    def values(self):
        return np.concatenate(self.out) if self.out else np.zeros(0)


class Meter:
    """Integrated loudness (BS.1770-4, gated), fed a chunk at a time."""

    def __init__(self, fs, channels=2):
        self.filters = _k_filters(fs)
        self.zi = [[np.zeros(2) for _ in range(channels)] for _ in self.filters]
        self.blocks = Blocks(int(round(0.1 * fs)))

    def feed(self, x):
        p = 0.0
        for c in range(x.shape[1]):
            y = x[:, c].astype(np.float64)
            for i, (b, a) in enumerate(self.filters):
                y, self.zi[i][c] = lfilter(b, a, y, zi=self.zi[i][c])
            p = p + y * y
        self.blocks.feed(p)

    def lufs(self):
        sub = self.blocks.values()
        if len(sub) < 4:
            return -np.inf
        z = np.convolve(sub, np.ones(4) / 4, mode="valid")  # 400 ms blocks, 75% overlap
        loud = -0.691 + 10 * np.log10(np.maximum(z, 1e-20))
        z = z[loud > -70]
        if not len(z):
            return -np.inf
        rel = -0.691 + 10 * np.log10(z.mean()) - 10
        z = z[-0.691 + 10 * np.log10(z) > rel]
        return float(-0.691 + 10 * np.log10(z.mean())) if len(z) else -np.inf


# What a group sounds like, for the learned targets ----------------------------------------------------------------

FEATURES = ["members", "density", "brightness", "low", "crest", "overlap"]
_SPEC_N = 4096


class GroupFeatures:
    """A group's character, fed its summed signal a chunk at a time: how many inserts it has, how much of the song it
    plays in (density), how bright it is (spectral centroid, octaves over 1 kHz), how much of it is under 150 Hz,
    how punchy (crest: loud moments over the typical level) and how much it plays over the lead vocal (overlap)."""

    def __init__(self, fs, members=1):
        self.fs, self.members = fs, members
        self.blocks = Blocks(int(round(0.4 * fs)))
        self.short = Blocks(int(round(0.05 * fs)))
        self.spec = np.zeros(_SPEC_N // 2 + 1)

    def feed(self, x):
        m = x.astype(np.float64).mean(axis=1)
        p = m * m
        self.blocks.feed(p)
        self.short.feed(p)
        win = np.hanning(_SPEC_N)
        for at in range(0, len(m) - _SPEC_N, _SPEC_N * 4):  # a quarter of the frames is plenty for an average
            self.spec += np.abs(np.fft.rfft(m[at:at + _SPEC_N] * win)) ** 2

    def active(self):
        """Its 400 ms blocks within 20 dB of its loud ones."""
        lv = 10 * np.log10(np.maximum(self.blocks.values(), 1e-20))
        return lv > np.percentile(lv, 95) - 20 if len(lv) else np.zeros(0, bool)

    def values(self, lead_active=None):
        f = np.fft.rfftfreq(_SPEC_N, 1 / self.fs)
        tot = self.spec[f >= 20].sum() + 1e-20
        centroid = float((self.spec * f)[f >= 20].sum() / tot)
        lv = 10 * np.log10(np.maximum(self.short.values(), 1e-20))
        lv = lv[lv > lv.max() - 30] if len(lv) else lv
        act = self.active()
        overlap = 0.0
        if lead_active is not None and len(act):
            n = min(len(act), len(lead_active))
            overlap = float((act[:n] & lead_active[:n]).sum() / max(act[:n].sum(), 1))
        return {"members": float(np.log2(1 + self.members)),
                "density": float(act.mean()) if len(act) else 0.0,
                "brightness": float(np.log2(max(centroid, 20.0) / 1000)),
                "low": float(self.spec[(f >= 20) & (f < 150)].sum() / tot),
                "crest": float(np.percentile(lv, 99) - np.median(lv)) if len(lv) else 0.0,
                "overlap": overlap}


TRAINING = os.path.join(os.path.expanduser("~"), "Documents", "YTStudio Auto Mix", "training")
MODEL = os.path.join(TRAINING, "model.json")


def rule_target(g, has_vocal=True):
    """The fixed rules' target for group g, with the default lead boost: what the learned model starts from."""
    lead = "vocal_lead" if has_vocal else "synth"
    t = NO_VOCAL_SYNTH if g == "synth" and not has_vocal else TARGETS[g]
    return t + (DEFAULTS["lead_boost"] if g == lead else 0.0)


def load_model(path=MODEL):
    """The targets learned from your own mixes (train/learn.py writes it), or None."""
    try:
        with open(path) as f:
            m = json.load(f)
        return m if m.get("version") == 1 else None
    except (OSError, ValueError):
        return None


def learned_shift(model, g, feats):
    """How many dB the learned model moves group g's target from the rules', for a group that sounds like feats."""
    d = float(model["offsets"].get(g, 0.0))
    r = model.get("ridge")
    if r and feats:
        x = np.array([(feats.get(k, 0.0) - mu) / sd for k, mu, sd in zip(r["features"], r["mean"], r["std"])])
        d += float(np.dot(r["w"], x))
    return d


# FL Studio --------------------------------------------------------------------------------------------------------

_curve = None


def _fader_curve():
    """FL's fader law: dB at 0, 0.001 … 1 on its 0–1 scale, measured off FL's own faders."""
    global _curve
    if _curve is None:
        with open(os.path.join(HERE, "fader_curve.json")) as f:
            _curve = np.array(json.load(f), dtype=float)
    return _curve


def route_db(level):
    """A send's level (FL's 0–1 fader scale, 0.8 = 0 dB) in dB."""
    if level is None:
        return 0.0
    _curve = _fader_curve()
    x = min(max(float(level), 0.0), 1.0) * (len(_curve) - 1)
    i = int(x)
    if i >= len(_curve) - 1:
        return float(_curve[-1])
    lo, hi = _curve[i], _curve[i + 1]
    if not np.isfinite(lo):
        return -np.inf if x == i else float(hi + 20 * np.log10(x - i))
    return float(lo + (hi - lo) * (x - i))


def db_to_value(d):
    """The 0–1 fader value that gives d dB (the inverse of route_db), what FL's setTrackVolume takes."""
    c = _fader_curve()
    if not np.isfinite(d) or d <= c[1]:
        return 0.0 if not np.isfinite(d) or d < c[1] - 20 else float(undb(d - c[1]) / (len(c) - 1))
    if d >= c[-1]:
        return 1.0
    x = np.arange(len(c))[1:] / (len(c) - 1)
    return float(np.interp(d, c[1:], x))


def _key(name):
    return re.sub(r"[^0-9a-z]+", "", name.lower())


def match_stems(folder, state, project=None):
    """Which stem file is which insert. FL names them '<project>_<insert name>.wav', inserts sharing a name get _2, _3…
    in insert order, and the master is '<project>_Master.wav'. Returns ({insert index: path}, master path, unmatched
    file names)."""
    files = sorted(f for f in os.listdir(folder) if f.lower().endswith(".wav"))
    if not files:
        raise ValueError("There are no .wav files in %s." % folder)
    stems = [f[:-4] for f in files]
    prefix = None
    for s in stems:
        if s.lower().endswith("_master"):
            prefix = s[: -len("Master")]
    if prefix is None and project and all(s.startswith(project + "_") for s in stems):
        prefix = project + "_"
    if prefix is None:
        common = os.path.commonprefix(stems)
        prefix = common[: common.rfind("_") + 1] if "_" in common else ""
    by_name = {}  # FL numbers inserts sharing a name across all of them, in insert order
    for t in state["tracks"]:
        by_name.setdefault(_key(t["name"]), []).append(t["index"])
    found, master, unmatched = {}, None, []
    for f, s in zip(files, stems):
        label = s[len(prefix):] if s.startswith(prefix) else s
        if label.lower() == "master":
            master = os.path.join(folder, f)
            continue
        idx = None
        cands = by_name.get(_key(label))
        if cands and len(cands) == 1:
            idx = cands[0]
        else:
            m = re.match(r"^(.*)_(\d+)$", label)
            base, n = (m.group(1), int(m.group(2))) if m else (label, 1)
            cands = by_name.get(_key(base)) or []
            if 1 <= n <= len(cands):
                idx = cands[n - 1]
        if idx is None or idx in found:
            unmatched.append(f)
        else:
            found[idx] = os.path.join(folder, f)
    return found, master, unmatched


def classify_name(*names):
    for name in names:
        label = re.sub(r"[_\[\]()#-]+", " ", name.lower())
        for role, rx in KEYWORDS:
            if re.search(rx, label):
                return role
    return None


CLIP = 0.9999  # a sample at full scale in a fixed-point stem (16-bit's largest is 0.99997)

# Reading ----------------------------------------------------------------------------------------------------------

class Stems:
    """Several stems read side by side in chunks, the ones that end early padded with silence."""

    def __init__(self, paths):
        self.paths = dict(paths)
        rates = set()
        self.frames = 0
        for p in self.paths.values():
            info = sf.info(p)
            rates.add(info.samplerate)
            self.frames = max(self.frames, info.frames)
        if len(rates) > 1:
            raise ValueError("The stems have different sample rates (%s): export them again in one go." %
                             ", ".join(str(r) for r in sorted(rates)))
        self.fs = rates.pop()
        # 16- and 24-bit files stop at full scale, and FL's stems are post-fader: a stem whose insert runs over 0 dB is
        # clipped in the file (not in FL), so it reads quieter than it plays. A float export keeps what's above.
        self.fixed = {k for k, p in self.paths.items() if not sf.info(p).subtype.startswith(("FLOAT", "DOUBLE"))}

    def chunks(self, keys=None, progress=None):
        keys = list(self.paths) if keys is None else keys
        files = {k: sf.SoundFile(self.paths[k]) for k in keys}
        n = int(CHUNK_S * self.fs)
        try:
            done = 0
            while done < self.frames:
                m = min(n, self.frames - done)
                out = {}
                for k, f in files.items():
                    x = f.read(m, dtype="float32", always_2d=True)
                    if x.shape[1] == 1:
                        x = np.repeat(x, 2, axis=1)
                    elif x.shape[1] > 2:
                        x = x[:, :2]
                    if len(x) < m:
                        x = np.pad(x, ((0, m - len(x)), (0, 0)))
                    out[k] = x
                done += m
                yield out
                if progress:
                    progress(done / self.frames)
        finally:
            for f in files.values():
                f.close()


# The analysis -----------------------------------------------------------------------------------------------------

class Track:
    def __init__(self, t):
        self.index, self.name, self.db = t["index"], t["name"], t["db"]
        self.muted, self.channels = t.get("muted", False), t.get("channels", [])
        self.routes = [(r["to"], route_db(r.get("level"))) for r in t["routes"]]
        self.stem = None
        self.leaf = False
        self.inputs = []  # (insert, route dB)
        self.lufs = -np.inf
        self.gain = 0.0  # a bus: its stem's loudness over its inputs' (fader and effects)
        self.path = None  # dB from this insert's stem to the master
        self.role = self.auto_role = None
        self.role_from = ""
        self.lead = self.auto_lead = False
        self.low = self.sub = self.crest = 0.0
        self.ms = None  # 50 ms mean squares


class Analysis:
    """Pass 1 (`analyse`): every stem's loudness and character, every bus's gain, every leaf's path to the master,
    roles and leads. Then `plan` decides the faders (passes 2 and 3), cheap enough to run again when a role changes."""

    def __init__(self, folder, state, project=None, progress=None, log=None):
        self.folder, self.state = folder, state
        self.log = log or (lambda s: None)
        self.progress = progress or (lambda f: None)
        self.max_db = state.get("maxDb", 5.6)
        self.tracks = {t["index"]: Track(t) for t in state["tracks"]}
        self.warnings = []
        found, self.master_stem, unmatched = match_stems(folder, state, project)
        if not found:
            raise ValueError("None of the stems in this folder are named after an insert in the open project. "
                             "Export with File › Export › WAV and \"Split mixer tracks\" on, from this project.")
        for f in unmatched:
            self.warnings.append("%s doesn't match an insert in this project: left out." % f)
        for i, p in found.items():
            self.tracks[i].stem = p
        self.stems = Stems(found)
        for t in self.tracks.values():
            for to, d in t.routes:
                if to in self.tracks:
                    self.tracks[to].inputs.append((t.index, d))
        for t in self.tracks.values():
            fed = [i for i, _ in t.inputs if self.tracks[i].stem]
            t.leaf = bool(t.stem) and not fed
            if t.stem and fed and t.channels:
                self.warnings.append("Insert %d (%s) plays its own sound and takes other inserts too: it's treated "
                                     "as a bus and left alone." % (t.index, t.name))

    # Pass 1

    def analyse(self):
        fs = self.stems.fs
        meters = {i: Meter(fs) for i in self.stems.paths}
        buses = [t for t in self.tracks.values() if t.stem and not t.leaf]
        bus_in = {b.index: Meter(fs) for b in buses}
        rms = {i: Blocks(int(round(0.05 * fs))) for i in self.stems.paths}
        first = {i: [] for i in self.stems.paths}
        first_n = int(60 * fs)
        clipped = {i: 0 for i in self.stems.fixed}
        got = 0
        self.log("Listening to %d stems…" % len(self.stems.paths))
        for chunk in self.stems.chunks(progress=lambda f: self.progress(0.6 * f)):
            for i, x in chunk.items():
                meters[i].feed(x)
                if i in clipped:
                    clipped[i] += int(np.count_nonzero(np.abs(x) >= CLIP))
                rms[i].feed(np.mean(x.astype(np.float64) ** 2, axis=1))
                if got < first_n:
                    first[i].append(x[: first_n - got].mean(axis=1))
            for b in buses:
                s = None
                for i, d in b.inputs:
                    if i in chunk and np.isfinite(d):
                        part = chunk[i] * undb(d)
                        s = part if s is None else s + part
                if s is not None:
                    bus_in[b.index].feed(s)
            got += len(next(iter(chunk.values())))
        for i, t in self.tracks.items():
            if i not in meters:
                continue
            t.lufs = meters[i].lufs()
            t.ms = rms[i].values()
            m = np.concatenate(first[i]) if first[i] else np.zeros(1)
            spec = np.abs(np.fft.rfft(m)) ** 2
            f = np.fft.rfftfreq(len(m), 1 / fs)
            tot = spec.sum() + 1e-20
            t.low = float(spec[(f >= 20) & (f < 150)].sum() / tot)
            t.sub = float(spec[(f >= 20) & (f < 120)].sum() / tot)
            lv = 10 * np.log10(np.maximum(t.ms, 1e-20))
            lv = lv[lv > lv.max() - 30] if len(lv) else lv
            t.crest = float(np.percentile(lv, 99) - np.median(lv)) if len(lv) else 0.0
        frames = self.stems.frames * 2
        over = [i for i, n in clipped.items() if n > max(50, 1e-5 * frames)]
        if over:
            names = ", ".join("%d %s" % (i, self.tracks[i].name) for i in sorted(over)[:5])
            self.warnings.append(
                "Clipped in the stems (they run over 0 dB, and a 16/24-bit file can't hold that): %s%s. Their levels "
                "read low, so their moves will be off. Export again with WAV bit depth \"32Bit float\" and Analyse "
                "again." % (names, "…" if len(over) > 5 else ""))
        for b in buses:
            into = bus_in[b.index].lufs()
            if np.isfinite(into) and np.isfinite(b.lufs):
                b.gain = b.lufs - into
            else:
                b.gain = b.db
        for t in self.tracks.values():
            if not t.stem and t.inputs and any(self.tracks[i].stem for i, _ in t.inputs) and t.routes:
                t.gain = t.db  # a bus FL didn't export: its fader is all we know of it
                self.warnings.append("No stem for insert %d (%s): taking its fader (%.1f dB) as its gain."
                                     % (t.index, t.name, t.db))
        for t in self.tracks.values():
            if t.leaf:
                t.path = self._path(t.index, set())
        self._roles()
        self._leads()
        direct = [t for t in self.leaves() if any(to == 0 for to, _ in t.routes)]
        if direct and len(direct) < len(self.leaves()):
            names = ", ".join("%d %s" % (t.index, t.name) for t in direct[:4])
            self.log("Straight to the master: %s%s." % (names, "…" if len(direct) > 4 else ""))
        self.progress(0.6)
        return self

    def _path(self, i, seen):
        """dB from insert i's stem to the master along its main route (to a bus rather than a send's return when it
        has both, then the loudest)."""
        r = self._route(i, seen)
        return r[0] if r else None

    def _route(self, i, seen):
        """(_path's dB, the inserts on that route after i)."""
        if i == 0:
            return 0.0, []
        t = self.tracks.get(i)
        if t is None or i in seen or not t.routes:
            return None
        seen = seen | {i}
        own = t.gain if not t.leaf else 0.0
        opts = []
        for to, d in t.routes:
            if not np.isfinite(d):
                continue
            rest = self._route(to, seen)
            if rest is None:
                continue
            target = self.tracks.get(to)
            is_bus = to == 0 or (target is not None and not target.leaf)
            opts.append((is_bus, d, d + rest[0], [to] + rest[1]))
        if not opts:
            return None
        best = max(opts, key=lambda o: o[:3])
        return own + best[2], best[3]

    def chain(self, i):
        """The buses on leaf i's main route to the master (not the master)."""
        r = self._route(i, set())
        return [b for b in r[1] if b] if r else []

    def returns(self):
        """Buses whose stems carry sound the leaves' main routes don't: send returns (a reverb fed by sends). The
        dry sum of the leaves misses them, so a player adds them, moving with what feeds them. Returns
        [{"index", "name", "path": dB from its stem to the master, "feeds": {leaf: dB it sends, roughly}}]."""
        on_route = set()
        for t in self.leaves():
            on_route.update(self.chain(t.index))
        out = []
        for b in sorted(self.tracks.values(), key=lambda t: t.index):
            if not b.stem or b.leaf or b.index in on_route or not np.isfinite(b.lufs):
                continue
            path = self._path(b.index, set())
            if path is None:
                continue
            feeds = {}

            def walk(i, d, seen):
                t = self.tracks.get(i)
                if t is None or i in seen:
                    return
                if t.leaf:
                    if np.isfinite(t.lufs):
                        feeds[i] = max(feeds.get(i, -np.inf), t.lufs + d)
                    return
                for j, rd in t.inputs:
                    if np.isfinite(rd):
                        walk(j, d + rd + (t.gain if t.index != b.index else 0.0), seen | {i})

            walk(b.index, 0.0, set())
            if feeds:
                out.append({"index": b.index, "name": b.name, "path": path - b.gain, "feeds": feeds})
        return out

    def leaves(self):
        return [t for t in sorted(self.tracks.values(), key=lambda t: t.index) if t.leaf]

    def _roles(self):
        for t in self.leaves():
            role = classify_name(t.name)
            t.role_from = "name"
            if role is None and t.channels:
                role = classify_name(*t.channels)
                t.role_from = "channel"
            if role is None:
                t.role_from = "sound"
                if t.low > 0.5 and t.crest > 12:
                    role = "kick"
                elif t.low > 0.6:
                    role = "bass"
                else:
                    role = "synth" if t.crest < 15 else "perc"
            if role == "synth" and t.sub > 0.55:
                role, t.role_from = "bass", "sound"
            t.role = t.auto_role = role

    def _leads(self):
        """A vocal insert is a lead where it sings with no louder vocal over it (lead takes split across inserts by
        section); one that mostly sits under a louder one is a double or an ad-lib."""
        vox = [t for t in self.leaves() if t.role == "vocal" and t.ms is not None and len(t.ms)]
        for t in self.leaves():
            t.lead = False
        if not vox:
            return
        n = min(len(t.ms) for t in vox) // 5
        acts = {}
        for t in vox:
            lv = 10 * np.log10(np.maximum(t.ms[: n * 5].reshape(n, 5).mean(axis=1), 1e-20)) + (t.path or 0)
            acts[t.index] = (lv > lv.max() - 25, lv)
        for t in vox:
            act, lv = acts[t.index]
            alone = act.copy()
            for o in vox:
                if o is not t:
                    oact, olv = acts[o.index]
                    alone &= ~(oact & (olv > lv + 2))
            t.lead = bool(act.sum() > 0 and alone.sum() / act.sum() > 0.5)
        if not any(t.lead for t in vox):
            max(vox, key=lambda t: t.lufs + (t.path or 0)).lead = True
        for t in self.leaves():
            t.auto_lead = t.lead

    # Passes 2 and 3

    def group_of(self, t):
        return ("vocal_lead" if t.lead else "vocal_bg") if t.role == "vocal" else t.role

    def movable(self):
        """The leaves whose faders the plan moves: not muted, not silent, with a way to the master."""
        return [t for t in self.leaves() if not t.muted and np.isfinite(t.lufs) and t.path is not None]

    def measure_groups(self, moved=None, progress=None):
        """Each group's loudness at the master (its leaves summed along their routes) and its features, with the leaves
        in `moved` ({insert: dB}) turned by that much. Returns ({group: {"lufs", "features", "members"}}, the mix's
        LUFS)."""
        fs = self.stems.fs
        moved = moved or {}
        tracks = self.movable()
        groups = {}
        for t in tracks:
            groups.setdefault(self.group_of(t), []).append(t)
        gm = {g: Meter(fs) for g in groups}
        feats = {g: GroupFeatures(fs, len(m)) for g, m in groups.items()}
        mix = Meter(fs)
        for chunk in self.stems.chunks([t.index for t in tracks], progress=progress):
            total = None
            for g, members in groups.items():
                s = None
                for t in members:
                    part = chunk[t.index] * undb(t.path + moved.get(t.index, 0.0))
                    s = part if s is None else s + part
                gm[g].feed(s)
                feats[g].feed(s)
                total = s if total is None else total + s
            if total is not None:
                mix.feed(total)
        lead_act = feats["vocal_lead"].active() if "vocal_lead" in feats else None
        return ({g: {"lufs": gm[g].lufs(), "features": feats[g].values(lead_act),
                     "members": [t.index for t in groups[g]]} for g in groups}, mix.lufs())

    def plan(self, lead_boost=DEFAULTS["lead_boost"], kick_boost=DEFAULTS["kick_boost"], model=None):
        """New faders: each group to its target (plus the lead's boost, and what `model` learned from your mixes),
        members moving together, then everything by one amount so the song is as loud as before. Returns a dict for
        the window and the log."""
        fs = self.stems.fs
        tracks = self.movable()
        has_vocal = any(t.role == "vocal" for t in tracks)
        lead = "vocal_lead" if has_vocal else "synth"
        measured, lb_mix = self.measure_groups(progress=lambda f: self.progress(0.6 + 0.2 * f))
        change, rows_g = {}, []
        for g, m in measured.items():
            level = m["lufs"]
            target = (NO_VOCAL_SYNTH if g == "synth" and not has_vocal else TARGETS[g])
            target += (lead_boost if g == lead else 0) + (kick_boost if g == "kick" else 0)
            learned = learned_shift(model, g, m["features"]) if model else 0.0
            target += learned
            change[g] = target - level if np.isfinite(level) else 0.0
            rows_g.append({"group": g, "name": GROUP_NAMES[g], "lufs": level, "target": target, "learned": learned,
                           "features": m["features"], "members": m["members"]})
        keys = [t.index for t in tracks]
        after = Meter(fs)
        for chunk in self.stems.chunks(keys, progress=lambda f: self.progress(0.8 + 0.2 * f)):
            total = None
            for t in tracks:
                part = chunk[t.index] * undb(t.path + change[self.group_of(t)])
                total = part if total is None else total + part
            if total is not None:
                after.feed(total)
        lb, la = lb_mix, after.lufs()
        offset = lb - la if np.isfinite(lb) and np.isfinite(la) else 0.0
        room = min((self.max_db - (t.db + change[self.group_of(t)]) for t in tracks), default=0.0)
        capped = room < offset
        cap_note = None
        if capped:
            offset = room
            cap_note = ("A fader would go past FL's +%.1f dB, so the whole mix comes down %.1f dB instead "
                        "of staying as loud: turn your master up to match." % (self.max_db, lb - la - offset))
        rows = []
        for t in self.leaves():
            r = {"index": t.index, "name": t.name, "role": t.role, "autoRole": t.auto_role, "roleFrom": t.role_from,
                 "lead": t.lead, "lufs": t.lufs + (t.path or 0) if np.isfinite(t.lufs) else -np.inf,
                 "db": t.db, "muted": t.muted}
            if t in tracks:
                g = self.group_of(t)
                r.update(group=g, change=change[g] + offset, new=t.db + change[g] + offset)
            else:
                r.update(group=None, change=0.0, new=t.db,
                         why="muted" if t.muted else "silent" if not np.isfinite(t.lufs) else "no way to the master")
            rows.append(r)
        for g in rows_g:
            g["change"] = change[g["group"]] + offset
            g["after"] = g["lufs"] + g["change"]
        self.progress(1.0)
        warnings = list(self.warnings) + ([cap_note] if cap_note else [])
        silent = [t for t in self.leaves() if not t.muted and not np.isfinite(t.lufs)]
        if silent:
            warnings.append("Silent in the stems, so left as they are: %s. (Muted in the playlist, or nothing plays "
                            "there?)" % ", ".join("%d %s" % (t.index, t.name) for t in silent))
        lead_lufs = next((g["after"] for g in rows_g if g["group"] == lead), None)
        return {"rows": rows, "groups": sorted(rows_g, key=lambda g: list(TARGETS).index(g["group"])),
                "lead": lead, "mixBefore": lb, "mixAfter": la + offset, "offset": offset, "capped": capped,
                "learned": bool(model),
                "leadToMix": (lead_lufs - (la + offset)) if lead_lufs is not None else None,
                "faders": [{"index": r["index"], "db": r["new"], "value": db_to_value(r["new"])} for r in rows
                           if r["group"] and abs(r["change"]) > 0.05],
                "buses": [{"index": t.index, "name": t.name, "gain": t.gain} for t in
                          sorted(self.tracks.values(), key=lambda t: t.index) if t.stem and not t.leaf],
                "warnings": list(dict.fromkeys(warnings))}


def fmt(v, sign=False):
    if v is None or not np.isfinite(v):
        return "—"
    return ("%+.1f" if sign else "%.1f") % v


if __name__ == "__main__":
    import sys
    import time
    folder, state_path = sys.argv[1], sys.argv[2]
    with open(state_path) as f:
        state = json.load(f)
    t0 = time.time()
    a = Analysis(folder, state, log=print).analyse()
    t1 = time.time()
    p = a.plan()
    print("pass 1 %.1fs, plan %.1fs" % (t1 - t0, time.time() - t1))
    for b in p["buses"]:
        print("  bus %2d %-12s gain %s dB" % (b["index"], b["name"], fmt(b["gain"], True)))
    for r in p["rows"]:
        print("  %2d %-34s %-6s %-10s %6s LUFS  %6s -> %6s dB (%s)" % (
            r["index"], r["name"][:34], r["role"], r["group"] or r.get("why"), fmt(r["lufs"]), fmt(r["db"]),
            fmt(r["new"]), fmt(r["change"], True)))
    for g in p["groups"]:
        print("  %-15s %6s -> %6s (target %s)" % (g["name"], fmt(g["lufs"]), fmt(g["after"]), fmt(g["target"])))
    print("mix %s -> %s LUFS, lead %s LU vs mix" % (fmt(p["mixBefore"]), fmt(p["mixAfter"]), fmt(p["leadToMix"], True)))
    for w in p["warnings"]:
        print("!", w)
