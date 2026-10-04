"""Local, reproducible MixAssist reconstruction evaluation (never edits a project).

Install the author's pinned requirements and torch in an isolated Python 3.11
environment first. See docs/audio-intelligence/mixassist-pilot.md.
"""
import argparse
import hashlib
import json
import platform
import time
from contextlib import nullcontext
from pathlib import Path

BASE = "Qwen/Qwen2-Audio-7B-Instruct"
BASE_REV = "0a095220c30b7b31434169c3086508ef3ea5bf0a"
ADAPTER = "mclemcrew/Qwen2-Audio-MixAssist-LoRA"
ADAPTER_REV = "fe1acc1c3d1e7b28ba90a2a9fc6002e93296db34"
SYSTEM = (
    "You are an expert audio engineer assisting with music production and mixing. "
    "Provide clear, specific advice on audio engineering techniques, mixing adjustments, "
    "and production decisions based on the audio samples and the user's questions. "
    "Focus on practical, actionable guidance."
)


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--root", type=Path, default=Path("data/mixassist-runtime"))
    ap.add_argument("--download-only", action="store_true")
    ap.add_argument("--case", action="append", help="Restrict to named cases")
    ap.add_argument("--max-tokens", type=int, default=300)
    ap.add_argument("--output", default="results.json", help="Report filename within --root")
    args = ap.parse_args()
    root = args.root.resolve()
    root.mkdir(parents=True, exist_ok=True)
    from huggingface_hub import snapshot_download
    paths = {}
    for repo, rev in [(BASE, BASE_REV), (ADAPTER, ADAPTER_REV)]:
        paths[repo] = snapshot_download(repo, revision=rev, cache_dir=root / "models",
                                       allow_patterns=["*.json", "*.safetensors", "*.txt"])
        print(f"Downloaded {repo} @ {rev}", flush=True)
    if args.download_only:
        return

    import librosa
    import numpy as np
    import torch
    import transformers
    import peft
    import soundfile as sf
    from peft import PeftModel
    from transformers import AutoProcessor, Qwen2AudioForConditionalGeneration, set_seed
    if not torch.backends.mps.is_available():
        raise RuntimeError("This pilot requires Apple MPS; do not silently run on CPU.")
    started = time.monotonic()
    processor = AutoProcessor.from_pretrained(paths[BASE], local_files_only=True)
    model = Qwen2AudioForConditionalGeneration.from_pretrained(
        paths[BASE], torch_dtype=torch.float16, attn_implementation="sdpa",
        low_cpu_mem_usage=True, local_files_only=True,
    ).to("mps")
    model = PeftModel.from_pretrained(model, paths[ADAPTER], local_files_only=True).eval()
    print(f"Loaded on MPS in {time.monotonic() - started:.1f}s", flush=True)
    common = "Describe what is audible and whether any mixing adjustment is needed. Only suggest changes supported by this audio."
    dynamic = "Are the phrase levels consistent across this audio? Describe any audible level changes, and suggest a mixing adjustment only if needed."
    cases = [
        {"id": "uneven", "file": "fixture_vocal_uneven.wav", "prompt": dynamic},
        {"id": "steady", "file": "fixture_vocal_steady.wav", "prompt": dynamic},
        {"id": "beat", "file": "fixture_beat_120.wav", "prompt": common},
        {"id": "silence", "file": "fixture_silence.wav", "prompt": common},
        {"id": "tone", "file": "fixture_tone_1k.wav", "prompt": common},
        {"id": "mix", "file": "fixture_mix_uneven_over_120.wav", "prompt": common},
    ]
    # A matched control removes pitch/timbre confounds between the existing fixtures.
    original, rate = sf.read(root / "fixtures" / "fixture_vocal_uneven.wav")
    matched = original.copy()
    for i in range(4):
        first = int((0.2 + 1.8*i)*rate)
        last = int((1.7 + 1.8*i)*rate)
        peak = np.max(np.abs(matched[first:last]))
        matched[first:last] *= 10**(-9/20) / peak
    sf.write(root / "fixtures" / "matched_steady.wav", matched, rate, subtype="FLOAT")
    cases.insert(1, {"id": "matched-steady", "file": "matched_steady.wav", "prompt": dynamic})
    real_cases = root / "real-cases.json"
    if real_cases.exists():
        cases.extend(json.loads(real_cases.read_text()))
    report = {
        "base": {"id": BASE, "revision": BASE_REV},
        "adapter": {"id": ADAPTER, "revision": ADAPTER_REV},
        "variant": "Author reconstruction, fp16 MPS; not original CUDA NF4 release",
        "software": {"python": platform.python_version(), "torch": torch.__version__,
                     "transformers": transformers.__version__, "peft": peft.__version__},
        "load_seconds": time.monotonic() - started,
        "generation": {"do_sample": True, "temperature": 0.7, "top_k": 20, "top_p": 0.5,
                       "repetition_penalty": 1.1, "max_new_tokens": args.max_tokens},
        "audio_preparation": "16kHz mono, <=30s; no gain normalization",
        "results": [],
    }
    # Fixed seeds and identical prompts/audio for paired base/adapter comparisons.
    jobs = [(c, variant, seed) for c in cases for variant in ["mixassist", "base"]
            for seed in ([17, 29] if c["id"] in ["uneven", "matched-steady", "steady", "silence"] and variant == "mixassist" else [17])]
    for case, variant, seed in jobs:
        if args.case and case["id"] not in args.case:
            continue
        path = Path(case["file"])
        if not path.is_absolute():
            path = root / "fixtures" / path
        audio, sr = librosa.load(path, sr=16000, mono=True, duration=30)
        peak = float(np.max(np.abs(audio)))
        conversation = [{"role": "system", "content": SYSTEM}]
        conversation.extend(case.get("history", []))
        conversation.append({"role": "user", "content": [
            {"type": "audio", "audio_url": str(path)},
            {"type": "text", "text": case["prompt"]},
        ]})
        text = processor.apply_chat_template(conversation, tokenize=False, add_generation_prompt=True)
        inputs = processor(text=text, audios=[audio], sampling_rate=sr, return_tensors="pt")
        inputs = {k: v.to(device="mps", dtype=torch.float16 if v.is_floating_point() else v.dtype)
                  for k, v in inputs.items()}
        set_seed(seed)
        t0 = time.monotonic()
        with torch.inference_mode(), (model.disable_adapter() if variant == "base" else nullcontext()):
            output = model.generate(**inputs, **report["generation"],
                                    pad_token_id=processor.tokenizer.pad_token_id)
        torch.mps.synchronize()
        tokens = output[:, inputs["input_ids"].shape[1]:]
        response = processor.batch_decode(tokens, skip_special_tokens=True)[0]
        row = {"case": case["id"], "variant": variant, "seed": seed,
               "prompt": case["prompt"], "file": str(path),
               "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
               "duration_seconds": len(audio)/sr, "prepared_peak_dbfs": 20*np.log10(peak) if peak else None,
               "prepared_rms_dbfs": 20*np.log10(float(np.sqrt(np.mean(audio**2)))) if peak else None,
               "seconds": time.monotonic()-t0, "tokens": tokens.shape[1],
               "hit_token_limit": tokens.shape[1] >= args.max_tokens,
               "response": response,
               "mps_allocated_gb": torch.mps.current_allocated_memory()/1e9,
               "mps_driver_gb": torch.mps.driver_allocated_memory()/1e9}
        report["results"].append(row)
        (root / args.output).write_text(json.dumps(report, indent=2)+"\n")
        print(json.dumps(row), flush=True)


if __name__ == "__main__":
    main()
