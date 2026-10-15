/**
 * The layering that keeps the suites apart, checked on every import in the repo:
 *
 *   platform   what every suite stands on: projects, the sidebar, the assistant, storage, UI primitives
 *   a suite    music (`shared/music/`, `server/music/`, `src/suites/music/`...), and video, which came
 *              first and is everything at the roots that isn't platform
 *   registry   the few files that list every suite, and so may import them all
 *
 * A suite may import the platform and itself, never another suite. The platform may not import a
 * suite, except through a registry. What breaks that today is listed in `DEBT`: the test fails when
 * a new leak appears, and when a listed one is fixed (so the list only shrinks).
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(import.meta.dirname, "..");

/** Suites with folders of their own. Add a suite's here when it's made. */
const SUITE_FOLDERS: Record<string, string[]> = {
  music: ["shared/music/", "server/music/", "server/suites/music.ts", "src/suites/music/"],
  photo: ["shared/photo/", "server/photo/", "server/suites/photo.ts", "src/suites/photo/"],
};

/** Files that list every suite (or wire the app together), so they import all of them. */
const REGISTRIES = [
  "shared/suites.ts",
  "shared/suite-tools.ts",
  "server/suites/index.ts",
  "server/app.ts",
  "src/suites/index.ts",
  // The component gallery shows every suite's controls.
  "src/gallery/gallery.tsx",
];

/** A trailing slash is a folder. Everything else at the roots is the video editor's. */
const PLATFORM = [
  "shared/tool-spec.ts",
  "shared/ids.ts",
  // Models run on this computer, downloaded when the user says yes (the photo suite's, the music suite's).
  "shared/models.ts",
  "server/models.ts",
  "shared/assistant.ts",
  "shared/math.ts",
  "shared/format.ts",
  "shared/errors.ts",
  // The HTTP API's types, with the video editor's domain types still among them.
  "shared/types.ts",
  // The app's icon (the desktop app's, picked in Settings).
  "shared/app-icons.ts",
  "src/stores/app-icon.ts",
  "server/index.ts",
  "server/config.ts",
  "server/engine-path.ts",
  "server/storage.ts",
  "server/process.ts",
  "server/queue.ts",
  // The app's log: every suite's server side, its tab and the desktop app write it.
  "shared/log.ts",
  "server/log.ts",
  "server/routes/log.ts",
  "src/lib/log.ts",
  // The API-key store is shared by transcription and music classification.
  "server/transcription/settings.ts",
  // Music analysis (tempo, beats): the video editor's beat sync and the music suite's Detect tempo.
  "server/beats.ts",
  // Signals (what a sound does over time, docs/visualizer/): their format, analysis and reading, and the
  // server's job that makes them for every file with sound.
  "shared/signals/",
  "server/signals.ts",
  // Project media, every suite's (video's clips, music's samples, photo's sources): the store, its probe,
  // posters, filmstrips and waveforms, ffmpeg's looks into a file, and `/api/media`.
  "shared/media.ts",
  "server/media.ts",
  "server/probe.ts",
  "server/derivatives.ts",
  // Uncompressed audio read without ffmpeg, for the probe and the waveforms.
  "server/pcm.ts",
  "server/ffmpeg.ts",
  "server/media-analysis.ts",
  "server/routes/media.ts",
  // Online media (YouTube's search and links yt-dlp reads): the video editor's Online panel, the music Browser's Online tab.
  "server/web-media.ts",
  "server/routes/web.ts",
  "src/components/media/use-web-search.ts",
  "server/projects.ts",
  // Now Playing (docs/now-playing.md): what the music player is playing, in every suite's top bar.
  "shared/now-playing.ts",
  // A cover's colours, by role (a look takes on each song's).
  "shared/palette.ts",
  // The pill in the top bar, the tab's side (listening to the computer's sound), where the visualizer opens.
  "src/stores/now-playing.ts",
  "src/lib/live-audio.ts",
  // Hearing what's playing's vibe (CLAP), for Now Playing.
  "src/lib/vibe.ts",
  "src/lib/vibe-worker.ts",
  "src/components/now-playing/",
  "server/now-playing.ts",
  "server/now-playing-windows.ts",
  "server/routes/now-playing.ts",
  // Work handed from one suite to another (a song made into a video: Make visualizer).
  "shared/handoff.ts",
  "server/project-previews.ts",
  "server/packages.ts",
  "server/routes/projects.ts",
  "server/routes/assistant.ts",
  "server/routes/util.ts",
  "server/assistant/",
  "server/suites/suite.ts",
  "src/main.tsx",
  "src/App.tsx",
  "src/suites/types.ts",
  "src/stores/projects.ts",
  // The open projects as tabs (pure).
  "src/stores/project-tabs.ts",
  // Whether the window starts with the tab strip (Settings › General).
  "src/stores/window-chrome.ts",
  "src/stores/assistant.ts",
  // The assistant's checkpoints (restore a message, Keep all / Undo all), every suite's.
  "src/lib/checkpoints.ts",
  "src/stores/checkpoints.ts",
  "src/stores/theme.ts",
  // The app's icon (its colourways), app-wide as the theme is.
  "shared/app-icons.ts",
  "src/stores/app-icon.ts",
  "src/themes/",
  "src/stores/settings.ts",
  "src/stores/app-windows.ts",
  "src/stores/layout.ts",
  "src/lib/api.ts",
  "src/lib/route.ts",
  "src/lib/desktop.ts",
  "src/lib/focus-rings.ts",
  // Shortcut labels and words for the computer the app runs on (⌘ or Ctrl, Finder or File Explorer).
  "src/lib/key-labels.ts",
  "src/lib/pointer-drag.ts",
  // Generic card selection is shared by media/library grids and music's insert setup.
  "src/components/media/grid-selection.ts",
  "src/components/media/use-grid-selection.tsx",
  // Which window an element is in: the editor's windows can be windows of the system (docs/windows.md).
  "src/lib/window-events.ts",
  "shared/panels.ts",
  "src/lib/document-history.ts",
  "src/lib/autosaver.ts",
  "src/lib/color.ts",
  // The fonts installed on this computer (the video editor's text, the photo suite's Type tool).
  "src/stores/fonts.ts",
  "src/hooks/use-now.ts",
  "src/hooks/use-file-drop.ts",
  "src/lib/dnd.ts",
  "src/assistant/bridge.ts",
  "src/components/ui/",
  "src/gallery/",
  "src/components/color-picker.tsx",
  "src/components/scrub-number.tsx",
  "src/components/home/",
  "src/components/assistant/",
  "src/components/header/header.tsx",
  // Every suite's header starts the same way: the menu row (name, menus, then undo, Settings, Export, the assistant).
  "src/components/header/header-actions.tsx",
  "src/components/header/menu-row.tsx",
  "src/components/header/project-name.tsx",
  // The window's own buttons, at the end of the bar that starts the window when the tab strip is hidden.
  "src/components/header/window-buttons.tsx",
  "src/components/settings/",
  "src/components/windows/",
  "src/components/dock/",
  "src/components/workspace/workspace.tsx",
  "src/components/workspace/plain-workspace.tsx",
];

/**
 * Platform code that still reaches into the video editor ("importer -> imported"). Fixing one means
 * moving what's shared into the platform (ids, autosave, undo) or behind `ClientSuite`.
 */
const DEBT: string[] = [
  // shared/types.ts is the platform's API types and the video editor's document at once; its clips' paths
  // and text layouts are types of the video editor's. Splitting the video document out of it fixes these.
  "shared/types.ts -> shared/path.ts",
  "shared/types.ts -> shared/text-drawing.ts",
  "src/App.tsx -> src/components/shortcuts/shortcuts-dialog.tsx",
  "src/App.tsx -> src/hooks/use-prevent-file-navigation.ts",
  "src/App.tsx -> src/hooks/use-shortcuts.ts",
  "src/components/assistant/assistant-button.tsx -> src/hooks/shortcuts.ts",
  "src/components/assistant/assistant-panel.tsx -> src/hooks/shortcuts.ts",
  "src/components/assistant/markdown.tsx -> src/stores/playback.ts",
  "src/components/assistant/tool-steps.tsx -> shared/timeline.ts",
  "src/components/assistant/tool-steps.tsx -> src/stores/editor.ts",
  "src/components/assistant/tool-steps.tsx -> src/stores/playback.ts",
  "src/components/header/header.tsx -> src/components/header/settings-dialog.tsx",
  "src/components/header/header.tsx -> src/stores/editor.ts",
  "src/components/header/header.tsx -> src/stores/video-windows.ts",
  "src/stores/projects.ts -> src/stores/autosave.ts",
];

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((entry) => {
    const file = `${dir}/${entry.name}`;
    if (entry.isDirectory()) return sourceFiles(file);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [file] : [];
  });
}

const FILES = ["shared", "server", "src"].flatMap(sourceFiles);
const KNOWN = new Set(FILES);

/** The repo file an import names, or null for packages and Node. */
function resolveImport(from: string, spec: string): string | null {
  const base = spec.startsWith("@/")
    ? `src/${spec.slice(2)}`
    : spec.startsWith("@shared/")
      ? `shared/${spec.slice(8)}`
      : spec.startsWith(".")
        ? path.posix.join(path.posix.dirname(from), spec)
        : null;
  if (!base) return null;
  return [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`].find((c) => KNOWN.has(c)) ?? null;
}

function importsOf(file: string): string[] {
  const source = fs.readFileSync(path.join(ROOT, file), "utf8");
  const found = [...source.matchAll(/(?:\bfrom|\bimport)\s*\(?\s*["']([^"']+)["']/g)].map((m) => resolveImport(file, m[1]));
  return [...new Set(found.filter((f): f is string => f !== null))];
}

const inAny = (file: string, entries: string[]) => entries.some((e) => (e.endsWith("/") ? file.startsWith(e) : file === e));

/** "platform", "registry", or the suite a file belongs to. */
function zoneOf(file: string): string {
  if (REGISTRIES.includes(file)) return "registry";
  const suite = Object.keys(SUITE_FOLDERS).find((id) => inAny(file, SUITE_FOLDERS[id]));
  if (suite) return suite;
  return inAny(file, PLATFORM) ? "platform" : "video";
}

/** Every import that crosses a line it shouldn't, as "importer -> imported". */
function leaks(allowed: (from: string, to: string) => boolean): string[] {
  return FILES.flatMap((file) => {
    const from = zoneOf(file);
    return importsOf(file)
      .filter((target) => !allowed(from, zoneOf(target)))
      .map((target) => `${file} -> ${target}`);
  }).sort();
}

describe("architecture", () => {
  it("knows the files it names", () => {
    const named = [...REGISTRIES, ...PLATFORM, ...Object.values(SUITE_FOLDERS).flat()];
    expect(named.filter((e) => !FILES.some((f) => inAny(f, [e])))).toEqual([]);
  });

  it("keeps each suite out of the others", () => {
    const crossing = leaks((from, to) => from === "platform" || from === "registry" || to === from || to === "platform" || to === "registry");
    expect(crossing).toEqual([]);
  });

  it("keeps the platform out of the suites, but for the known debt", () => {
    const reaching = leaks((from, to) => from !== "platform" || to === "platform" || to === "registry");
    expect(reaching).toEqual([...DEBT].sort());
  });
});
