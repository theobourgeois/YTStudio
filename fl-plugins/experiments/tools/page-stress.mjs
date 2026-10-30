// Hammers the blind test page's player (fast switching, play/pause, seeks, loops, trial changes) and checks the audio
// graph after each: one version audible, five sources running while playing, none while paused, the clock moving.
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
const require = createRequire("C:/Users/goali/code/editor/package.json");
const { chromium } = require("playwright-core");

const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
const page = await browser.newPage({ viewport: { width: 1000, height: 900 } });
const errors = [];
page.on("pageerror", e => errors.push(e.message));
page.on("console", m => m.type() === "error" && errors.push(m.text()));
await page.goto(pathToFileURL((process.argv[2] ?? "C:/Users/goali/iCloudDrive/Mixing test/Blind test") + "/index.html").href);
await page.click("#start");

const look = () => page.evaluate(() => ({
  playing: player.playing, active: player.active, sources: player.sources.length, ctx: ctx.state,
  gains: player.gains.map(g => +g.gain.value.toFixed(3)), pos: +position().toFixed(3), loop: player.loop,
}));
const problems = [];
const expect = (what, ok, s) => { if (!ok) problems.push(what + " " + JSON.stringify(s)); };
async function settle(label, playing) {
  await page.waitForTimeout(150);
  const s = await look();
  const loud = s.gains.filter(g => g > 0.99).length, quiet = s.gains.filter(g => g < 0.01).length;
  // Paused, Chrome stops updating gains nothing plays through (they finish once it plays again): checked only playing.
  if (playing) expect(label + ": one audible", loud === 1 && quiet === 4 && s.gains[s.active] > 0.99, s);
  expect(label + ": playing", s.playing === playing, s);
  expect(label + ": sources", s.sources === (playing ? 5 : 0), s);
  if (playing) {
    const a = s.pos;
    await page.waitForTimeout(300);
    const b = (await look()).pos;
    const moved = b > a ? b - a : b + 30 - a;
    expect(label + ": clock moves ~0.3 s", moved > 0.2 && moved < 0.45, { a, b });
  }
  return s;
}

for (let trial = 0; trial < 3; trial++) {
  await page.waitForFunction(() => player?.buffers, null, { timeout: 60000 });
  const t0 = Date.now();
  await page.keyboard.press("Space");
  await settle(`t${trial} play`, true);
  for (let i = 0; i < 60; i++) { await page.keyboard.press(String(1 + Math.floor(Math.random() * 5))); await page.waitForTimeout(Math.random() * 15); }
  await settle(`t${trial} fast keys`, true);
  for (let i = 0; i < 30; i++) await page.click(`.row[data-i="${i % 5}"] .key`);
  await settle(`t${trial} fast clicks`, true);
  for (let i = 0; i < 9; i++) { await page.keyboard.press("Space"); await page.waitForTimeout(Math.random() * 20); }
  await settle(`t${trial} fast space (odd)`, false);
  await page.keyboard.press("Space");
  await settle(`t${trial} resume`, true);
  const box = await page.locator("#bar").boundingBox();
  for (let i = 0; i < 15; i++) await page.mouse.click(box.x + Math.random() * box.width, box.y + box.height / 2);
  await page.mouse.click(box.x + box.width * 0.5, box.y + box.height / 2);
  const s = await settle(`t${trial} seeks`, true);
  expect(`t${trial} seek lands mid-clip`, s.pos > 14.5 && s.pos < 16.5, s);
  // A loop from 15.x s to about 17 s: playback stays inside it.
  await page.click("#setA");
  await page.waitForTimeout(1500);
  await page.click("#setB");
  for (let i = 0; i < 12; i++) {
    await page.waitForTimeout(250);
    const l = await look();
    expect(`t${trial} stays in loop`, l.pos >= l.loop[0] - 0.01 && l.pos <= l.loop[1] + 0.01, l);
  }
  await page.keyboard.press("3");
  await settle(`t${trial} switch in loop`, true);
  await page.click("#clearLoop");
  await settle(`t${trial} loop cleared`, true);
  // Space while a letter button has focus must not press it as well.
  await page.click(`.row[data-i="1"] .key`);
  await page.keyboard.press("Space");
  const sp = await settle(`t${trial} space after click`, false);
  expect(`t${trial} space after click keeps B`, sp.active === 1, sp);
  await page.keyboard.press("Space");
  await settle(`t${trial} play after click`, true);
  await page.keyboard.press("Space");
  for (const r of await page.$$("input[type=range]")) await r.fill(String(40 + Math.floor(Math.random() * 60)));
  console.log(`trial ${trial} done in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  await page.click("#next");
  const after = await page.evaluate(() => ({ playing: player.playing, sources: player.sources.length }));
  expect(`t${trial} next trial starts quiet`, !after.playing && after.sources === 0, after);
}
const mem = await page.evaluate(() => clips.size);
console.log("clips held", mem);
console.log(problems.length ? problems.join("\n") : "no problems");
console.log("errors", errors);
await browser.close();
