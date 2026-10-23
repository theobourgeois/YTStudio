import { useEffect, useSyncExternalStore } from "react";
import { PiCaretLeft, PiCaretRight, PiChartLine, PiSlidersHorizontal } from "react-icons/pi";
import { type HostPlugin, type PluginPlace, embedsPlugins, hostPlugins, hostZoom, onHostPlugins, placePlugins, pluginAction } from "@/lib/host";
import { useMusicWindows } from "../ui";
import { MusicWindow, centredOnDesktop } from "../window";
import { type Box, holes, rounded, visibleParts } from "./visible";

/** The title bar's height (px), as `FloatingWindow` draws it. */
const TITLE_HEIGHT = 28;

const BUTTON = "grid size-5.5 place-items-center rounded-sm border border-transparent text-muted-foreground hover:raised hover:raised-hover hover:text-foreground active:pressed";

/** A plugin's window's id on the music desktop. */
export const pluginWindow = (key: string) => `plugin:${key}` as const;

/**
 * The plugins' editors in the music app's window (macOS), as FL Studio has them: the engine puts each
 * plugin's view in the app's window under the page, and the page draws its frame as one of its own windows,
 * so the Channel rack, the Mixer or a menu can go in front of it. Each frame drawn, the page cuts a hole in
 * itself where each plugin shows (`clip-path` on #root, in the same paint as the windows that move over it)
 * and tells the engine where each plugin's body is and which parts of it show (`placePlugins`), where a
 * press is the plugin's.
 */
export function PluginFrames() {
  const plugins = useSyncExternalStore(onHostPlugins, hostPlugins);
  const shown = [...plugins.values()].filter((plugin) => plugin.shown);

  // A plugin clicked (or opened again) comes to the front; a closed one leaves the stacking order.
  useEffect(
    () =>
      onHostPlugins((front) => {
        const windows = useMusicWindows.getState();
        if (front) windows.focus(pluginWindow(front));
        for (const id of windows.order) if (id.startsWith("plugin:") && !hostPlugins().has(id.slice("plugin:".length))) windows.remove(id);
      }),
    [],
  );

  const placing = embedsPlugins && plugins.size > 0;
  useEffect(() => (placing ? startPlacing() : undefined), [placing]);

  if (!embedsPlugins) return null;
  return shown.map((plugin) => <PluginFrame key={plugin.key} plugin={plugin} />);
}

function PluginFrame({ plugin }: { plugin: HostPlugin }) {
  const zoom = hostZoom();
  const width = plugin.width / zoom;
  const height = plugin.height / zoom;
  return (
    <MusicWindow
      id={pluginWindow(plugin.key)}
      title={plugin.title}
      initial={centredOnDesktop(width, height + TITLE_HEIGHT)}
      onClose={() => pluginAction(plugin.key, "close")}
      controls={<PluginControls plugin={plugin} />}
    >
      <div data-plugin-body={plugin.key} style={{ width, height }} />
    </MusicWindow>
  );
}

/** FL's wrapper bar, in short: the preset and its arrows, Automate for the control last touched, and the plugin's settings. */
function PluginControls({ plugin }: { plugin: HostPlugin }) {
  const stop = (e: { stopPropagation: () => void }) => e.stopPropagation();
  return (
    <div className="flex min-w-0 items-center gap-1" onPointerDown={stop}>
      {plugin.steps && (
        <>
          <button type="button" className={BUTTON} title="Previous preset" onClick={() => pluginAction(plugin.key, "step", -1)}>
            <PiCaretLeft className="size-3" />
          </button>
          <button type="button" className={BUTTON} title="Next preset" onClick={() => pluginAction(plugin.key, "step", 1)}>
            <PiCaretRight className="size-3" />
          </button>
        </>
      )}
      {plugin.preset && <span className="max-w-40 truncate text-[11px] text-muted-foreground">{plugin.preset}</span>}
      {plugin.touched && (
        <button
          type="button"
          className="flex h-5 max-w-48 items-center gap-1 rounded-sm px-1.5 text-[11px] raised text-muted-foreground hover:raised-hover hover:text-foreground"
          title={`Make an automation clip of ${plugin.touched} (the control last touched here)`}
          onClick={() => pluginAction(plugin.key, "automate")}
        >
          <PiChartLine className="size-3 shrink-0" />
          <span className="truncate">Automate “{plugin.touched}”</span>
        </button>
      )}
      <button type="button" className={BUTTON} title="The plugin's settings" onClick={() => pluginAction(plugin.key, "settings")}>
        <PiSlidersHorizontal className="size-3.5" />
      </button>
    </div>
  );
}

const boxOf = (element: Element): Box => {
  const { x, y, width, height } = element.getBoundingClientRect();
  return { x, y, width, height };
};

/** What can be in front of a plugin besides the music windows: Settings, menus and tooltips (portals), toasts. */
function overlays(): Box[] {
  const boxes: Box[] = [];
  for (const element of document.querySelectorAll('[data-desktop="app"] [data-window], [data-sonner-toast]')) boxes.push(boxOf(element));
  for (const child of document.body.children) {
    if (child.id === "root" || child instanceof HTMLScriptElement || child instanceof HTMLStyleElement) continue;
    const box = boxOf(child);
    if (box.width > 0 && box.height > 0) boxes.push(box);
    // A portal's own box can be empty while what's in it is placed: its children count.
    else for (const inner of child.children) if (inner.getBoundingClientRect().width > 0) boxes.push(boxOf(inner));
  }
  return boxes;
}

/**
 * Where every plugin's view goes, back to front, and the page's holes for them: worked out from the page as it's
 * drawn now. The holes are the parts as they are, meeting edge to edge (the engine's are snapped out to whole pixels,
 * so they overlap, and an overlap in an even-odd clip is drawn: a line across the plugin).
 */
function places(): { places: PluginPlace[]; holes: Box[] } {
  const desktop = document.querySelector('[data-desktop="music"]');
  if (!desktop || document.visibilityState !== "visible") return { places: [], holes: [] };
  const area = boxOf(desktop);
  const windows = [...desktop.querySelectorAll<HTMLElement>("[data-window]")].map((element) => ({
    element,
    z: Number(element.style.zIndex) || 0,
    box: boxOf(element),
  }));
  const extra = overlays();
  const result: { z: number; place: PluginPlace }[] = [];
  const holes: Box[] = [];
  for (const body of desktop.querySelectorAll<HTMLElement>("[data-plugin-body]")) {
    const frame = windows.find((w) => w.element.contains(body));
    if (!frame) continue;
    const over = [...windows.filter((w) => w.z > frame.z).map((w) => w.box), ...extra];
    const parts = visibleParts(boxOf(body), [frame.box, area], over);
    holes.push(...parts);
    result.push({ z: frame.z, place: { key: body.dataset.pluginBody!, body: rounded(boxOf(body)), visible: parts.map(rounded) } });
  }
  return { places: result.sort((a, b) => a.z - b.z).map((r) => r.place), holes };
}

/**
 * Tells the engine where the plugins go whenever that changes, and cuts the page's holes for them, checking every
 * frame (windows move by transform, menus open). The page is see-through where the root doesn't paint: the
 * body's background moves to the root, which the holes are cut in. The root keeps a clip while plugins are open,
 * holes or not: one coming and going made WebKit lay the whole page out in layers again, a stall mid-drag.
 */
function startPlacing(): () => void {
  const root = document.getElementById("root");
  if (!root) return () => {};
  document.body.style.background = "transparent";
  root.style.background = "var(--background)";
  let last = "";
  let lastClip = "";
  let frame = requestAnimationFrame(function tick() {
    const now = places();
    const clip = holes(root.getBoundingClientRect(), now.holes);
    if (clip !== lastClip) root.style.clipPath = lastClip = clip;
    const text = JSON.stringify(now.places);
    if (text !== last) {
      last = text;
      placePlugins(now.places);
    }
    frame = requestAnimationFrame(tick);
  });
  return () => {
    cancelAnimationFrame(frame);
    root.style.clipPath = "";
    root.style.background = "";
    document.body.style.background = "";
    placePlugins([]);
  };
}
