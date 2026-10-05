"""Build aligned real vocal/accompaniment inputs; no synthesized audio or effects."""
import hashlib
import json
from math import gcd
from pathlib import Path

import numpy as np
import soundfile as sf
from scipy.signal import resample_poly
from huggingface_hub import hf_hub_download

root = Path("data/vocal-mix-pilot").resolve()
root.mkdir(parents=True, exist_ok=True)
revision = "ac28ccd742b5cf1380838098b7921f4ebc82d041"
existing = Path("data/afx-rep-real-stems/downloads")
names = ["LeadVoc.wav", "Bass DI.wav", "Act Guit.L.wav", "Kin.wav", "SnT1.wav", "Hat.wav", "Keys2 (edit).wav"]
files = {}
for name in names:
    relative = f"Evaluation/audio/LeadMeRaw/{name}"
    file = existing / relative
    if not file.exists():
        file = Path(hf_hub_download("sparrowreivun/Mix-Evaluation-Dataset-2.0", relative,
                                   repo_type="dataset", revision=revision, local_dir=root / "downloads"))
    files[name] = file
    print(f"Source ready: {name}", flush=True)
with sf.SoundFile(files["LeadVoc.wav"]) as source:
    rate = source.samplerate
    energy = [float(np.mean(x ** 2)) for x in source.blocks(blocksize=rate)]
    start = int(np.argmax(np.convolve(energy, np.ones(40), mode="valid")))
decoded, provenance = {}, []
for name, file in files.items():
    with sf.SoundFile(file) as source:
        if source.samplerate != rate:
            raise RuntimeError("The raw source rates differ")
        source.seek(start * rate)
        x = source.read(40 * rate, always_2d=True)
    d = gcd(rate, 48000)
    x = resample_poly(x, 48000 // d, rate // d, axis=0)[:40 * 48000]
    if len(x) != 40 * 48000:
        raise RuntimeError("Insufficient aligned audio")
    decoded[name] = x.mean(axis=1)
    provenance.append({"name": name, "file": str(file.resolve()),
                       "sha256": hashlib.sha256(file.read_bytes()).hexdigest(), "original_rate": rate})
vocal = decoded["LeadVoc.wav"][:, None]
# A documented accompaniment subset, not the engineer's original finished mix.
instrumental = np.zeros((len(vocal), 2))
for name in names[1:]:
    x = decoded[name]
    pan = -.25 if name == "Act Guit.L.wav" else .25 if name == "Keys2 (edit).wav" else 0
    instrumental[:, 0] += x * np.sqrt((1 - pan) / 2)
    instrumental[:, 1] += x * np.sqrt((1 + pan) / 2)
gains = {}
for name, x, peak_db in [("vocal", vocal, -12), ("instrumental", instrumental, -9)]:
    gain = 10 ** (peak_db / 20) / max(float(np.abs(x).max()), 1e-8)
    x *= gain
    x[:480] *= np.linspace(0, 1, 480)[:, None]
    x[-2400:] *= np.linspace(1, 0, 2400)[:, None]
    sf.write(root / f"{name}.wav", x, 48000, subtype="FLOAT")
    gains[name] = float(20 * np.log10(gain))
manifest = {"song": "Lead Me", "artist": "The DoneFors", "license": "CC BY 3.0",
            "license_source": f"https://huggingface.co/datasets/sparrowreivun/Mix-Evaluation-Dataset-2.0/resolve/{revision}/Evaluation/MixEvaluation/songs.xml",
            "dataset_revision": revision, "excerpt_start_seconds": start, "seconds": 40,
            "sources": provenance, "gains_db": gains,
            "limitations": ["Recorded acoustic accompaniment; not an EDM/trap quality benchmark",
                             "Instrumental is a six-stem reconstruction, not a released finished mix"],
            "modifications": "Aligned excerpt, resampling, scalar calibration, accompaniment summing/pan and boundary fades; no synthetic sources or Python effects"}
(root / "source-manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
print(root, flush=True)
