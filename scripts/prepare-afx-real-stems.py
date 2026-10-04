"""Download real MED multitracks and prepare logged excerpts for native rendering."""
import hashlib
import json
import urllib.request
import xml.etree.ElementTree as ET
from math import gcd
from pathlib import Path

import numpy as np
import soundfile as sf
from scipy.signal import resample_poly
from huggingface_hub import hf_hub_download

ROOT = Path("data/afx-rep-real-stems").resolve()
REVISION = "ac28ccd742b5cf1380838098b7921f4ebc82d041"
SELECTED = [
    ("LeadMeRaw", "LeadVoc.wav", "lead-vocal"),
    ("LeadMeRaw", "Bass DI.wav", "bass"),
    ("LeadMeRaw", "Act Guit.L.wav", "acoustic-guitar"),
    ("InTheMeantimeRaw", "BG1.wav", "backing-vocal"),
    ("InTheMeantimeRaw", "EGtr1a.wav", "electric-guitar"),
    ("InTheMeantimeRaw", "Sn.wav", "snare"),
]
ROOT.mkdir(parents=True, exist_ok=True)
(ROOT / "prepared").mkdir(exist_ok=True)
license_url = f"https://huggingface.co/datasets/sparrowreivun/Mix-Evaluation-Dataset-2.0/resolve/{REVISION}/Evaluation/MixEvaluation/songs.xml"
license_bytes = urllib.request.urlopen(license_url, timeout=30).read()
(ROOT / "songs.xml").write_bytes(license_bytes)
licenses = {song.attrib["id"]: song.findtext("license") for song in ET.fromstring(license_bytes)}
report = {"dataset": "sparrowreivun/Mix-Evaluation-Dataset-2.0", "revision": REVISION,
          "lead_in_seconds": 4, "passage_seconds": 12, "tail_seconds": 4,
          "license_source": license_url, "sources": []}
for folder, name, role in SELECTED:
    rel = f"Evaluation/audio/{folder}/{name}"
    path = Path(hf_hub_download(report["dataset"], rel, repo_type="dataset", revision=REVISION,
                               local_dir=ROOT / "downloads"))
    with sf.SoundFile(path) as f:
        rate, channels, frames = f.samplerate, f.channels, len(f)
        # Choose a genuinely active 16-second excerpt by rolling one-second energy.
        energy = []
        for block in f.blocks(blocksize=rate, always_2d=True):
            energy.append(float(np.mean(block**2)))
        scores = np.convolve(energy, np.ones(16), mode="valid")
        start = int(np.argmax(scores))
        f.seek(start*rate)
        audio = f.read(16*rate, always_2d=True)
    divisor = gcd(rate, 48000)
    audio = resample_poly(audio, 48000//divisor, rate//divisor, axis=0)
    audio = audio[:16*48000]
    peak = float(np.max(np.abs(audio)))
    if peak < 1e-4:
        raise RuntimeError(f"No usable activity in {path}")
    input_gain_db = -6 - 20*np.log10(peak)
    audio *= 10**(input_gain_db/20)
    # Boundary fades avoid slicing clicks; initial fade is discarded with lead-in.
    audio[:480] *= np.linspace(0, 1, 480)[:, None]
    audio[-2400:] *= np.linspace(1, 0, 2400)[:, None]
    audio = np.pad(audio, ((0, 4*48000), (0, 0)))
    source_id = folder.lower()+'-'+role
    prepared = ROOT / "prepared" / f"{source_id}.wav"
    sf.write(prepared, audio, 48000, subtype="FLOAT")
    row = {"id": source_id, "role": role, "song": folder.removesuffix("Raw"),
           "artist": "The DoneFors" if folder == "LeadMeRaw" else "Fredy V",
           "license": licenses[folder.removesuffix("Raw")], "license_source": license_url,
           "file": str(prepared), "original": str(path), "dataset_path": rel,
           "original_sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
           "prepared_sha256": hashlib.sha256(prepared.read_bytes()).hexdigest(),
           "original_rate": rate, "channels": channels, "original_seconds": frames/rate,
           "excerpt_start_seconds": start, "analysed_original_start_seconds": start+4,
           "input_gain_db": float(input_gain_db), "boundary_fades_ms": [10, 50]}
    report["sources"].append(row)
    print(json.dumps(row), flush=True)
(ROOT / "prepared-manifest.json").write_text(json.dumps(report, indent=2)+"\n")
