/**
 * The desktop app (electron/): run it in development, or build it.
 *
 *   pnpm dev:desktop [app]      Vite (hot reload) + Electron; the main process restarts when electron/ or server/ change
 *   pnpm build:desktop [app…]   release/mac-<arch>/YTStudio.app (unsigned), to try the packaged app; an app's
 *                               (video, photo, visualizer, music: docs/apps.md) in release/<app>/
 *   pnpm package:desktop [app…] the same as a .dmg and a .zip
 *   pnpm update:desktop [app…]  build them and install them in place of the ones installed (macOS, Windows): by
 *                               default YTStudio (every suite) and Video, Photo and the Visualizer, and on a Mac
 *                               Music (the engine's own app, no Electron: `packMusicMac`)
 *
 * The main process (electron/main.ts, which runs the server) is bundled with esbuild into one file, so the
 * packaged app ships no node_modules: just that bundle, the preload script and the built web app. The photo
 * helper (server/photo/helper-process.mjs) is the exception: a bundle of its own beside sharp's native packages,
 * in the app's resources (`photoHelper`).
 */
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { type BuildOptions, build, context } from "esbuild";
import { BASE_WEB_PORT, pickPorts } from "./ports.ts";
import { pnpmCommand, stopProcess } from "./process.ts";
import { engineArtifactName } from "../server/engine-path.ts";
import { type AppId, type AppInfo, APPS, EVERY_APP, appInfo, isAppId } from "../shared/apps.ts";
import { SUITES, SUITE_IDS, type SuiteId } from "../shared/suites.ts";

const ROOT = path.resolve(import.meta.dirname, "..");

/**
 * The project types: each suite's (`.ytvid`, `.ytsng`, `.ytimg`), then `.yt` (when YTStudio was one app) and
 * `.vaudio` (before it was YTStudio), still declared so those open too (and are renamed to their suite's).
 */
const SUITE_TYPES = SUITE_IDS.map((suite) => ({ suite, id: `gg.jestr.ytstudio.${suite}.project`, name: `YTStudio ${SUITES[suite].label}`, ext: SUITES[suite].extension.slice(1) }));
const LEGACY_TYPES = [
  { id: "gg.jestr.ytstudio.project", name: "YTStudio Project (old)", ext: "yt" },
  { id: "gg.jestr.vaudio.project", name: "YTStudio Project (old)", ext: "vaudio" },
];

/**
 * The apps that are apps of their own so far (docs/apps.md): YTStudio, with every suite, still opens their files,
 * but as a second choice, so a double-click opens them in theirs. Music is one on a Mac (the engine's own window,
 * `packMusicMac`); on Windows it joins once the engine's window is done there (step 3).
 */
const OWN_APPS: AppId[] = ["video", "photo", "visualizer", ...(process.platform === "darwin" ? (["music"] as const) : [])];
/** What `update:desktop` installs: YTStudio (every suite) and the apps of their own. */
const INSTALLED_APPS: (AppId | null)[] = [null, ...OWN_APPS];

/** The project types an app opens (none for the Visualizer), and whether it's their first choice. */
function projectTypes(app: AppInfo) {
  const own = (suite: SuiteId) => !app.id ? !OWN_APPS.some((id) => APPS[id].suites.includes(suite)) : true;
  return [
    ...SUITE_TYPES.filter((type) => app.suites.includes(type.suite)).map((type) => ({ ...type, owner: own(type.suite) })),
    // Older files are anyone's: YTStudio keeps them, an app takes them as a second choice.
    ...(app.suites.length > 0 ? LEGACY_TYPES.map((type) => ({ ...type, owner: !app.id })) : []),
  ];
}

const MAC_CATEGORY: Record<AppId | "every", string> = {
  every: "public.app-category.video",
  video: "public.app-category.video",
  music: "public.app-category.music",
  photo: "public.app-category.photography",
  visualizer: "public.app-category.entertainment",
};

/** Where an app is built: YTStudio's in release/, each app's in a folder of its own. */
const releaseDir = (app: AppInfo) => path.join(ROOT, "release", ...(app.id ? [app.id] : []));
/** The built app on a Mac. */
const builtMacApp = (app: AppInfo) => path.join(releaseDir(app), process.arch === "arm64" ? "mac-arm64" : "mac", `${app.name}.app`);
const STAGE = path.join(ROOT, "build", "desktop");
const pkg = (await import("../package.json", { with: { type: "json" } })).default as { version: string };
const electronPkg = (await import("electron/package.json", { with: { type: "json" } })).default as { version: string };
/** The music suite's audio engine (`pnpm engine:build`), shipped beside the app when it's been built. */
const ENGINE_APP = path.join(ROOT, "engine", "build", "VaudioEngine_artefacts", "Release", engineArtifactName());
const ELECTRON = createRequire(import.meta.url)("electron") as string;
/** Where the photo helper is staged: shipped in the app's resources as `photo-helper/` (electron/main.ts). */
const PHOTO_HELPER_STAGE = path.join(ROOT, "build", "photo-helper");
/** Where the music suite's models' worker is staged: shipped as `music-worker/` (electron/main.ts). */
const MUSIC_WORKER_STAGE = path.join(ROOT, "build", "music-worker");

/**
 * The environment for Electron: without ELECTRON_RUN_AS_NODE, which terminals inside Electron apps (VS Code,
 * T3 Code...) pass on and which would make it a plain Node.js.
 */
function electronEnv(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const env = { ...process.env, ...extra };
  delete env.ELECTRON_RUN_AS_NODE;
  return env;
}

/**
 * Sign a macOS app again, ad hoc (no identity), if its seal doesn't hold. Electron's own build comes with a
 * broken one (44.5.0's names resources, `_CodeSignature`, that its download doesn't have), and macOS 26
 * kills it the moment it loads code ("Code Signature Invalid"); the packaged app, unsigned by
 * electron-builder, would inherit it. Signed again ad hoc it runs, and opens as an unsigned app does.
 */
function adHocSign(app: string, { always = false } = {}) {
  if (process.platform !== "darwin") return;
  if (!always && spawnSync("codesign", ["--verify", "--deep", "--strict", app]).status === 0) return;
  console.log(`[desktop] signing ${path.basename(app)} again, ad hoc (its signature doesn't hold, and macOS would kill it)`);
  const signed = spawnSync("codesign", ["--force", "--deep", "--sign", "-", app], { stdio: "inherit" });
  if (signed.status !== 0) throw new Error(`Couldn't sign ${app}: try \`codesign --force --deep --sign - "${app}"\`.`);
}

/** The Electron.app `pnpm install` put in node_modules (what `node_modules/.bin/electron` runs). */
function electronApp(): string {
  const binary = createRequire(import.meta.url)("electron") as string;
  return binary.slice(0, binary.indexOf(".app") + ".app".length);
}

/** Bundled CommonJS packages (Express...) still call require() and read __dirname. */
const ESM_BANNER = [
  'import { createRequire as __createRequire } from "node:module";',
  'import { fileURLToPath as __fileURLToPath } from "node:url";',
  "const require = __createRequire(import.meta.url);",
  "const __filename = __fileURLToPath(import.meta.url);",
  "const __dirname = import.meta.dirname;",
].join("\n");

/** The bundles for `outdir`: the main process and the server's (ESM) and the preload script (CommonJS, as sandboxed preloads must be). */
function bundles(outdir: string): BuildOptions[] {
  const common: BuildOptions = {
    bundle: true,
    platform: "node",
    target: "node24",
    sourcemap: "linked",
    // The desktop app draws exports in its own Chromium, so Playwright stays out (see server/gl-browser.ts).
    external: ["electron", "playwright-core"],
    logLevel: "warning",
  };
  return [
    {
      ...common,
      // The server runs in a process of its own (electron/server-host.ts), from the file beside main.mjs.
      entryPoints: { main: path.join(ROOT, "electron/main.ts"), "server-process": path.join(ROOT, "electron/server-process.ts") },
      outdir,
      format: "esm",
      outExtension: { ".js": ".mjs" },
      banner: { js: ESM_BANNER },
    },
    {
      ...common,
      entryPoints: { preload: path.join(ROOT, "electron/preload.ts") },
      outdir,
      format: "cjs",
      outExtension: { ".js": ".cjs" },
    },
  ];
}

function run(command: string, args: string[], env: NodeJS.ProcessEnv = {}): Promise<void> {
  return new Promise((resolve, reject) => {
    const [binary, argv] = command === "pnpm" ? pnpmCommand(args) : [command, args];
    const child = spawn(binary, argv, { cwd: ROOT, stdio: "inherit", env: { ...process.env, ...env } });
    child.on("error", reject);
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${command} ${args.join(" ")} exited with ${code}`))));
  });
}

async function waitFor(url: string, timeoutMs = 60_000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      // Not up yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`${url} didn't come up`);
}

async function dev() {
  adHocSign(electronApp());
  const { web, server } = await pickPorts();
  if (web !== BASE_WEB_PORT) console.log(`[desktop] ${BASE_WEB_PORT} is taken, using ports ${web} (app) / ${server} (server)`);
  const outdir = path.join(ROOT, "dist-electron");
  const env = { EDITOR_WEB_PORT: String(web), EDITOR_SERVER_PORT: String(server) };
  const vite = spawn(...pnpmCommand(["exec", "vite"]), { cwd: ROOT, stdio: "inherit", env: { ...process.env, ...env } });

  let electron: ChildProcess | null = null;
  let stopping = false;
  const stop = (code = 0) => {
    stopping = true;
    if (electron) stopProcess(electron);
    stopProcess(vite);
    process.exit(code);
  };
  const launch = () => {
    // EDITOR_DESKTOP_ARGS: more arguments for Electron (tests attach with `--remote-debugging-port=0`).
    const extra = (process.env.EDITOR_DESKTOP_ARGS ?? "").split(/\s+/).filter(Boolean);
    const child = spawn(ELECTRON, [path.join(outdir, "main.mjs"), ...extra], {
      cwd: ROOT,
      stdio: "inherit",
      env: electronEnv({ ...env, EDITOR_DESKTOP_DEV_URL: `http://localhost:${web}` }),
    });
    // Quitting the app ends the session; a restart (below) doesn't.
    child.on("exit", () => {
      if (electron === child && !stopping) stop();
    });
    electron = child;
  };
  // Changes close together (the main process and the preload are two bundles) make one restart, and a
  // restart waiting for the old app to quit launches the latest bundles itself. Two at once would race
  // for the single-instance lock: the loser quits, and its exit ended the session.
  let waiting = false;
  let soon: ReturnType<typeof setTimeout> | undefined;
  const restart = () => {
    clearTimeout(soon);
    soon = setTimeout(() => {
      if (waiting) return;
      const old = electron;
      electron = null;
      if (!old || old.exitCode !== null) return launch();
      waiting = true;
      old.once("exit", () => {
        waiting = false;
        if (!stopping) launch();
      });
      stopProcess(old);
    }, 250);
  };

  // Watching builds each bundle once first: that isn't a change.
  let first = true;
  let initial = 0;
  let watching!: () => void;
  const watched = new Promise<void>((resolve) => (watching = resolve));
  const builds = bundles(outdir);
  const contexts = await Promise.all(
    builds.map((options) =>
      context({
        ...options,
        plugins: [
          {
            name: "restart-electron",
            setup(b) {
              b.onEnd((result) => {
                if (first) {
                  if (++initial === builds.length) watching();
                  return;
                }
                if (result.errors.length) return;
                console.log("[desktop] main process changed, restarting");
                restart();
              });
            },
          },
        ],
      }),
    ),
  );
  await Promise.all(contexts.map((c) => c.watch()));
  await watched;
  first = false;
  await waitFor(`http://localhost:${web}/`);
  launch();
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) process.on(signal, () => stop());
  vite.on("exit", (code) => {
    if (!stopping) stop(code ?? 1);
  });
}

/**
 * The photo helper, bundled with sharp's JavaScript into `helper.mjs`, and sharp's native packages for this
 * platform beside it in `native/@img/` (electron-builder leaves out any folder called node_modules, so the bundle's
 * require of the addon is pointed there; the addon finds libvips beside it). Windows includes libvips DLLs in
 * the addon package; macOS and Linux use a separate libvips package. They're Node-API, so
 * Electron runs them in Node mode as they are. libvips is LGPL-3.0-or-later, dynamically linked: its package keeps
 * its licence and notices.
 */
async function photoHelper() {
  rmSync(PHOTO_HELPER_STAGE, { recursive: true, force: true });
  // sharp's packages don't export their package.json: they're found beside sharp itself (pnpm links them there).
  let sharpDir = path.dirname(createRequire(import.meta.url).resolve("sharp"));
  while (!existsSync(path.join(sharpDir, "package.json"))) sharpDir = path.dirname(sharpDir);
  const platform = `${process.platform}-${process.arch}`;
  const addon = `@img/sharp-${platform}`;
  const dirs: Record<string, string> = {};
  const nativePackages = process.platform === "win32" ? [addon] : [addon, `@img/sharp-libvips-${platform}`];
  for (const name of nativePackages) {
    const dir = [path.join(path.dirname(sharpDir), name), path.join(ROOT, "node_modules", name)].find((d) => existsSync(path.join(d, "package.json")));
    if (!dir) throw new Error(`Couldn't find ${name}: run pnpm install.`);
    dirs[name] = realpathSync(dir);
    cpSync(dirs[name], path.join(PHOTO_HELPER_STAGE, "native", name), { recursive: true, dereference: true });
  }
  const outfile = path.join(PHOTO_HELPER_STAGE, "helper.mjs");
  await build({
    entryPoints: [path.join(ROOT, "server", "photo", "helper-process.mjs")],
    outfile,
    bundle: true,
    platform: "node",
    target: "node24",
    format: "esm",
    external: ["@img/sharp-*"],
    banner: { js: 'import { createRequire as __createRequire } from "node:module";\nconst require = __createRequire(import.meta.url);' },
    logLevel: "warning",
  });
  // sharp loads its addon through a require of its own (esbuild can't see it): point that one at native/.
  const bundle = readFileSync(outfile, "utf8");
  const from = `"${addon}/sharp.node"`;
  if (bundle.split(from).length !== 2) throw new Error(`Expected sharp to require ${from} once; its loader changed.`);
  writeFileSync(outfile, bundle.replace(from, JSON.stringify(`./${path.posix.join("native", addon, "index.cjs")}`)));
}

/**
 * The music suite's models' worker (server/music/ml-worker.mjs: Extract stems, Convert to notes), bundled with ONNX
 * Runtime's JavaScript into `ml-worker.mjs`, and its native binding and library for this platform beside it in
 * `native/onnxruntime/` (the binding finds the library beside it: its rpath is its own folder). Node-API, so Electron
 * runs it in Node mode as it is. ONNX Runtime is MIT.
 */
async function musicWorker() {
  rmSync(MUSIC_WORKER_STAGE, { recursive: true, force: true });
  let ortDir = path.dirname(createRequire(import.meta.url).resolve("onnxruntime-node"));
  while (!existsSync(path.join(ortDir, "package.json"))) ortDir = path.dirname(ortDir);
  const binaries = path.join(realpathSync(ortDir), "bin", "napi-v6", process.platform, process.arch);
  if (!existsSync(path.join(binaries, "onnxruntime_binding.node"))) throw new Error(`ONNX Runtime has no binding for ${process.platform}-${process.arch}: run pnpm install.`);
  const native = path.join(MUSIC_WORKER_STAGE, "native", "onnxruntime");
  cpSync(binaries, native, { recursive: true, dereference: true });
  // On a Mac the library is there twice (its versioned name too); the binding loads libonnxruntime.1.dylib.
  for (const file of readdirSync(native)) if (/^libonnxruntime\.\d+\.\d+\.\d+\.dylib$/.test(file)) rmSync(path.join(native, file));
  // The binding is required by a path of its own making (each platform's): it's this platform's, in native/.
  const binding = "require(`../bin/napi-v6/${process.platform}/${process.arch}/onnxruntime_binding.node`)";
  await build({
    entryPoints: [path.join(ROOT, "server", "music", "ml-worker.mjs")],
    outfile: path.join(MUSIC_WORKER_STAGE, "ml-worker.mjs"),
    bundle: true,
    platform: "node",
    target: "node24",
    format: "esm",
    banner: { js: 'import { createRequire as __createRequire } from "node:module";\nconst require = __createRequire(import.meta.url);' },
    logLevel: "warning",
    plugins: [
      {
        name: "onnxruntime-binding",
        setup(b) {
          b.onLoad({ filter: /onnxruntime-node[\\/]dist[\\/]binding\.js$/ }, (args) => {
            const source = readFileSync(args.path, "utf8");
            if (source.split(binding).length !== 2) throw new Error(`Expected ONNX Runtime to load its binding with ${binding} once; its loader changed.`);
            return { contents: source.replace(binding, 'require("./native/onnxruntime/onnxruntime_binding.node")'), loader: "js" };
          });
          b.onResolve({ filter: /\.node$/ }, (args) => ({ path: args.path, external: true }));
        },
      },
    ],
  });
}

/** The apps named on the command line (`video photo`, `all`), else `fallback`; `every` is YTStudio's. */
function appsFrom(args: string[], fallback: (AppId | null)[]): AppInfo[] {
  if (args.length === 0) return fallback.map(appInfo);
  if (args.includes("all")) return INSTALLED_APPS.map(appInfo);
  return args.map((arg) => {
    if (arg === "every") return EVERY_APP;
    if (!isAppId(arg)) throw new Error(`No app called ${arg}: every, ${Object.keys(APPS).join(", ")} or all.`);
    return APPS[arg];
  });
}

/** Build the web app, the bundles and the helpers once, then package each app from them. */
async function pack(targets: "dir" | "installers", apps: AppInfo[]) {
  const music = apps.some((app) => app.suites.includes("music"));
  if (music && !existsSync(ENGINE_APP)) throw new Error("Build the music engine first: pnpm engine:build");
  await run("pnpm", ["build"]);
  rmSync(STAGE, { recursive: true, force: true });
  mkdirSync(STAGE, { recursive: true });
  await Promise.all(bundles(STAGE).map((options) => build(options)));
  await photoHelper();
  if (music) await musicWorker();
  cpSync(path.join(ROOT, "dist"), path.join(STAGE, "dist"), { recursive: true });
  for (const app of apps) {
    if (app.id === "music" && process.platform === "darwin") await packMusicMac(targets, app);
    else await packApp(targets, app);
  }
}

/**
 * What a Mac app says of itself beyond its name: the project types it opens (packages Finder shows as one file, each
 * opened in its app on a double-click), what it asks the system for and why. electron-builder's `extendInfo`, and the
 * music app's own Info.plist (`packMusicMac`).
 */
function macInfo(app: AppInfo): Record<string, unknown> {
  const music = app.suites.includes("music");
  const types = projectTypes(app);
  return {
    CFBundleDocumentTypes: [
      ...[true, false].flatMap((owner) => {
        const these = types.filter((type) => type.owner === owner);
        return these.length === 0
          ? []
          : [{
              CFBundleTypeName: `${app.name} Project`,
              CFBundleTypeRole: "Editor",
              CFBundleTypeExtensions: these.map((type) => type.ext),
              LSItemContentTypes: these.map((type) => type.id),
              LSHandlerRank: owner ? "Owner" : "Alternate",
              LSTypeIsPackage: true,
            }];
      }),
      // Images dropped on the Dock icon (or Open With) start a photo: electron/main.ts's IMAGE_TYPES.
      // An Alternate handler only, so Preview stays what opens them on a double-click.
      ...(app.suites.includes("photo")
        ? [{
            CFBundleTypeName: "Image",
            CFBundleTypeRole: "Editor",
            LSItemContentTypes: ["public.jpeg", "public.png", "public.tiff", "org.webmproject.webp", "public.avif"],
            LSHandlerRank: "Alternate",
          }]
        : []),
    ],
    // The engine it starts records from inputs (a mixer track armed): macOS asks the app responsible.
    ...(music ? { NSMicrophoneUsageDescription: `${app.name} records your microphone or audio interface when you arm a mixer track.` } : {}),
    // Now Playing: the visualizer listens to what the computer plays, and the app asks Spotify what that is.
    ...(app.visualizer
      ? {
          NSAudioCaptureUsageDescription: `${app.name}'s visualizer listens to what your computer is playing, to move with it. Nothing is recorded.`,
          NSAppleEventsUsageDescription: `${app.name} asks Spotify what's playing, and plays, pauses or skips when you tell it to.`,
        }
      : {}),
    // The project types, packages (a folder Finder shows as one file), declared so macOS knows them.
    UTExportedTypeDeclarations: types.map((type) => ({
      UTTypeIdentifier: type.id,
      UTTypeDescription: type.name,
      UTTypeConformsTo: ["com.apple.package", "public.composite-content"],
      UTTypeTagSpecification: { "public.filename-extension": [type.ext] },
    })),
  };
}

async function packApp(targets: "dir" | "installers", app: AppInfo) {
  const music = app.suites.includes("music");
  const types = projectTypes(app);
  // The app's own package.json: no dependencies, everything is in the bundle. `ytstudioApp` says which app it is
  // (electron/main.ts).
  writeFileSync(
    path.join(STAGE, "package.json"),
    JSON.stringify(
      { name: app.id ? `ytstudio-${app.id}` : "ytstudio", productName: app.name, version: pkg.version, private: true, type: "module", main: "main.mjs", ...(app.id ? { ytstudioApp: app.id } : {}) },
      null,
      2,
    ),
  );
  const { build: builder } = await import("electron-builder");
  await builder({
    projectDir: ROOT,
    config: {
      appId: app.bundleId,
      productName: app.name,
      // scripts/make-icon.ts draws them; electron-builder makes the .icns / .ico from the 1024 px PNG.
      icon: path.join(ROOT, "resources", app.id ? path.join("apps", `${app.id}.png`) : "icon.png"),
      electronVersion: electronPkg.version,
      // Reuse the installed Electron distribution; avoids a second download/extract and Windows rename locks.
      // The folder holding Electron's app: the binary's own folder on Windows, the one around Electron.app on a Mac.
      electronDist: process.platform === "darwin" ? path.dirname(electronApp()) : path.dirname(ELECTRON),
      directories: { app: STAGE, output: releaseDir(app) },
      // Everything is bundled: electron-builder would otherwise copy in the repo's dependencies.
      files: ["**/*", "!**/*.map", "!node_modules/**"],
      npmRebuild: false,
      // electron/main.ts points the server at it (EDITOR_ENGINE_PATH), where songs are made.
      // And the photo helper (EDITOR_PHOTO_HELPER_PATH), which every app's media need: outside the asar, since Node
      // loads its native addon.
      // And the music suite's models' worker (EDITOR_MUSIC_WORKER_PATH), with ONNX Runtime's native library beside it.
      extraResources: [
        ...(music ? [{ from: ENGINE_APP, to: engineArtifactName() }] : []),
        { from: PHOTO_HELPER_STAGE, to: "photo-helper" },
        ...(music ? [{ from: MUSIC_WORKER_STAGE, to: "music-worker" }] : []),
      ],
      // Not signed with an identity yet (that needs an Apple Developer ID): signed ad hoc once it's packed,
      // before the .dmg and .zip are made of it (unsigned, macOS kills it). macOS asks to confirm the first launch.
      afterPack: async (packed) => {
        if (packed.electronPlatformName === "darwin") adHocSign(path.join(packed.appOutDir, `${packed.packager.appInfo.productFilename}.app`), { always: true });
      },
      mac: {
        category: MAC_CATEGORY[app.id ?? "every"],
        identity: null,
        extendInfo: macInfo(app),
        target: targets === "dir" ? ["dir"] : ["dmg", "zip"],
      },
      linux: { target: targets === "dir" ? ["dir"] : ["AppImage"], fileAssociations: types.map((type) => ({ ext: type.ext, name: type.name, role: "Editor" })) },
      win: { target: targets === "dir" ? ["dir"] : ["nsis"], fileAssociations: types.map((type) => ({ ext: type.ext, name: type.name, role: "Editor" })) },
    },
  });
  console.log(`[desktop] built ${app.name} into ${path.relative(ROOT, releaseDir(app))}/`);
}

/** Where the music app's Node is kept once downloaded: `build/node/node-<version>-darwin-<arch>/bin/node`. */
const NODE_CACHE = path.join(ROOT, "build", "node");

/**
 * Node's official build for this Mac, of the version running this script (what the server is tested on), checked
 * against nodejs.org's sums and kept in build/node. Official builds stand alone (Homebrew's links libraries of its
 * own), which is what an app can ship.
 */
async function officialNode(): Promise<string> {
  const name = `node-${process.version}-darwin-${process.arch === "arm64" ? "arm64" : "x64"}`;
  const binary = path.join(NODE_CACHE, name, "bin", "node");
  if (existsSync(binary)) return binary;
  const base = `https://nodejs.org/dist/${process.version}/`;
  console.log(`[desktop] downloading ${name} from nodejs.org`);
  const sums = await (await fetch(`${base}SHASUMS256.txt`)).text();
  const expected = sums.split("\n").find((line) => line.endsWith(`  ${name}.tar.gz`))?.split(/\s+/)[0];
  if (!expected) throw new Error(`nodejs.org lists no ${name}.tar.gz: is ${process.version} a release?`);
  const response = await fetch(`${base}${name}.tar.gz`);
  if (!response.ok) throw new Error(`Couldn't download ${name}.tar.gz (${response.status})`);
  const tarball = Buffer.from(await response.arrayBuffer());
  const actual = createHash("sha256").update(tarball).digest("hex");
  if (actual !== expected) throw new Error(`${name}.tar.gz isn't what nodejs.org says it is (sha256 ${actual}, expected ${expected})`);
  mkdirSync(NODE_CACHE, { recursive: true });
  const file = path.join(NODE_CACHE, `${name}.tar.gz`);
  writeFileSync(file, tarball);
  const unpacked = spawnSync("tar", ["-xzf", file, "-C", NODE_CACHE, `${name}/bin/node`, `${name}/LICENSE`], { stdio: "inherit" });
  rmSync(file);
  if (unpacked.status !== 0 || !existsSync(binary)) throw new Error(`Couldn't unpack ${name}.tar.gz`);
  return binary;
}

/** A 1024 px PNG as the .icns a Mac app's Info.plist names. */
function macIcon(png: string, icns: string) {
  const set = `${icns.slice(0, -".icns".length)}.iconset`;
  rmSync(set, { recursive: true, force: true });
  mkdirSync(set, { recursive: true });
  for (const size of [16, 32, 128, 256, 512]) {
    for (const scale of [1, 2]) {
      const file = path.join(set, `icon_${size}x${size}${scale === 2 ? "@2x" : ""}.png`);
      const made = spawnSync("sips", ["-z", String(size * scale), String(size * scale), png, "--out", file], { stdio: "ignore" });
      if (made.status !== 0) throw new Error(`sips couldn't size ${png}`);
    }
  }
  const made = spawnSync("iconutil", ["-c", "icns", set, "-o", icns], { stdio: "inherit" });
  rmSync(set, { recursive: true, force: true });
  if (made.status !== 0) throw new Error(`iconutil couldn't make ${icns}`);
}

/**
 * The music app on a Mac (docs/apps.md, step 4): no Electron. The engine is the app, so its bundle becomes
 * `YTStudio Music.app`, with what it runs in `Contents/Resources/app` (engine/src/Main.cpp's `appResources`): Node,
 * the server's bundle (`server.mjs`, the same server the other apps run in Electron), the page (`dist/`), the photo
 * helper and the models' worker. The engine's own Info.plist is given the app's name, icon and project types. It
 * stays LSUIElement: the window shows the Dock icon (ShellWindow), and the engines the server starts for Home's
 * previews, this same program, never flash one.
 */
async function packMusicMac(targets: "dir" | "installers", app: AppInfo) {
  const node = await officialNode();
  const built = builtMacApp(app);
  rmSync(releaseDir(app), { recursive: true, force: true });
  mkdirSync(path.dirname(built), { recursive: true });
  const copied = spawnSync("ditto", [ENGINE_APP, built], { stdio: "inherit" });
  if (copied.status !== 0) throw new Error(`Couldn't copy ${ENGINE_APP}`);
  const contents = path.join(built, "Contents");
  renameSync(path.join(contents, "MacOS", "YTStudio Engine"), path.join(contents, "MacOS", app.name));

  const resources = path.join(contents, "Resources", "app");
  mkdirSync(resources, { recursive: true });
  cpSync(node, path.join(resources, "node"));
  cpSync(path.join(path.dirname(path.dirname(node)), "LICENSE"), path.join(resources, "node-LICENSE"));
  await build({
    entryPoints: { server: path.join(ROOT, "server/index.ts") },
    outdir: resources,
    bundle: true,
    platform: "node",
    target: "node24",
    format: "esm",
    outExtension: { ".js": ".mjs" },
    banner: { js: ESM_BANNER },
    // Exports draw video in Chromium (server/gl-browser.ts): never in a song's, and Playwright stays out.
    external: ["playwright-core"],
    logLevel: "warning",
  });
  cpSync(path.join(STAGE, "dist"), path.join(resources, "dist"), { recursive: true });
  cpSync(PHOTO_HELPER_STAGE, path.join(resources, "photo-helper"), { recursive: true });
  cpSync(MUSIC_WORKER_STAGE, path.join(resources, "music-worker"), { recursive: true });
  macIcon(path.join(ROOT, "resources", "apps", `${app.id}.png`), path.join(contents, "Resources", "icon.icns"));

  const plist = path.join(contents, "Info.plist");
  const info = JSON.parse(spawnSync("plutil", ["-convert", "json", "-o", "-", plist], { encoding: "utf8" }).stdout) as Record<string, unknown>;
  Object.assign(info, {
    CFBundleName: app.name,
    CFBundleDisplayName: app.name,
    CFBundleExecutable: app.name,
    CFBundleIdentifier: app.bundleId,
    CFBundleVersion: pkg.version,
    CFBundleShortVersionString: pkg.version,
    CFBundleIconFile: "icon.icns",
    LSApplicationCategoryType: MAC_CATEGORY.music,
    ...macInfo(app),
  });
  writeFileSync(plist, JSON.stringify(info));
  if (spawnSync("plutil", ["-convert", "xml1", plist], { stdio: "inherit" }).status !== 0) throw new Error(`plutil couldn't write ${plist}`);
  // Not signed with an identity yet (see packApp): ad hoc, the whole bundle, now that it's all in.
  adHocSign(built, { always: true });

  if (targets === "installers") {
    const dmg = path.join(releaseDir(app), `${app.name}-${pkg.version}-${process.arch}.dmg`);
    const made = spawnSync("hdiutil", ["create", "-volname", app.name, "-srcfolder", built, "-ov", "-format", "UDZO", dmg], { stdio: "inherit" });
    if (made.status !== 0) throw new Error(`hdiutil couldn't make ${dmg}`);
  }
  console.log(`[desktop] built ${app.name} into ${path.relative(ROOT, releaseDir(app))}/`);
}

/** Where an app is installed on a Mac; its data (userData, ~/Documents/YTStudio) is outside it, so replacing it keeps that. */
const installedMacApp = (app: AppInfo) => `/Applications/${app.name}.app`;

/** Wait for `running` to turn false, so nothing of the old app holds its files. */
async function untilQuit(app: AppInfo, running: () => boolean) {
  const until = Date.now() + 30_000;
  while (running()) {
    if (Date.now() > until) throw new Error(`${app.name} didn't quit: quit it and run pnpm update:desktop again.`);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

/**
 * Build the apps and install them in place of the ones installed: over /Applications/<name>.app on a Mac, by their
 * own installers, silently, on Windows. Each running app is quit (asked, so it saves) only once the build is done,
 * then opened again if it was running.
 */
async function update(apps: AppInfo[]) {
  if (process.platform !== "darwin" && process.platform !== "win32") throw new Error("update:desktop installs on macOS and Windows only.");
  // Incremental: a no-op when the engine hasn't changed.
  if (apps.some((app) => app.suites.includes("music"))) await run("pnpm", ["engine:build"]);
  if (process.platform === "win32") return updateWindows(apps);
  await pack("dir", apps);
  for (const app of apps) {
    const built = builtMacApp(app);
    if (!existsSync(built)) throw new Error(`Built app not found at ${built}`);
    const installed = installedMacApp(app);
    const running = () => spawnSync("pgrep", ["-f", `${installed}/Contents/MacOS/`]).status === 0;
    const wasRunning = running();
    if (wasRunning) {
      console.log(`[desktop] quitting ${app.name}`);
      spawnSync("osascript", ["-e", `tell application id "${app.bundleId}" to quit`], { stdio: "inherit" });
      await untilQuit(app, running);
    }
    rmSync(installed, { recursive: true, force: true });
    const copied = spawnSync("ditto", [built, installed], { stdio: "inherit" });
    if (copied.status !== 0) throw new Error(`Couldn't copy ${built} to ${installed}`);
    console.log(`[desktop] installed ${installed}`);
    if (wasRunning) spawnSync("open", [installed]);
  }
}

/**
 * Windows: each app's NSIS installer, run silently, puts it where it goes (per user, no admin), keeps the Start
 * menu shortcut and the file types, and replaces an installed one (or installs it the first time).
 */
async function updateWindows(apps: AppInfo[]) {
  await pack("installers", apps);
  for (const app of apps) {
    const dir = releaseDir(app);
    const installer = readdirSync(dir)
      .filter((name) => name.startsWith(`${app.name} Setup `) && name.endsWith(`${pkg.version}.exe`))
      .map((name) => path.join(dir, name))[0];
    if (!installer) throw new Error(`No ${app.name} Setup ${pkg.version}.exe in ${path.relative(ROOT, dir)}/`);
    const runningImage = (image: string) =>
      (spawnSync("tasklist", ["/FI", `IMAGENAME eq ${image}`, "/NH"], { encoding: "utf8" }).stdout ?? "").toLowerCase().includes(image.toLowerCase());
    const image = `${app.name}.exe`;
    const music = app.suites.includes("music");
    const running = () => runningImage(image) || (music && runningImage(engineArtifactName("win32")));
    const wasRunning = runningImage(image);
    if (wasRunning) {
      console.log(`[desktop] quitting ${app.name}`);
      // Without /F: its windows are asked to close, so the page saves first (flushBeforeClose), then the engine quits.
      spawnSync("taskkill", ["/IM", image], { stdio: "inherit" });
    }
    await untilQuit(app, running);
    console.log(`[desktop] installing ${path.basename(installer)}`);
    // --force-run: electron-builder's installer starts the app once installed, even silently.
    const installed = spawnSync(installer, wasRunning ? ["/S", "--force-run"] : ["/S"], { stdio: "inherit" });
    if (installed.status !== 0) throw new Error(`${path.basename(installer)} exited with ${installed.status}`);
    console.log(`[desktop] installed ${app.name}`);
  }
}

const [command, ...args] = process.argv.slice(2);
if (command === "dev") {
  // `pnpm dev:desktop video`: one app (docs/apps.md), as EDITOR_APP would.
  const [app] = appsFrom(args, [null]);
  if (app.id) process.env.EDITOR_APP = app.id;
  await dev();
} else if (command === "build") await pack("dir", appsFrom(args, [null]));
else if (command === "package") await pack("installers", appsFrom(args, [null]));
else if (command === "update") await update(appsFrom(args, INSTALLED_APPS));
else if (command === "music-worker") await musicWorker();
else {
  console.error("usage: tsx scripts/desktop.ts dev [app] | build [app…] | package [app…] | update [app…]  (app: every, video, music, photo, visualizer, all)");
  process.exit(1);
}
