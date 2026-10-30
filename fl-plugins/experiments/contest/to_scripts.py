"""Turns the blind test's FLAC clips into the script clips the page now loads (same ids, so saved ratings carry over)."""
import os
import soundfile as sf
import build

d = f"{build.PAGE}/audio"
for f in sorted(os.listdir(d)):
    if f.endswith(".flac"):
        fid = f[:-5]
        y, _ = sf.read(f"{d}/{f}", dtype="float32", always_2d=True)
        build.write_clip(fid, y)
        os.remove(f"{d}/{f}")
print(len([f for f in os.listdir(d) if f.endswith(".js")]), "clips")
