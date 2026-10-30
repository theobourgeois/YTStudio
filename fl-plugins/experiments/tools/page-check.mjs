// Opens the blind test page in headless Chromium, goes through one trial (load, play, switch, rate) and screenshots it.
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
const require = createRequire("C:/Users/goali/code/editor/package.json");
const { chromium } = require("playwright-core");

const page_ = (process.argv[2] ?? "C:/Users/goali/iCloudDrive/Mixing test/Blind test") + "/index.html";
const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
const page = await browser.newPage({ viewport: { width: 1000, height: 900 } });
const errors = [];
page.on("pageerror", e => errors.push(e.message));
page.on("console", m => m.type() === "error" && errors.push(m.text()));
await page.goto(pathToFileURL(page_).href);
await page.screenshot({ path: "C:/Users/goali/flrender/out/page-intro.png", fullPage: true });
await page.click("#start");
await page.waitForFunction(() => !document.getElementById("play").disabled, null, { timeout: 30000 });
await page.keyboard.press("Space");
await page.waitForTimeout(1500);
await page.keyboard.press("3");
await page.waitForTimeout(800);
const t = await page.evaluate(() => [...document.querySelectorAll(".row")].map(r => r.classList.contains("active")));
const times = await page.evaluate(() => document.getElementById("time").textContent);
for (const r of await page.$$("input[type=range]")) await r.fill(String(40 + Math.floor(Math.random() * 60)));
await page.screenshot({ path: "C:/Users/goali/flrender/out/page-trial.png", fullPage: true });
console.log("active rows", t, "time", times, "next enabled", await page.isEnabled("#next"));
for (let i = 0; i < 8; i++) {
  for (const r of await page.$$("input[type=range]")) await r.fill(String(40 + Math.floor(Math.random() * 60)));
  await page.click("#next");
}
await page.screenshot({ path: "C:/Users/goali/flrender/out/page-done.png", fullPage: true });
console.log("errors", errors);
await browser.close();

