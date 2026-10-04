"""Export actual native render WAVs and an offline A/B player to Downloads."""
import html
import json
import shutil
from pathlib import Path

import numpy as np
import soundfile as sf

root = Path("data/afx-rep-real-stems")
manifest = json.loads((root / "render-manifest.json").read_text())
dest = Path.home() / "Downloads" / "AFx-Rep-real-stems"
if dest.exists():
    index = 2
    while dest.with_name(f"AFx-Rep-real-stems-{index}").exists():
        index += 1
    dest = dest.with_name(f"AFx-Rep-real-stems-{index}")
dest.mkdir(parents=True)
labels = {"dry": "Dry", "eq-dark": "EQ darker", "eq-bright": "EQ brighter", "compress": "Compression",
          "reverb": "Plate reverb", "delay": "Delay", "chain": "EQ + compression + reverb"}
cards, audit = [], []
for source in manifest["sources"]:
    rows = [r for r in manifest["renders"] if r["source"] == source["id"]]
    decoded = {}
    for r in rows:
        x, rate = sf.read(r["file"], always_2d=True)
        rms_db = float(20*np.log10(max(float(np.sqrt(np.mean(x[:12*rate]**2))), 1e-12)))
        peak_db = float(20*np.log10(np.max(np.abs(x))))
        decoded[r["treatment"]] = (x, rate, rms_db, peak_db)
    # Match body RMS across variants of the same stem, leaving 1dB peak headroom.
    target = min(decoded["dry"][2], min(-1-(v[3]-v[2]) for v in decoded.values()))
    for r in rows:
        x, rate, rms_db, _ = decoded[r["treatment"]]
        filename = f"{source['id']}/{r['treatment']}.wav"
        raw = dest / "raw" / filename
        matched = dest / "volume-matched" / filename
        raw.parent.mkdir(parents=True, exist_ok=True)
        matched.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(r["file"], raw)
        gain = 10**((target-rms_db)/20)
        sf.write(matched, x*gain, rate, subtype="FLOAT")
        audit.append({"source": source["id"], "treatment": r["treatment"],
                      "gain_db": target-rms_db, "target_body_rms_dbfs": target,
                      "matched_peak_dbfs": float(20*np.log10(np.max(np.abs(x*gain))))})
    title = f"{'Lead Me' if source['song']=='LeadMe' else 'In The Meantime'} — {source['role'].replace('-', ' ')}"
    buttons = ''.join(f'<button data-treatment="{t}">{html.escape(labels[t])}</button>' for t in manifest["treatments"])
    cards.append(f'<section data-source="{html.escape(source["id"])}"><h2>{html.escape(title)}</h2>'
                 f'<p>{html.escape(source["artist"])} · CC BY 3.0</p><div class="buttons">{buttons}</div>'
                 '<p class="current">Dry</p><audio controls preload="none"></audio></section>')
style = """body{font:16px system-ui;margin:40px auto;max-width:1000px;padding:0 20px;background:#11151c;color:#eee}h1{font-size:30px}h2{font-size:21px}p{color:#acb5c4;line-height:1.5}section{background:#1d2430;padding:20px;border-radius:12px;margin:20px 0}button,select{font:inherit;background:#303b4b;color:#fff;border:1px solid #4a5a70;border-radius:6px;padding:9px 12px;margin:3px;cursor:pointer}button.active{background:#426bca}audio{width:100%}.current{color:#fff}a{color:#a8c2ff}"""
script = """const mode=document.querySelector('select');const cards=[...document.querySelectorAll('section')];function load(card,treatment,keepTime=true){const a=card.querySelector('audio');const t=keepTime?a.currentTime:0;const playing=!a.paused;card.dataset.treatment=treatment;a.preload='metadata';a.src=mode.value+'/'+card.dataset.source+'/'+treatment+'.wav';a.addEventListener('loadedmetadata',()=>{a.currentTime=Math.min(t,a.duration||0);if(playing)a.play().catch(()=>{});},{once:true});a.load();card.querySelectorAll('button').forEach(b=>b.classList.toggle('active',b.dataset.treatment===treatment));card.querySelector('.current').textContent=card.querySelector('button[data-treatment="'+treatment+'"]').textContent;}cards.forEach(card=>{load(card,'dry',false);card.querySelectorAll('button').forEach(b=>b.onclick=()=>load(card,b.dataset.treatment));card.querySelector('audio').addEventListener('play',()=>cards.forEach(other=>{if(other!==card)other.querySelector('audio').pause();}));});mode.onchange=()=>cards.forEach(card=>load(card,card.dataset.treatment));"""
page = ('<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
        '<title>Real stems — native plugin comparisons</title><style>'+style+'</style><h1>Real stems · native plugin comparisons</h1>'
        '<p>Real recordings processed through Vaudio’s YT-EQ, YT-C, YT-R and YT-Delay. Each clip has twelve seconds of performance followed by four seconds for tails.</p>'
        '<p>Play Dry, then switch treatments at the same playback position. These are controlled test settings, not recommended final mixes.</p>'
        '<label>Playback levels <select><option value="volume-matched">Volume matched</option><option value="raw">Original render levels</option></select></label>'
        '<p>Volume-matched copies use a single gain change to match RMS over the performance, with peak headroom. This approximates a fair A/B; it is not LUFS matching.</p>'
        +''.join(cards)+'<p>Recordings: “Lead Me” by The DoneFors and “In The Meantime” by Fredy V. Sources: '
        '<a href="https://huggingface.co/datasets/sparrowreivun/Mix-Evaluation-Dataset-2.0">Mix Evaluation Dataset / Open Multitrack Testbed</a>. '
        '<a href="https://creativecommons.org/licenses/by/3.0/">CC BY 3.0</a>. Excerpts, fades, input calibration and effects are modifications.</p>'
        '<script>'+script+'</script></html>')
(dest / "listen.html").write_text(page)
(root / "audition-player.js").write_text(script)
(dest / "audition-gains.json").write_text(json.dumps(audit, indent=2))
(dest / "source-and-plugin-manifest.json").write_text(json.dumps(manifest, indent=2))
(dest / "READ-ME.txt").write_text(
    "Open listen.html for an offline A/B player.\nraw/ contains the actual native engine renders.\n"
    "volume-matched/ contains audition copies with only a scalar gain change.\n"
    "No synthetic sources or Python-generated effects are included.\n"
    "The six stem excerpts use different active passages; they are not a time-aligned six-track mix.\n"
    "Original full tracks are retained in data/afx-rep-real-stems/downloads.\n"
    "Artist/song credits, CC BY 3.0 licence sources, excerpt times and full plugin settings are in the manifest.\n")
(root / "audition-folder.txt").write_text(str(dest))
print(dest)
