/**
 * The desktop app (electron/): run it in development, or build it.
 *
 *   pnpm dev:desktop       Vite (hot reload) + Electron; the main process restarts when electron/ or server/ change
 *   pnpm build:desktop     release/mac-<arch>/Vaudio.app (unsigned), to try the packaged app
 *   pnpm package:desktop   the same as a .dmg and a .zip in release/
 *
 * The main process (electron/main.ts, which runs the server) is bundled with esbuild into one file, so the
 * packaged app ships no node_modules: just that bundle, the preload script and the built web app. The photo
 * helper (server/photo/helper-process.mjs) is the exception: a bundle of its own beside sharp's native packages,
 * in the app's resources (`photoHelper`).
 */
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { type BuildOptions, build, context } from "esbuild";
import { BASE_WEB_PORT, pickPorts } from "./ports.ts";
import { pnpmCommand, stopProcess } from "./process.ts";
import { engineArtifactName } from "../server/engine-path.ts";

const ROOT = path.resolve(import.meta.dirname, "..");
const STAGE = path.join(ROOT, "build", "desktop");
const pkg = (await import("../package.json", { with: { type: "json" } })).default as { version: string };
const electronPkg = (await import("electron/package.json", { with: { type: "json" } })).default as { version: string };
/** The music suite's audio engine (`pnpm engine:build`), shipped beside the app when it's been built. */
const ENGINE_APP = path.join(ROOT, "engine", "build", "VaudioEngine_artefacts", "Release", engineArtifactName());
const ELECTRON = createRequire(import.meta.url)("electron") as string;
/** Where the photo helper is staged: shipped in the app's resources as `photo-helper/` (electron/main.ts). */
const PHOTO_HELPER_STAGE = path.join(ROOT, "build", "photo-helper");

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

/** The bundles for `outdir`: the main process (ESM) and the preload script (CommonJS, as sandboxed preloads must be). */
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
      entryPoints: { main: path.join(ROOT, "electron/main.ts") },
      outdir,
      format: "esm",
      outExtension: { ".js": ".mjs" },
      // Bundled CommonJS packages (Express...) still call require() and read __dirname.
      banner: {
        js: [
          'import { createRequire as __createRequire } from "node:module";',
          'import { fileURLToPath as __fileURLToPath } from "node:url";',
          "const require = __createRequire(import.meta.url);",
          "const __filename = __fileURLToPath(import.meta.url);",
          "const __dirname = import.meta.dirname;",
        ].join("\n"),
      },
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
 * require of the addon is pointed there; the addon finds libvips beside it by its rpath). They're Node-API, so
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
  for (const name of [addon, `@img/sharp-libvips-${platform}`]) {
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

async function pack(targets: "dir" | "installers") {
  if (!existsSync(ENGINE_APP)) throw new Error("Build the music engine first: pnpm engine:build");
  await run("pnpm", ["build"]);
  rmSync(STAGE, { recursive: true, force: true });
  mkdirSync(STAGE, { recursive: true });
  await Promise.all(bundles(STAGE).map((options) => build(options)));
  await photoHelper();
  cpSync(path.join(ROOT, "dist"), path.join(STAGE, "dist"), { recursive: true });
  // The app's own package.json: no dependencies, everything is in the bundle.
  writeFileSync(
    path.join(STAGE, "package.json"),
    JSON.stringify({ name: "vaudio", productName: "Vaudio", version: pkg.version, private: true, type: "module", main: "main.mjs" }, null, 2),
  );
  const { build: builder } = await import("electron-builder");
  await builder({
    projectDir: ROOT,
    config: {
      appId: "gg.jestr.vaudio",
      productName: "Vaudio",
      // scripts/make-icon.ts draws it; electron-builder makes the .icns / .ico from the 1024 px PNG.
      icon: path.join(ROOT, "resources", "icon.png"),
      electronVersion: electronPkg.version,
      // Reuse the installed Electron distribution; avoids a second download/extract and Windows rename locks.
      // The folder holding Electron's app: the binary's own folder on Windows, the one around Electron.app on a Mac.
      electronDist: process.platform === "darwin" ? path.dirname(electronApp()) : path.dirname(ELECTRON),
      directories: { app: STAGE, output: path.join(ROOT, "release") },
      // Everything is bundled: electron-builder would otherwise copy in the repo's dependencies.
      files: ["**/*", "!**/*.map", "!node_modules/**"],
      npmRebuild: false,
      // electron/main.ts points the server at it (EDITOR_ENGINE_PATH).
      // And the photo helper (EDITOR_PHOTO_HELPER_PATH): outside the asar, since Node loads its native addon.
      extraResources: [...(existsSync(ENGINE_APP) ? [{ from: ENGINE_APP, to: engineArtifactName() }] : []), { from: PHOTO_HELPER_STAGE, to: "photo-helper" }],
      // Not signed with an identity yet (that needs an Apple Developer ID): signed ad hoc once it's packed,
      // before the .dmg and .zip are made of it (unsigned, macOS kills it). macOS asks to confirm the first launch.
      afterPack: async (packed) => {
        if (packed.electronPlatformName === "darwin") adHocSign(path.join(packed.appOutDir, `${packed.packager.appInfo.productFilename}.app`), { always: true });
      },
      // Projects are packages (`Name.vaudio/`): Finder shows each as one file, and double-clicking one opens it here.
      mac: {
        category: "public.app-category.video",
        identity: null,
        // The engine it starts records from inputs (a mixer track armed): macOS asks the app responsible.
        extendInfo: {
          CFBundleDocumentTypes: [{
            CFBundleTypeName: "Vaudio Project",
            CFBundleTypeRole: "Editor",
            CFBundleTypeExtensions: ["vaudio"],
            LSItemContentTypes: ["gg.jestr.vaudio.project"],
            LSHandlerRank: "Owner",
            LSTypeIsPackage: true,
          }, {
            // Images dropped on the Dock icon (or Open With) start a photo: electron/main.ts's IMAGE_TYPES.
            // An Alternate handler only, so Preview stays what opens them on a double-click.
            CFBundleTypeName: "Image",
            CFBundleTypeRole: "Editor",
            LSItemContentTypes: ["public.jpeg", "public.png", "public.tiff", "org.webmproject.webp", "public.avif"],
            LSHandlerRank: "Alternate",
          }],
          NSMicrophoneUsageDescription: "Vaudio records your microphone or audio interface when you arm a mixer track.",
          // The project type, a package (a folder Finder shows as one file), declared so macOS knows it.
          UTExportedTypeDeclarations: [
            {
              UTTypeIdentifier: "gg.jestr.vaudio.project",
              UTTypeDescription: "Vaudio Project",
              UTTypeConformsTo: ["com.apple.package", "public.composite-content"],
              UTTypeTagSpecification: { "public.filename-extension": ["vaudio"] },
            },
          ],
        },
        target: targets === "dir" ? ["dir"] : ["dmg", "zip"],
      },
      linux: { target: targets === "dir" ? ["dir"] : ["AppImage"], fileAssociations: [{ ext: "vaudio", name: "Vaudio Project", role: "Editor" }] },
      win: { target: targets === "dir" ? ["dir"] : ["nsis"], fileAssociations: [{ ext: "vaudio", name: "Vaudio Project", role: "Editor" }] },
    },
  });
  console.log(`[desktop] built into ${path.relative(ROOT, path.join(ROOT, "release"))}/`);
}

const command = process.argv[2];
if (command === "dev") await dev();
else if (command === "build") await pack("dir");
else if (command === "package") await pack("installers");
else {
  console.error("usage: tsx scripts/desktop.ts dev | build | package");
  process.exit(1);
}
