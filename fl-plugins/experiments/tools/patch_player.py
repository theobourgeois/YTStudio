"""Swaps the blind test page's <audio>-element player for a Web Audio one (one-off patch)."""
p = "C:/Users/goali/iCloudDrive/Mixing test/Blind test/index.html"
s = open(p, encoding="utf8").read()


def between(s, start, end, new):
    a, b = s.index(start), s.index(end)
    return s[:a] + new + s[b:]


s = between(s, "// Player: every contender", "const fmt = s =>", r'''// Player: the trial's five clips are decoded into memory and started on the same sample, each through its own gain.
// Switching only moves the gains (a few milliseconds' crossfade), so however fast you switch they can't drift, stall or
// overlap. Clips come as scripts (audio/<id>.js) because a page opened from disk can't fetch audio for Web Audio.
const ctx = new AudioContext({ sampleRate: 44100, latencyHint: "playback" });
const clips = new Map(); // id -> Promise<AudioBuffer>
const waiting = new Map(); // id -> what to do with its data when its script runs
window.CLIP = (id, b64) => waiting.get(id)?.(b64);

function loadClip(id) {
  if (!clips.has(id)) {
    clips.set(id, new Promise((resolve, reject) => {
      const script = document.createElement("script");
      waiting.set(id, b64 => {
        waiting.delete(id);
        script.remove();
        const bin = atob(b64), bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        ctx.decodeAudioData(bytes.buffer).then(resolve, reject);
      });
      script.onerror = () => {
        waiting.delete(id);
        clips.delete(id);
        reject(new Error("Couldn't load a clip (" + id + "): is iCloud still downloading the audio folder?"));
      };
      script.src = "audio/" + id + ".js";
      document.head.append(script);
    }));
  }
  return clips.get(id);
}

// Only this trial's clips and the next one's stay in memory; the next one's load while you listen.
function keepClips() {
  const ids = [state.order[state.at], state.order[state.at + 1]].filter(Boolean).flatMap(o => o.items);
  for (const id of [...clips.keys()]) if (!ids.includes(id)) clips.delete(id);
  for (const id of ids) loadClip(id).catch(() => {});
}

let player = null;
const SWITCH = 0.006; // the crossfade's time constant, in seconds (about 30 ms to settle)
const GAP = 0.025; // a seek or loop change fades out, jumps and fades back in over this long

function makePlayer(ids, onTick) {
  stopPlayer();
  const master = ctx.createGain();
  master.connect(ctx.destination);
  const gains = ids.map((_, i) => {
    const g = ctx.createGain();
    g.gain.value = i === 0 ? 1 : 0;
    g.connect(master);
    return g;
  });
  const p = { ids, buffers: null, loaded: 0, error: null, master, gains, sources: [], active: 0, playing: false,
              offset: 0, startedAt: 0, loop: [0, null], raf: 0, dead: false };
  player = p;
  Promise.all(ids.map(id => loadClip(id).then(b => { p.loaded++; return b; })))
    .then(bufs => { if (!p.dead) { p.buffers = bufs; keepClips(); } }, e => { if (!p.dead) p.error = e.message; });
  const tick = () => { onTick(); p.raf = requestAnimationFrame(tick); };
  p.raf = requestAnimationFrame(tick);
  return p;
}

function stopPlayer() {
  if (!player) return;
  const p = player, now = ctx.currentTime;
  p.dead = true;
  cancelAnimationFrame(p.raf);
  p.master.gain.cancelScheduledValues(now);
  p.master.gain.setTargetAtTime(0, now, 0.004);
  stopSources(p, now + GAP);
  setTimeout(() => p.master.disconnect(), 200);
  player = null;
}

const duration = () => player?.buffers ? Math.min(...player.buffers.map(b => b.duration)) : NaN;
const loopRange = () => [player.loop[0], player.loop[1] ?? duration()];

function position() {
  const p = player;
  if (!p) return 0;
  if (!p.playing) return p.offset;
  const [a, b] = loopRange();
  let t = p.offset + Math.max(0, ctx.currentTime - p.startedAt);
  if (t >= b) t = a + ((t - a) % (b - a));
  return t;
}

function startSources(p, at, when) {
  const [a, b] = loopRange();
  p.sources = p.buffers.map((buf, i) => {
    const s = ctx.createBufferSource();
    s.buffer = buf;
    s.loop = true;
    s.loopStart = a;
    s.loopEnd = b;
    s.connect(p.gains[i]);
    s.onended = () => s.disconnect();
    s.start(when, at);
    return s;
  });
  p.offset = at;
  p.startedAt = when;
}

function stopSources(p, when) {
  for (const s of p.sources) s.stop(when);
  p.sources = [];
}

// Fades out, swaps the sources for ones starting at `at`, fades back in: a jump with no click.
function restart(at) {
  const p = player, now = ctx.currentTime, when = now + GAP;
  p.master.gain.cancelScheduledValues(now);
  p.master.gain.setTargetAtTime(0, now, 0.004);
  stopSources(p, when);
  startSources(p, at, when);
  p.master.gain.setTargetAtTime(1, when, 0.004);
}

function choose(i) {
  const p = player;
  if (!p || i === p.active || i >= p.gains.length) return;
  const now = ctx.currentTime;
  p.gains.forEach((g, j) => {
    g.gain.cancelScheduledValues(now);
    g.gain.setTargetAtTime(j === i ? 1 : 0, now, SWITCH);
  });
  p.active = i;
  // Only the highlight moves: redrawing would take the slider out from under a drag that started this.
  for (const row of app.querySelectorAll(".row")) row.classList.toggle("active", +row.dataset.i === i);
}

function seek(t) {
  const p = player;
  if (!p?.buffers) return;
  const [a, b] = loopRange();
  if (t < a || t >= b) p.loop = [0, null]; // somewhere outside the loop: the loop goes
  t = Math.min(Math.max(t, 0), duration() - 0.05);
  if (p.playing) restart(t); else p.offset = t;
}

function setLoop(loop) {
  const p = player;
  if (!p?.buffers) return;
  const at = position();
  p.loop = loop;
  const [a, b] = loopRange();
  const t = at >= a && at < b ? at : a;
  if (p.playing) restart(t); else p.offset = t;
}

async function togglePlay() {
  const p = player;
  if (!p?.buffers) return;
  if (ctx.state !== "running") await ctx.resume();
  if (p !== player) return;
  const now = ctx.currentTime;
  p.master.gain.cancelScheduledValues(now);
  if (p.playing) {
    p.offset = position();
    p.playing = false;
    p.master.gain.setTargetAtTime(0, now, 0.004);
    stopSources(p, now + GAP);
  } else {
    stopSources(p, now + 0.01);
    p.master.gain.setTargetAtTime(0, now, 0.002);
    startSources(p, p.offset, now + 0.01);
    p.master.gain.setTargetAtTime(1, now + 0.01, 0.004);
    p.playing = true;
  }
  updateTransport();
}

''')

s = between(s, '  const bar = document.getElementById("bar");', '  document.getElementById("prev").onclick', '''  const bar = document.getElementById("bar");
  bar.addEventListener("pointerdown", e => {
    const r = bar.getBoundingClientRect();
    if (isFinite(duration())) seek(((e.clientX - r.left) / r.width) * duration());
  });
  document.getElementById("setA").onclick = () => {
    if (!player?.buffers) return;
    const t = position(), end = player.loop[1];
    setLoop([t, end != null && end > t + 0.5 ? end : null]);
  };
  document.getElementById("setB").onclick = () => {
    if (!player?.buffers) return;
    const t = position();
    if (t > player.loop[0] + 0.5) { setLoop([player.loop[0], t]); seek(player.loop[0]); }
  };
  document.getElementById("clearLoop").onclick = () => setLoop([0, null]);
''')

s = between(s, "function updateTransport() {", "function results() {", '''function updateTransport() {
  const play = document.getElementById("play");
  if (!player || !play) return;
  const loading = !player.buffers;
  play.textContent = player.playing ? "❚❚" : "▶";
  play.disabled = loading;
  const status = player.error ? `<span class="loading">${esc(player.error)}</span>`
    : loading ? `<span class="loading">Loading ${player.loaded}/${player.ids.length}…</span>` : "";
  const st = document.getElementById("status");
  if (st.innerHTML !== status) st.innerHTML = status;
  const d = duration(), t = position();
  document.getElementById("fill").style.width = (isFinite(d) ? (t / d) * 100 : 0) + "%";
  document.getElementById("time").textContent = fmt(t) + " / " + fmt(d);
  const loop = document.getElementById("loop");
  const looped = isFinite(d) && (player.loop[0] > 0 || player.loop[1] != null);
  loop.hidden = !looped;
  if (looped) {
    loop.style.left = (player.loop[0] / d) * 100 + "%";
    loop.style.width = (((player.loop[1] ?? d) - player.loop[0]) / d) * 100 + "%";
  }
}

''')

old_keys = '''  else if (e.key === " ") { togglePlay(); e.preventDefault(); }
});'''
assert old_keys in s
# A clicked button keeps no focus (else Space would press it as well as play), and a held Space doesn't repeat.
s = s.replace(old_keys, '''  else if (e.key === " ") { e.preventDefault(); if (!e.repeat) togglePlay(); }
});
document.addEventListener("keyup", e => { if (e.key === " " && e.target.tagName !== "TEXTAREA") e.preventDefault(); });
document.addEventListener("click", e => e.target.closest?.("button")?.blur());''')

old_start = 'document.getElementById("start").onclick = () => { state.page'
assert old_start in s
s = s.replace(old_start, 'document.getElementById("start").onclick = () => { ctx.resume(); state.page')
s = s.replace(".bar .fill { position: absolute;", ".bar .fill, .bar .loop { pointer-events: none; }\n  .bar .fill { position: absolute;")
s = s.replace("  render();\n}\n\nconst fmt", "}\n\nconst fmt")
open(p, "w", encoding="utf8").write(s)
print("patched")
