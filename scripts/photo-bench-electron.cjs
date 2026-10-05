/**
 * The photo bench's Electron runner (scripts/photo-bench.ts starts it): opens the lab page in a hidden window with
 * the desktop app's own web preferences and switches, runs the plan in `PHOTO_BENCH_PLAN` through
 * `window.photoLab.bench.runPlan`, prints the results as one JSON line, and quits.
 */
const { app, BrowserWindow } = require("electron");

// As electron/main.ts: GPU process crashes never stop the page getting an adapter again.
app.commandLine.appendSwitch("disable-gpu-process-crash-limit");
app.commandLine.appendSwitch("disable-domain-blocking-for-3d-apis");

app.whenReady().then(async () => {
  const window = new BrowserWindow({
    show: false,
    width: 1600,
    height: 1000,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false },
  });
  window.webContents.on("console-message", (event) => {
    if (event.level === "error") process.stderr.write(`[page] ${event.message}\n`);
  });
  try {
    await window.loadURL(process.env.PHOTO_BENCH_URL);
    const plan = process.env.PHOTO_BENCH_PLAN;
    const results = await window.webContents.executeJavaScript(
      `(async () => { await window.photoLab.ready; return window.photoLab.bench.runPlan(${plan}); })()`,
    );
    process.stdout.write(`PHOTO_BENCH_RESULT ${JSON.stringify({ electron: process.versions.electron, chrome: process.versions.chrome, results })}\n`);
  } catch (error) {
    process.stdout.write(`PHOTO_BENCH_RESULT ${JSON.stringify({ error: String(error) })}\n`);
  }
  app.quit();
});
