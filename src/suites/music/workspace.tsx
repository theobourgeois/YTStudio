import { useEffect } from "react";
import type { EngineKey } from "@shared/music/engine";
import { AssistantPanel } from "@/components/assistant/assistant-panel";
import { PlainWorkspace, WorkspaceError, WorkspaceLoading } from "@/components/workspace/plain-workspace";
import { ChannelRack } from "./channel-rack";
import { ChannelSettingsWindow } from "./channel-settings";
import { startEngineSync } from "./engine-sync";
import { type MusicKeyAction, isGlobalKey, isTyping, resolveMusicKey, resolvePluginWindowKey } from "./keys";
import { assignFreeTracks, cloneSelected, copySteps, cutSteps, deleteSelected, moveSelected, muteAt, pasteSteps, rotate, selectNeighbour } from "./rack-actions";
import { useMusic, useSong } from "./store";
import { MusicToolbar } from "./toolbar";
import { useTransport } from "./transport";
import { resolvePianoKey, type PianoKeyAction } from "./piano/keys";
import * as piano from "./piano/actions";
import { openPianoRoll } from "./piano/actions";
import { NoteProperties } from "./piano/note-properties";
import { PianoRoll } from "./piano/piano-roll";
import { usePiano } from "./piano/store";
import { TransposeWindow } from "./transpose-window";
import * as mixer from "./mixer/actions";
import { type MixerKeyAction, resolveMixerKey } from "./mixer/keys";
import { MixerWindow } from "./mixer/mixer-window";
import { useMixerView } from "./mixer/view";
import { type WindowId, useMusicUi } from "./ui";
import { Desktop } from "./window";

/** The music suite's main column (`clientSuite("music").Workspace`): its toolbar, its windows, its assistant. */
export default function MusicWorkspace() {
  const projectId = useMusic((s) => s.projectId);
  const loaded = useMusic((s) => s.history !== null);
  const loadError = useMusic((s) => s.loadError);

  // The engine plays the open song for as long as it's open.
  useEffect(() => (projectId && loaded ? startEngineSync({ onKey: runPluginWindowKey }) : undefined), [projectId, loaded]);
  useMusicKeys(loaded);

  if (!projectId || !loaded) {
    return <PlainWorkspace>{loadError ? <WorkspaceError noun="song" error={loadError} /> : <WorkspaceLoading />}</PlainWorkspace>;
  }
  return (
    <div key={projectId} className="flex min-h-0 flex-1 flex-col" data-suite="music">
      <MusicToolbar />
      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          <Windows />
        </div>
        <AssistantPanel suite="music" />
      </div>
    </div>
  );
}

/** The editor's desktop and the windows open on it: the channel rack, and the settings of the channels clicked. */
function Windows() {
  const rackOpen = useMusicUi((s) => s.rackOpen);
  const pianoOpen = useMusicUi((s) => s.pianoOpen);
  const mixerOpen = useMusicUi((s) => s.mixerOpen);
  const transposeOpen = useMusicUi((s) => s.transposeOpen);
  const editingNote = usePiano((s) => s.editing);
  const openIds = useMusicUi((s) => s.openChannelIds);
  const channels = useSong((song) => song.channels);
  return (
    <Desktop>
      {rackOpen && <ChannelRack />}
      {pianoOpen && <PianoRoll />}
      {mixerOpen && <MixerWindow />}
      {transposeOpen && <TransposeWindow />}
      {pianoOpen && editingNote !== null && <NoteProperties key={editingNote} />}
      {channels.map((channel, index) => (openIds.includes(channel.id) && channel.kind === "sampler" ? <ChannelSettingsWindow key={channel.id} channel={channel} index={index} /> : null))}
    </Desktop>
  );
}

/** The window in front: the last one touched of those open. */
function frontWindow(): WindowId | null {
  const ui = useMusicUi.getState();
  const open = (id: WindowId) =>
    id === "rack" ? ui.rackOpen
    : id === "piano" ? ui.pianoOpen
    : id === "mixer" ? ui.mixerOpen
    : id === "transpose" ? ui.transposeOpen
    : id === "note" ? usePiano.getState().editing !== null
    : ui.openChannelIds.includes(id.slice("channel:".length));
  return [...ui.order].reverse().find(open) ?? null;
}

function runPianoKey(action: PianoKeyAction) {
  switch (action.type) {
    case "tool":
      return piano.setTool(action.tool);
    case "selectAll":
      return piano.selectAll();
    case "deselect":
      return piano.deselect();
    case "invert":
      return piano.invertSelection();
    case "copy":
      return piano.copy();
    case "cut":
      return piano.cut();
    case "paste":
      return piano.paste();
    case "duplicate":
      return piano.duplicate();
    case "delete":
      return piano.deleteSelected();
    case "glue":
      return piano.glue();
    case "chop":
      return piano.chop();
    case "quantize":
      return piano.quantize("both");
    case "quantizeStarts":
      return piano.quantize("starts");
    case "legato":
      return piano.legato();
    case "discard":
      return piano.discard();
    case "mute":
      return piano.setMuted(true);
    case "unmute":
      return piano.setMuted(false);
    case "ghosts":
      return piano.toggleGhosts();
    case "lane":
      return piano.toggleLane();
    case "nextLane":
      return piano.nextLane();
    case "timeAround":
      return piano.selectTimeAroundNotes();
    case "centre":
      return piano.centreOnPlayhead();
    case "close":
      return useMusicUi.getState().setPianoOpen(false);
    case "nudge":
      if (action.by === "snap") return piano.nudgeBySnap(action.direction as -1 | 1);
      return piano.nudge(action.by === "tick" ? action.direction : 0, action.semitones);
    case "rotate":
      return piano.rotate(action.direction);
    case "shiftTime":
      return piano.shiftTime(action.direction);
    case "channel":
      return piano.stepChannel(action.direction, action.withNotes);
    case "zoom":
      return piano.zoomBy(action.factor);
    case "zoomPreset":
      return piano.zoomPreset(action.preset);
  }
}

function runMixerKey(action: MixerKeyAction) {
  switch (action.type) {
    case "solo":
      return mixer.soloTrack(mixer.currentTrack(), action.linked);
    case "route":
      return mixer.routeSelectedChannels(undefined, action.starting);
    case "selectChannels":
      return mixer.selectChannelsOn();
    case "move":
      return mixer.moveSelectedTracks(action.direction);
    case "select":
      return mixer.selectNeighbourTrack(action.direction);
    case "selectAll":
      return mixer.selectAllTracks();
    case "rename":
      return useMixerView.getState().rename(mixer.currentTrack());
  }
}

function runKey(action: MusicKeyAction) {
  const ui = useMusicUi.getState();
  switch (action.type) {
    case "togglePlay":
      return useTransport.getState().toggle();
    case "undo":
      return useMusic.getState().undo();
    case "redo":
      return useMusic.getState().redo();
    case "toggleRack":
      return ui.setRackOpen(!ui.rackOpen);
    case "togglePiano":
      return ui.pianoOpen ? ui.setPianoOpen(false) : openPianoRoll();
    case "toggleMixer":
      return ui.setMixerOpen(!ui.mixerOpen);
    case "toggleTrackSelectors":
      return ui.setTrackSelectorsShown(!ui.trackSelectorsShown);
    case "assignFreeTracks":
      return assignFreeTracks();
    case "toggleGraph":
      return ui.setGraphOpen(!ui.graphOpen);
    case "mute":
      return muteAt(action.index, false);
    case "solo":
      return muteAt(action.index, true);
    case "select":
      return selectNeighbour(action.direction, action.extend);
    case "move":
      return moveSelected(action.direction);
    case "rotate":
      return rotate(action.direction);
    case "clone":
      return cloneSelected();
    case "delete":
      return deleteSelected();
    case "copy":
      return copySteps();
    case "cut":
      return cutSteps();
    case "paste":
      return pasteSteps();
  }
}

/** Dialogs and open menus own the keyboard. */
const dialogOpen = () => document.querySelector(":is([role=dialog], [role=alertdialog], [role=menu]):not([data-state=closed])") !== null;

/**
 * A key a plugin's window passed on (the engine's own window: the page doesn't have the focus). Only a
 * tab that's showing runs it, so two tabs don't both toggle play.
 */
function runPluginWindowKey(key: EngineKey) {
  const action = resolvePluginWindowKey(key);
  if (action && document.visibilityState === "visible" && !dialogOpen()) runKey(action);
}

/** The music editor's keys (`keys.ts`). (The video editor's shortcuts are off without a video open.) */
function useMusicKeys(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.isComposing || isTyping(e.target) || dialogOpen()) return;
      // The Piano roll's own keys, while it's the window in front.
      if (frontWindow() === "piano") {
        const piano = resolvePianoKey(e);
        if (piano) {
          e.preventDefault();
          e.stopPropagation();
          return runPianoKey(piano);
        }
      }
      // The mixer's, while it's in front.
      if (frontWindow() === "mixer") {
        const own = resolveMixerKey(e);
        if (own) {
          e.preventDefault();
          e.stopPropagation();
          return runMixerKey(own);
        }
      }
      const action = resolveMusicKey(e);
      if (!action) return;
      // With the Piano roll or the mixer in front, only the keys for everything (play, undo, the windows) are the rack's.
      if ((frontWindow() === "piano" || frontWindow() === "mixer") && !isGlobalKey(action)) return;
      // Copying text that's selected on the page is still the browser's.
      if (action.type === "copy" && window.getSelection()?.toString()) return;
      // A focused knob, number or list keeps its own arrows. (A menu's button doesn't: it opens with Enter.)
      const own = e.target instanceof HTMLElement && e.target.closest("[role=slider], [role=spinbutton], [role=combobox]");
      if (own && action.type === "select") return;
      e.preventDefault();
      // Ours alone: whatever has the focus (a menu's button opens on Alt+Down, a knob turns) doesn't see it too.
      e.stopPropagation();
      runKey(action);
    };
    // Before the page's own handlers, for the same reason.
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [enabled]);
}
