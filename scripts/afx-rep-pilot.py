"""Evaluate published AFx-Rep embeddings against known audio transformations.

Uses only the reviewed upstream encoder, not the full training/optimization stack.
All inference is local; this runner does not edit an application project.
"""
import argparse
import hashlib
import json
import sys
import time
from pathlib import Path

REVISION = "6582cb5414094146759319819a4242967ecc7e39"
RATE = 48000


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--root", type=Path, default=Path("data/afx-rep-runtime"))
    ap.add_argument("--device", choices=["cpu", "mps"], default="mps")
    ap.add_argument("--render-manifest", type=Path, help="Score actual engine renders, without Python effects")
    ap.add_argument("--output", type=Path, help="Explicit output report path")
    args = ap.parse_args()
    root = args.root.resolve()
    import librosa
    import numpy as np
    import scipy.signal as signal
    import soundfile as sf
    import torch
    import yaml
    from huggingface_hub import hf_hub_download

    torch.set_num_threads(6)
    if args.device == "mps" and not torch.backends.mps.is_available():
        raise RuntimeError("MPS unavailable; explicitly choose --device cpu instead.")
    files = {name: hf_hub_download("csteinmetz1/afx-rep", name, revision=REVISION,
                                   local_dir=root / "weights")
             for name in ["afx-rep.ckpt", "config.yaml"]}
    # Restrict checkpoint loading to tensors/primitive containers; no arbitrary pickle.
    unsafe = torch.serialization.get_unsafe_globals_in_checkpoint(files["afx-rep.ckpt"])
    if unsafe:
        raise RuntimeError(f"Checkpoint requires review of nonprimitive globals: {unsafe}")
    cfg = yaml.safe_load(Path(files["config.yaml"]).read_text())
    enc = cfg["model"]["init_args"]["encoder"]
    if enc["class_path"] != "lcap.models.panns.Cnn14":
        raise RuntimeError("Unexpected encoder configuration")
    sys.path.insert(0, str(root / "source"))
    from st_ito.models.panns import Cnn14
    start = time.perf_counter()
    ckpt = torch.load(files["afx-rep.ckpt"], map_location="cpu", weights_only=True, mmap=True)
    state = {k.removeprefix("encoder."): v for k, v in ckpt["state_dict"].items()
             if k.startswith("encoder.")}
    model = Cnn14(**enc["init_args"])
    model.load_state_dict(state, strict=True)
    del state, ckpt
    model = model.eval().to(args.device)
    load_seconds = time.perf_counter() - start
    print(f"Loaded AFx-Rep on {args.device} in {load_seconds:.2f}s", flush=True)

    fixtures = root / "fixtures" / args.device
    fixtures.mkdir(parents=True, exist_ok=True)
    source_paths = {
        "drums": Path("data/mixassist-runtime/real-audio/audio/segments/Group2/cut_12.wav"),
        "band": Path("data/mixassist-runtime/real-audio/audio/segments/Group5/cut_2.wav"),
        "synthetic-mix": Path("data/mixassist-runtime/fixtures/fixture_mix_uneven_over_120.wav"),
    }
    native = json.loads(args.render_manifest.read_text()) if args.render_manifest else None
    if native:
        source_paths = {r["source"]: Path(r["file"]) for r in native["renders"] if r["treatment"] == "dry"}
        native_files = {(r["source"], r["treatment"]): Path(r["file"]) for r in native["renders"]}
        if len(native_files) != len(source_paths)*len(native["treatments"]):
            raise RuntimeError("Incomplete native render matrix")
    duration = 16 if native else 6
    report = {"model": "csteinmetz1/afx-rep", "revision": REVISION,
              "source_commit": (root / "source-revision.txt").read_text().strip(),
              "device": args.device, "torch": torch.__version__, "load_seconds": load_seconds,
              "parameters": sum(p.numel() for p in model.parameters()),
              "preparation": f"48kHz, <={duration}s, native channels; peak normalization per file; L2-normalized mid/side embeddings",
              "sources": [], "embeddings": [], "retrieval": [], "controls": {}}
    treatments = ["dry", "lowpass", "highpass", "compress", "drive", "reverb"]
    if native:
        treatments = native["treatments"]
        report["render_manifest"] = str(args.render_manifest.resolve())
        report["renderer"] = native["renderer"]
    embeds = {}
    spectral_profiles = {}

    def spectral_profile(x):
        mono = x.mean(axis=1)
        mono = mono/max(float(np.max(np.abs(mono))), 1e-8)
        frequencies, _, spectrum = signal.stft(mono, fs=RATE, nperseg=2048, noverlap=1024)
        power = np.mean(np.abs(spectrum)**2, axis=1)
        edges = np.geomspace(20, 20000, 33)
        values = []
        for lo, hi in zip(edges[:-1], edges[1:]):
            mask = (frequencies >= lo) & (frequencies < hi)
            value = float(power[mask].mean()) if mask.any() else float(power[np.argmin(np.abs(frequencies-np.sqrt(lo*hi)))])
            values.append(10*np.log10(max(value, 1e-12)))
        vector = np.array(values)
        vector -= vector.mean()
        return vector/max(float(np.linalg.norm(vector)), 1e-8)

    def process(x, treatment):
        if treatment == "dry":
            return x.copy()
        if treatment in ["lowpass", "highpass"]:
            cutoff = 2000 if treatment == "lowpass" else 300
            return signal.sosfilt(signal.butter(4, cutoff, btype=treatment, fs=RATE, output="sos"), x, axis=0)
        if treatment == "drive":
            return np.tanh(8*x)
        if treatment == "compress":
            # Linked peak detector, 1ms attack/100ms release, -35dBFS threshold, 4:1.
            # A lower threshold ensures the quiet recordings are actually processed.
            detector = np.max(np.abs(x), axis=1)
            attack, release = np.exp(-1/(RATE*.001)), np.exp(-1/(RATE*.1))
            env = np.zeros(len(x))
            previous = 0.0
            for i, level in enumerate(detector):
                coefficient = attack if level > previous else release
                previous = coefficient*previous + (1-coefficient)*level
                env[i] = previous
            over = np.maximum(20*np.log10(np.maximum(env, 1e-8))+35, 0)
            return x*10**((-over*.75)/20)[:, None]
        # Fixed-seed diffuse mono/stereo IR, 30ms predelay, ~0.7s RT60, 35% wet.
        rng = np.random.default_rng(7)
        ir = rng.normal(size=int(RATE*.7))*np.exp(-np.arange(int(RATE*.7))/RATE*6.908/.7)
        ir /= np.sqrt(np.sum(ir**2))
        ir = np.pad(ir, (int(RATE*.03), 0))
        wet = np.stack([signal.fftconvolve(x[:, c], ir)[:len(x)] for c in range(x.shape[1])], axis=1)
        return .65*x + .35*wet

    def extract(x):
        tensor = torch.tensor(x.T.copy(), dtype=torch.float32, device=args.device).unsqueeze(0)
        tensor = tensor/tensor.abs().amax().clamp(min=1e-8)
        t0 = time.perf_counter()
        with torch.inference_mode():
            mid, side = model(tensor)
            result = [torch.nn.functional.normalize(v, dim=-1).cpu().numpy()[0] for v in [mid, side]]
        seconds = time.perf_counter()-t0
        if not all(np.isfinite(v).all() for v in result):
            raise RuntimeError("Nonfinite model embeddings")
        return result, seconds

    for source, path in source_paths.items():
        x, _ = librosa.load(path, sr=RATE, mono=False, duration=duration)
        x = x[:, None] if x.ndim == 1 else x.T
        if not native:
            x = x*(10**(-6/20)/np.max(np.abs(x)))
        report["sources"].append({"id": source, "file": str(path.resolve()),
                                  "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
                                  "seconds": len(x)/RATE, "channels": x.shape[1]})
        for treatment in treatments:
            if native:
                wav = native_files[source, treatment]
                y, rate = sf.read(wav, always_2d=True, dtype="float32")
                if rate != RATE or len(y) != duration*RATE:
                    raise RuntimeError("Native render format mismatch")
            else:
                y = process(x, treatment).astype(np.float32)
                wav = fixtures / f"{source}-{treatment}.wav"
                sf.write(wav, y, RATE, subtype="FLOAT")
            embedding, seconds = extract(y)
            embeds[source, treatment] = embedding
            spectral_profiles[source, treatment] = spectral_profile(y.astype(np.float64))
            rms = float(np.sqrt(np.mean(y*y)))
            peak = float(np.max(np.abs(y)))
            row = {"source": source, "treatment": treatment, "seconds": seconds,
                   "file": str(wav), "sha256": hashlib.sha256(wav.read_bytes()).hexdigest(),
                   "peak_dbfs": float(20*np.log10(peak)), "rms_dbfs": float(20*np.log10(rms)),
                   "crest_db": float(20*np.log10(peak/rms)), "mid": embedding[0].tolist(),
                   "side": embedding[1].tolist()}
            report["embeddings"].append(row)
            print(f"{source}/{treatment}: {seconds:.3f}s", flush=True)

        # Gain is intentionally removed; exact-repeat checks are deterministic controls.
        gain, _ = extract(x*.25)
        repeat, _ = extract(x)
        report["controls"][source] = {
            "gain_minus12db_mid_cosine": float(np.dot(embeds[source, "dry"][0], gain[0])),
            "repeat_mid_cosine": float(np.dot(embeds[source, "dry"][0], repeat[0])),
            "repeat_max_abs_mid": float(np.max(np.abs(embeds[source, "dry"][0]-repeat[0]))),
        }

    # Mid-only for fair comparisons with mono recordings. Side metrics need stereo references.
    for query in source_paths:
        for candidate in source_paths:
            if query == candidate:
                continue
            if native:
                songs = {s["id"]: s["song"] for s in native["sources"]}
                if songs[query] == songs[candidate]:
                    continue
            for treatment in treatments:
                distances = {t: float(1-np.dot(embeds[query, treatment][0], embeds[candidate, t][0]))
                             for t in treatments}
                order = sorted(distances, key=distances.get)
                report["retrieval"].append({"query_source": query, "candidate_source": candidate,
                    "target_treatment": treatment, "rank": order.index(treatment)+1,
                    "selected": order[0], "distances": distances})
    baseline = []
    for row in report["retrieval"]:
        distances = {t: float(1-np.dot(spectral_profiles[row["query_source"], row["target_treatment"]],
                                       spectral_profiles[row["candidate_source"], t])) for t in treatments}
        order = sorted(distances, key=distances.get)
        baseline.append({"query_source": row["query_source"], "candidate_source": row["candidate_source"],
                         "target_treatment": row["target_treatment"], "selected": order[0],
                         "rank": order.index(row["target_treatment"])+1})
    report["spectral_baseline"] = {
        "method": "32 log-spaced mean-power bands, 20Hz–20kHz; mean-centered dB/L2 cosine; 2048 FFT/1024 hop; mono peak normalization",
        "correct": sum(r["rank"] == 1 for r in baseline), "queries": len(baseline), "retrieval": baseline}
    report["within_source_distances"] = {
        source: {t: float(1-np.dot(embeds[source, "dry"][0], embeds[source, t][0])) for t in treatments}
        for source in source_paths}
    silence, _ = extract(np.zeros((int(RATE*6), 1), dtype=np.float32))
    report["controls"]["silence"] = {"finite": bool(np.isfinite(silence[0]).all()),
                                         "embedding_norm": float(np.linalg.norm(silence[0])),
                                         "policy": "Exclude silent inputs using DSP; embedding norm is not an audibility detector"}
    retrieval = report["retrieval"]
    report["summary"] = {"correct": sum(r["rank"] == 1 for r in retrieval), "queries": len(retrieval),
                          "chance_top1": 1/len(treatments),
                          "mean_reciprocal_rank": float(np.mean([1/r["rank"] for r in retrieval])),
                          "median_embedding_seconds": float(np.median([r["seconds"] for r in report["embeddings"]]))}
    if args.device == "mps":
        report["mps_live_gb"] = torch.mps.current_allocated_memory()/1e9
        report["mps_driver_gb"] = torch.mps.driver_allocated_memory()/1e9
    out = args.output or root / f"results-{args.device}.json"
    out.write_text(json.dumps(report, indent=2)+"\n")
    print(json.dumps(report["summary"]), flush=True)
    print(f"Report: {out}", flush=True)


if __name__ == "__main__":
    main()
