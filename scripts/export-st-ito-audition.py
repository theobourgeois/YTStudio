"""Package native ST-ITO results with an offline, volume-matched A/B player."""
import html
import json
import shutil
from pathlib import Path

import numpy as np
import soundfile as sf

root = Path("data/st-ito-runtime")
report = json.loads((root / "results.json").read_text())
dest = Path.home() / "Downloads/ST-ITO-real-stems"
if dest.exists():
    n = 2
    while dest.with_name(f"ST-ITO-real-stems-{n}").exists():
        n += 1
    dest = dest.with_name(f"ST-ITO-real-stems-{n}")
dest.mkdir(parents=True)
variants = {"input": "Dry input", "reference": "Reference", "optimized": "ST-ITO output",
            "random-best": "Best initial random settings", "known-settings": "Known reference settings on input"}
titles = {"same-vocal-chain": "Same vocal · EQ + compression + reverb control",
          "cross-vocal-chain": "Different-song vocals · EQ + compression + reverb",
          "cross-vocal-delay": "Different-song vocals · delay", "cross-guitar-eq": "Different-song guitars · darker EQ"}
cards, gains = [], []
for case in report["cases"]:
    name = case["name"]
    decoded = {}
    for variant in variants:
        x, rate = sf.read(root / "cases" / name / f"{variant}.wav", always_2d=True)
        if rate != 48000 or len(x) != 16 * rate or not np.isfinite(x).all():
            raise RuntimeError("Unexpected audition audio")
        rms_db = float(20 * np.log10(max(float(np.sqrt(np.mean(x[:12 * rate] ** 2))), 1e-12)))
        peak_db = float(20 * np.log10(max(float(np.abs(x).max()), 1e-12)))
        decoded[variant] = (x, rate, rms_db, peak_db)
    target = min(decoded["input"][2], min(-1 - (v[3] - v[2]) for v in decoded.values()))
    for variant, (x, rate, rms_db, peak_db) in decoded.items():
        rel = Path(name) / f"{variant}.wav"
        for mode in ["raw", "volume-matched"]:
            (dest / mode / name).mkdir(parents=True, exist_ok=True)
        shutil.copy2(root / "cases" / name / rel.name, dest / "raw" / rel)
        gain_db = target - rms_db
        sf.write(dest / "volume-matched" / rel, x * 10 ** (gain_db / 20), rate, subtype="FLOAT")
        gains.append({"case": name, "variant": variant, "gain_db": gain_db,
                      "raw_peak_dbfs": peak_db, "matched_peak_dbfs": peak_db + gain_db})
    buttons = ''.join(f'<button data-treatment="{v}">{html.escape(label)}</button>' for v, label in variants.items())
    p = ', '.join(f'{k}: {v:.3g}' for k, v in case["parameters"].items())
    score = case["scores"]
    cards.append(f'<section data-source="{name}"><h2>{html.escape(titles[name])}</h2>'
                 f'<p>Input: {html.escape(case["source"])}. Reference: {html.escape(case["reference"])}.</p>'
                 f'<p>Held-out embedding distance: dry {score["dry"]["held_out"]:.4f} → ST-ITO {score["optimized"]["held_out"]:.4f}. Lower is closer; this is not a quality score.</p>'
                 f'<details><summary>Chosen plugin settings</summary><p>{html.escape(p)}</p></details>'
                 f'<div class="buttons">{buttons}</div><p class="current">Dry input</p><audio controls preload="none"></audio></section>')
script = """const mode=document.querySelector('select');const cards=[...document.querySelectorAll('section')];function load(card,treatment,keepTime=true){const a=card.querySelector('audio');const t=keepTime?a.currentTime:0;const playing=!a.paused;card.dataset.treatment=treatment;a.preload='metadata';a.src=mode.value+'/'+card.dataset.source+'/'+treatment+'.wav';a.addEventListener('loadedmetadata',()=>{a.currentTime=Math.min(t,a.duration||0);if(playing)a.play().catch(()=>{});},{once:true});a.load();card.querySelectorAll('button').forEach(b=>b.classList.toggle('active',b.dataset.treatment===treatment));card.querySelector('.current').textContent=card.querySelector('button[data-treatment="'+treatment+'"]').textContent;}cards.forEach(card=>{load(card,'input',false);card.querySelectorAll('button').forEach(b=>b.onclick=()=>load(card,b.dataset.treatment));card.querySelector('audio').addEventListener('play',()=>cards.forEach(other=>{if(other!==card)other.querySelector('audio').pause();}));});mode.onchange=()=>cards.forEach(card=>load(card,card.dataset.treatment));"""
style = """body{font:16px system-ui;margin:40px auto;max-width:1000px;padding:0 20px;background:#11151c;color:#eee}h1{font-size:30px}h2{font-size:21px}p{color:#acb5c4;line-height:1.5}section{background:#1d2430;padding:20px;border-radius:12px;margin:20px 0}button,select{font:inherit;background:#303b4b;color:#fff;border:1px solid #4a5a70;border-radius:6px;padding:9px 12px;margin:3px;cursor:pointer}button.active{background:#426bca}audio{width:100%}.current{color:#fff}a{color:#a8c2ff}details{margin-bottom:16px}"""
page = ('<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
        '<title>ST-ITO · real stems and native plugins</title><style>' + style + '</style><h1>ST-ITO · real stems and native plugins</h1>'
        '<p>The upstream optimizer searches our actual plugin settings to approach a reference. Eight seconds drive the search; the remaining performance and tails are held out.</p>'
        '<p>Compare Dry input → Reference → ST-ITO output. Different-song references have different performances. Matching the embedding does not guarantee a better mix.</p>'
        '<label>Playback levels <select><option value="volume-matched">Volume matched</option><option value="raw">Original render levels</option></select></label>'
        '<p>Volume matching uses scalar RMS gain over twelve seconds, with peak headroom; it is not LUFS matching.</p>'
        + ''.join(cards) + '<p>Recordings: “Lead Me” by The DoneFors; “In The Meantime” by Fredy V. '
        '<a href="https://huggingface.co/datasets/sparrowreivun/Mix-Evaluation-Dataset-2.0">Mix Evaluation Dataset / Open Multitrack Testbed</a>. '
        '<a href="https://creativecommons.org/licenses/by/3.0/">CC BY 3.0</a>. Excerpts, resampling, fades, calibration, effects and audition gain are modifications.</p>'
        '<script>' + script + '</script></html>')
(dest / "listen.html").write_text(page)
(dest / "results-and-provenance.json").write_text(json.dumps(report, indent=2))
(dest / "audition-gains.json").write_text(json.dumps(gains, indent=2))
(dest / "READ-ME.txt").write_text("Open listen.html for offline A/B playback.\nraw/ contains native engine renders.\n"
                                 "volume-matched/ contains scalar-gain audition copies.\n"
                                 "Different-song references are different performances, not aligned mixes.\n"
                                 "Model distance is not a subjective mix quality score. Credits, licence records and settings are in results-and-provenance.json.\n")
(root / "audition-folder.txt").write_text(str(dest))
(root / "audition-player.js").write_text(script)
print(dest)
