"""Run upstream ST-ITO CMA-ES against real stems through YTStudio's native API."""
import argparse
import ast
import hashlib
import json
import subprocess
import sys
import time
from pathlib import Path
from typing import List

import cma
import numpy as np
import soundfile as sf
import torch
import yaml

RATE = 48000
SOURCE_COMMIT = "ec50e0cc647cc3637d0cbbfc01d059c682c9fb27"


def reviewed_function(path, name, namespace):
    """Execute only the named, reviewed function, avoiding unrelated model imports."""
    tree = ast.parse(path.read_text())
    node = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == name)
    exec(compile(ast.Module(body=[node], type_ignores=[]), str(path), "exec"), namespace)
    return namespace[name]


def load_model(runtime, device):
    checkpoint = runtime / "weights/afx-rep.ckpt"
    if torch.serialization.get_unsafe_globals_in_checkpoint(checkpoint):
        raise RuntimeError("Checkpoint contains unreviewed globals")
    cfg = yaml.safe_load((runtime / "weights/config.yaml").read_text())
    enc = cfg["model"]["init_args"]["encoder"]
    if enc["class_path"] != "lcap.models.panns.Cnn14":
        raise RuntimeError("Unexpected encoder")
    sys.path.insert(0, str(runtime / "source"))
    from st_ito.models.panns import Cnn14
    ckpt = torch.load(checkpoint, map_location="cpu", weights_only=True, mmap=True)
    state = {k.removeprefix("encoder."): v for k, v in ckpt["state_dict"].items() if k.startswith("encoder.")}
    model = Cnn14(**enc["init_args"])
    model.load_state_dict(state, strict=True)
    return model.eval().to(device)


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--root", type=Path, default=Path("data/st-ito-runtime"))
    ap.add_argument("--device", choices=["cpu", "mps"], default="cpu")
    ap.add_argument("--max-iters", type=int, default=25)
    ap.add_argument("--popsize", type=int, default=12)
    ap.add_argument("--case", help="Run one named case")
    args = ap.parse_args()
    root = args.root.resolve()
    root.mkdir(parents=True, exist_ok=True)
    runtime = Path("data/afx-rep-runtime").resolve()
    upstream = runtime / "source/st_ito"
    commit = subprocess.check_output(["git", "-C", str(runtime / "source"), "rev-parse", "HEAD"], text=True).strip()
    if commit != SOURCE_COMMIT:
        raise RuntimeError("Review the changed upstream code before running")
    torch.set_num_threads(6)
    np.random.seed(20261004)
    model = load_model(runtime, args.device)
    print(f"Loaded existing AFx-Rep checkpoint; using upstream run_es on {args.device}", flush=True)
    param_embed = reviewed_function(upstream / "utils.py", "get_param_embeds", {"torch": torch})

    def embed(audio):
        # Small batches keep the upstream encoder's activation memory bounded.
        rows = {"mid": [], "side": []}
        for chunk in audio.split(2):
            values = param_embed(chunk.clone().to(args.device), model, RATE)
            for name in rows:
                rows[name].append(values[name].detach().cpu())
        return {name: torch.cat(parts) for name, parts in rows.items()}

    def read_audio(file):
        x, rate = sf.read(file, always_2d=True, dtype="float32")
        if rate != RATE or not np.isfinite(x).all():
            raise RuntimeError(f"Invalid audio {file}")
        return torch.from_numpy(x.T.copy()).unsqueeze(0)

    def score(audio, target):
        spans = {"training": slice(0, 8 * RATE), "held_out": slice(8 * RATE, 16 * RATE), "full": slice(None)}
        return {name: float(torch.stack([
            1 - torch.cosine_similarity(embed(audio[..., span])[key], embed(target[..., span])[key], dim=-1)
            for key in ["mid", "side"]]).mean()) for name, span in spans.items()}

    manifest = json.loads(Path("data/afx-rep-real-stems/render-manifest.json").read_text())
    sources = {s["id"]: s for s in manifest["sources"]}
    files = {(r["source"], r["treatment"]): r["file"] for r in manifest["renders"]}
    specs = {"chain": ["eqGainDb", "eqHz", "thresholdDb", "ratio", "reverbMix", "decaySeconds", "predelaySeconds"],
             "delay": ["delayMix", "delayMs", "feedback"], "eq": ["eqGainDb", "eqHz"]}
    log_norm = lambda value, lo, hi: float(np.log(value / lo) / np.log(hi / lo))
    known = {"chain": [6 / 14, log_norm(5000, 1000, 10000), 10 / 30, 3 / 5, .15 / .4,
                       log_norm(1.4, .3, 2.5), .025 / .06],
             "delay": [.25 / .4, log_norm(250, 80, 500), .25 / .4],
             "eq": [2 / 14, log_norm(5000, 1000, 10000)]}
    cases = [
        ("same-vocal-chain", "leadmeraw-lead-vocal", "leadmeraw-lead-vocal", "chain", "chain"),
        ("cross-vocal-chain", "leadmeraw-lead-vocal", "inthemeantimeraw-backing-vocal", "chain", "chain"),
        ("cross-vocal-delay", "leadmeraw-lead-vocal", "inthemeantimeraw-backing-vocal", "delay", "delay"),
        ("cross-guitar-eq", "leadmeraw-acoustic-guitar", "inthemeantimeraw-electric-guitar", "eq", "eq-dark"),
    ]
    if args.case:
        cases = [row for row in cases if row[0] == args.case]
        if not cases:
            raise RuntimeError("Unknown case")
    report = {"source_commit": commit, "upstream_run_es_sha256": hashlib.sha256((upstream / "style_transfer.py").read_bytes()).hexdigest(),
              "optimizer": "Unmodified upstream run_es with native process_audio/parameters_to_dict callbacks",
              "checkpoint": str(runtime / "weights/afx-rep.ckpt"), "device": args.device,
              "cma_version": cma.__version__, "max_iters": args.max_iters, "popsize": args.popsize,
              "sigma0": .1, "dropout": 0, "training_seconds": 8, "held_out_seconds": 8,
              "held_out_description": "last four seconds of performance plus four seconds of effect tails",
              "sources": list(sources.values()), "cases": []}
    worker_err = (root / "native-worker.log").open("w")
    worker = subprocess.Popen(["pnpm", "exec", "tsx", "scripts/st-ito-native-render.ts", str(root)],
                              stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=worker_err, text=True, bufsize=1)

    def receive():
        line = worker.stdout.readline()
        if not line:
            raise RuntimeError("Native renderer exited; inspect native-worker.log")
        response = json.loads(line)
        if "error" in response:
            raise RuntimeError(response["error"])
        return response

    def render(source, kind, w, output=None):
        request = {"source": str(source), "kind": kind, "w": np.asarray(w).tolist()}
        if output:
            request["output"] = str(output)
        worker.stdin.write(json.dumps(request) + "\n")
        worker.stdin.flush()
        return receive()

    report["engine"] = receive()
    try:
        for case_index, (name, source_id, target_id, kind, treatment) in enumerate(cases):
            start = time.perf_counter()
            folder = root / "cases" / name
            folder.mkdir(parents=True, exist_ok=True)
            print(f"Starting {name}: {source_id} -> {target_id}/{treatment}", flush=True)
            input_audio = read_audio(sources[source_id]["file"])
            original_peak = float(input_audio.abs().max())
            target_audio = read_audio(files[target_id, treatment])
            dry_audio = read_audio(files[source_id, "dry"])
            sf.write(folder / "input.wav", dry_audio[0].T.numpy(), RATE, subtype="FLOAT")
            sf.write(folder / "reference.wav", target_audio[0].T.numpy(), RATE, subtype="FLOAT")
            target_embedding = embed(target_audio[..., :8 * RATE])
            pending, evaluations = [], []
            calibrated = folder / "calibrated-source.wav"
            expected_hash = None

            def process_audio(x, w, sample_rate, plugins):
                nonlocal expected_hash
                if sample_rate != RATE or x.shape != (input_audio.shape[1], 20 * RATE):
                    raise RuntimeError("Unexpected crop/input to native callback")
                input_hash = hashlib.sha256(x.tobytes()).hexdigest()
                if expected_hash is None:
                    expected_hash = input_hash
                    # Upstream normalizes inputs. Restore the original -6 dBFS
                    # calibration before native plugins, preserving dynamics context.
                    sf.write(calibrated, (x * original_peak).T, RATE, subtype="FLOAT")
                elif input_hash != expected_hash:
                    raise RuntimeError("The fixed native input changed during optimization")
                response = render(calibrated, kind, w)
                audio = read_audio(response["file"])[0]
                pending.append({"w": np.asarray(w).tolist(), "parameters": response["parameters"],
                                "render_seconds": response["renderSeconds"], "peak": float(audio.abs().max())})
                y = audio[..., :8 * RATE].numpy().copy()
                return y / max(float(np.abs(y).max()), 1e-8)

            def embed_func(audio, unused_model, sample_rate):
                if sample_rate != RATE:
                    raise RuntimeError("Unexpected embedding sample rate")
                values = embed(audio)
                if pending and len(pending) == audio.shape[0]:
                    losses = torch.stack([1 - torch.cosine_similarity(values[k], target_embedding[k], dim=-1)
                                          for k in values]).mean(dim=0).tolist()
                    for row, loss in zip(pending, losses):
                        evaluations.append({**row, "loss": loss})
                    pending.clear()
                    (folder / "evaluations.json").write_text(json.dumps(evaluations, indent=2))
                return values

            def parameters_to_dict(w, plugins):
                return {"normalized": np.asarray(w).tolist(), "names": specs[kind]}

            namespace = {"torch": torch, "np": np, "cma": cma, "List": List,
                         "process_audio": process_audio, "parameters_to_dict": parameters_to_dict}
            run_es = reviewed_function(upstream / "style_transfer.py", "run_es", namespace)
            # Stable seeded initialization across independent cases.
            np.random.seed(20261004 + case_index)
            result = run_es(input_audio=input_audio.clone(), target_audio=target_audio[..., :8 * RATE].clone(),
                            sample_rate=RATE, plugins={"native": {"num_params": len(specs[kind])}},
                            model=model, embed_func=embed_func, max_iters=args.max_iters,
                            popsize=args.popsize, find_w0=True, sigma0=.1, random_crop=False,
                            parallel=False, dropout=0, savepop=False)
            best = render(calibrated, kind, result["wopt"], folder / "optimized.wav")
            random_best = min(evaluations[:args.popsize], key=lambda row: row["loss"])
            random_render = render(calibrated, kind, random_best["w"], folder / "random-best.wav")
            oracle = render(calibrated, kind, known[kind], folder / "known-settings.wav")
            scores = {"dry": score(dry_audio, target_audio),
                      "random_best": score(read_audio(random_render["file"]), target_audio),
                      "optimized": score(read_audio(best["file"]), target_audio),
                      "known_settings": score(read_audio(oracle["file"]), target_audio)}
            # Re-rendering the chosen candidate must reproduce its full waveform.
            repeat = render(calibrated, kind, result["wopt"])
            repeat_exact = repeat["sha256"] == best["sha256"]
            if not repeat_exact:
                raise RuntimeError("Selected native candidate was not reproducible")
            row = {"name": name, "source": source_id, "reference": target_id, "reference_treatment": treatment,
                   "kind": kind, "seconds": time.perf_counter() - start,
                   "evaluations": len(evaluations), "iterations": len(result["fval_history"]),
                   "upstream_best_negative_cosine": float(result["fopt"]), "scores": scores,
                   "parameters": best["parameters"], "normalized_parameters": result["wopt"].tolist(),
                   "render": best, "random_initial_best": random_best, "known_settings": oracle["parameters"],
                   "input_normalized_sha256": expected_hash, "repeat_native_sha256_equal": repeat_exact,
                   "candidate_clipping_count": sum(e["peak"] >= 1 for e in evaluations),
                   "optimized_peak": float(read_audio(best["file"]).abs().max())}
            (folder / "result.json").write_text(json.dumps(row, indent=2))
            report["cases"].append(row)
            (root / "results.json").write_text(json.dumps(report, indent=2))
            print(f"Completed {name}: {json.dumps(scores)}", flush=True)
    finally:
        worker.stdin.close()
        try:
            worker.wait(timeout=10)
        except subprocess.TimeoutExpired:
            worker.terminate()
            worker.wait(timeout=10)
        worker_err.close()
    print(f"Results: {root / 'results.json'}", flush=True)


if __name__ == "__main__":
    main()
