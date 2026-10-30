"""Loads a song's stems and works out each one's role (kick, 808, vocal…) from its name, then its sound."""
import os
import re
import numpy as np
import dsp

ROOT = "C:/Users/goali/iCloudDrive/Mixing test"

KEYWORDS = [  # first match wins
    ("bass", r"808|bass|sub\b"),
    ("kick", r"kick"),
    ("snare", r"snare|clap|rim"),
    ("oh", r"\boh\b|open"),
    ("hats", r"\bhh\b|hat"),
    ("perc", r"perc|shaker|tamb|chime"),
    ("fx", r"\bfx\b|riser|impact|sweep"),
    ("vocal", r"vocal|vox|record"),
    ("synth", r"serum|synth|pad|lead|keys|piano|pluck|bell"),
]


class Stem:
    def __init__(self, name, audio):
        self.name, self.audio = name, audio
        self.role = None
        self.lead = False

    def __repr__(self):
        return f"{self.name}:{self.role}{'*' if self.lead else ''}"


def classify(stem):
    label = re.sub(r"^\d+_", "", stem.name).replace("_", " ").lower()
    for role, rx in KEYWORDS:
        if re.search(rx, label):
            return role
    # No telling name (a kick sample called "pbs amped up"): judge by the sound.
    low = dsp.band_share(stem.audio, 20, 150)
    lv = dsp.active_levels(stem.audio, 0.05)
    crest = float(np.percentile(lv, 99) - np.median(lv)) if len(lv) else 0
    if low > 0.5 and crest > 12:
        return "kick"
    if low > 0.6:
        return "bass"
    return "synth" if crest < 15 else "perc"


def load(song):
    d = f"{ROOT}/{song}/stems"
    stems = [Stem(os.path.splitext(f)[0], dsp.read(f"{d}/{f}")) for f in sorted(os.listdir(d)) if f.endswith(".wav")]
    n = max(len(s.audio) for s in stems)
    for s in stems:
        if len(s.audio) < n:
            s.audio = np.pad(s.audio, ((0, n - len(s.audio)), (0, 0)))
        s.role = classify(s)
        # A synth that is mostly sub is the bass line.
        if s.role == "synth" and dsp.band_share(s.audio, 20, 120) > 0.55:
            s.role = "bass"
    mark_leads(stems)
    return stems


def activity(x, win_s=0.25):
    lv = dsp.short_term_db(x, win_s)
    return lv > lv.max() - 25, lv


def mark_leads(stems):
    """A vocal stem is a lead where it sings with no louder vocal over it (lead takes split across inserts by section);
    one that mostly sits under a louder one is a double or ad-lib."""
    vox = [s for s in stems if s.role == "vocal"]
    if not vox:
        return
    acts = {s.name: activity(s.audio) for s in vox}
    for s in vox:
        act, lv = acts[s.name]
        alone = act.copy()
        for o in vox:
            if o is s:
                continue
            oact, olv = acts[o.name]
            alone &= ~(oact & (olv > lv + 2))
        s.lead = act.sum() > 0 and alone.sum() / act.sum() > 0.5
    if not any(s.lead for s in vox):
        max(vox, key=lambda s: dsp.lufs(s.audio)).lead = True


if __name__ == "__main__":
    import sys
    for song in sys.argv[1:]:
        stems = load(song)
        print(song)
        for s in stems:
            print(f"  {s.name:32} {s.role:6}{' lead' if s.lead else ''}  {dsp.lufs(s.audio):6.1f} LUFS  low {dsp.band_share(s.audio, 20, 150):.2f}")
