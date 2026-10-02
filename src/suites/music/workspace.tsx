import { useEffect } from "react";
import type { EngineKey } from "@shared/music/engine";
import { AssistantPanel } from "@/components/assistant/assistant-panel";
import { keptByWindow } from "@/components/windows/floating-window";
import { PlainWorkspace, WorkspaceError, WorkspaceLoading } from "@/components/workspace/plain-workspace";
import { BrowserPanel } from "./browser/browser-panel";
import { carriesSamples, dropAsChannels } from "./browser/drops";
import { useBrowser } from "./browser/store";
import { ChannelRack } from "./channel-rack";
import { ChannelSettingsWindow } from "./channel-settings";
import { startEngineSync } from "./engine-sync";
import { type MusicKeyAction, isGlobalKey, isTyping, resolveMusicKey, resolvePluginWindowKey } from "./keys";
import { assignFreeTracks, cloneSelected, copySteps, cutSteps, deleteSelected, moveSelected, muteAt, pasteSteps, rotate, selectNeighbour } from "./rack-actions";
import { useMusic, useSong } from "./store";
import { MusicToolbar } from "./toolbar";
import { useRecording } from "./recording";
import { switchMode, useTransport } from "./transport";
import * as playlist from "./playlist/actions";
import { type PlaylistKeyAction, resolvePlaylistKey } from "./playlist/keys";
import { PlaylistWindow } from "./playlist/playlist-window";
import { usePlaylist } from "./playlist/store";
import { resolvePianoKey, type PianoKeyAction } from "./piano/keys";
import * as piano from "./piano/actions";
import { openPianoRoll } from "./piano/actions";
import { Chopper } from "./piano/chopper";
import { NoteProperties } from "./piano/note-properties";
import { PianoRoll } from "./piano/piano-roll";
import { usePiano } from "./piano/store";
import { TransposeWindow } from "./transpose-window";
import { ExportWindow } from "./export/export-window";
import { useSongExport } from "./export/store";
import * as mixer from "./mixer/actions";
import { type MixerKeyAction, resolveMixerKey } from "./mixer/keys";
import { MixerWindow } from "./mixer/mixer-window";
import { useMixerView } from "./mixer/view";
import { type WindowId, useMusicUi, useMusicWindows } from "./ui";
import { MusicDesktop } from "./window";
import { AutomationWindow } from "./automation/automation-window";
import { AutoTuneWindow } from "./auto-tune/auto-tune-window";
import { useTuneUi } from "./auto-tune/store";
import { EchoBoyWindow } from "./echo-boy/echo-boy-window";
import { useEchoUi } from "./echo-boy/store";
import { GrossBeatWindow } from "./gross-beat/gross-beat-window";
import { PitchWheelWindow } from "./pitch-wheel/pitch-wheel-window";
import { useWheelUi } from "./pitch-wheel/store";
import { useGrossUi } from "./gross-beat/store";
import { ProQWindow } from "./pro-q/pro-q-window";
import { useEqUi } from "./pro-q/store";
import { PanManWindow } from "./panman/panman-window";
import { usePanUi } from "./panman/store";
import { AutomationChooser } from "./automation/chooser";
import { useAutomationUi } from "./automation/store";

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
        <BrowserPanel />
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
  const playlistOpen = useMusicUi((s) => s.playlistOpen);
  const mixerOpen = useMusicUi((s) => s.mixerOpen);
  const transposeOpen = useMusicUi((s) => s.transposeOpen);
  const exportOpen = useMusicUi((s) => s.exportOpen);
  const editingNote = usePiano((s) => s.editing);
  const chopping = usePiano((s) => s.chopping);
  const openIds = useMusicUi((s) => s.openChannelIds);
  const channels = useSong((song) => song.channels);
  const automations = useSong((song) => song.automations);
  const openAutomations = useAutomationUi((s) => s.openIds);
  const chooserOpen = useAutomationUi((s) => s.chooserOpen);
  const openGrossBeats = useGrossUi((s) => s.openIds);
  const openAutoTunes = useTuneUi((s) => s.openIds);
  const openEchoBoys = useEchoUi((s) => s.openIds);
  const openProQs = useEqUi((s) => s.openIds);
  const openPanMen = usePanUi((s) => s.openIds);
  const openPitchWheels = useWheelUi((s) => s.openIds);
  return (
    <MusicDesktop
      // Samples dropped on the desktop itself (not on a window) become channels, as in FL Studio.
      onDragOver={(e) => {
        if (carriesSamples(e.dataTransfer) && !(e.target as HTMLElement).closest("[data-window]")) e.preventDefault();
      }}
      onDrop={(e) => {
        if (!carriesSamples(e.dataTransfer) || (e.target as HTMLElement).closest("[data-window]")) return;
        e.preventDefault();
        void dropAsChannels(e.dataTransfer);
      }}
    >
      {playlistOpen && <PlaylistWindow />}
      {rackOpen && <ChannelRack />}
      {pianoOpen && <PianoRoll />}
      {mixerOpen && <MixerWindow />}
      {transposeOpen && <TransposeWindow />}
      {exportOpen && <ExportWindow />}
      {pianoOpen && editingNote !== null && <NoteProperties key={editingNote} />}
      {pianoOpen && chopping && <Chopper />}
      {channels.map((channel, index) => (openIds.includes(channel.id) && channel.kind !== "plugin" ? <ChannelSettingsWindow key={channel.id} channel={channel} index={index} /> : null))}
      {automations.map((automation, index) => (openAutomations.includes(automation.id) ? <AutomationWindow key={automation.id} automation={automation} index={index} /> : null))}
      {chooserOpen && <AutomationChooser />}
      {openGrossBeats.map((effectId, index) => (
        <GrossBeatWindow key={effectId} effectId={effectId} index={index} />
      ))}
      {openAutoTunes.map((effectId, index) => (
        <AutoTuneWindow key={effectId} effectId={effectId} index={index} />
      ))}
      {openEchoBoys.map((effectId, index) => (
        <EchoBoyWindow key={effectId} effectId={effectId} index={index} />
      ))}
      {openProQs.map((effectId, index) => (
        <ProQWindow key={effectId} effectId={effectId} index={index} />
      ))}
      {openPanMen.map((effectId, index) => (
        <PanManWindow key={effectId} effectId={effectId} index={index} />
      ))}
      {openPitchWheels.map((effectId, index) => (
        <PitchWheelWindow key={effectId} effectId={effectId} index={index} />
      ))}
    </MusicDesktop>
  );
}

/** The window in front: the last one touched of those open. */
function frontWindow(): WindowId | null {
  const ui = useMusicUi.getState();
  const open = (id: WindowId) =>
    id === "rack" ? ui.rackOpen
    : id === "piano" ? ui.pianoOpen
    : id === "playlist" ? ui.playlistOpen
    : id === "mixer" ? ui.mixerOpen
    : id === "transpose" ? ui.transposeOpen
    : id === "export" ? ui.exportOpen
    : id === "note" ? usePiano.getState().editing !== null
    : id === "chopper" ? usePiano.getState().chopping
    : id === "automate" ? useAutomationUi.getState().chooserOpen
    : id.startsWith("automation:") ? useAutomationUi.getState().openIds.includes(id.slice("automation:".length))
    : id.startsWith("gross:") ? useGrossUi.getState().openIds.includes(id.slice("gross:".length))
    : id.startsWith("tune:") ? useTuneUi.getState().openIds.includes(id.slice("tune:".length))
    : id.startsWith("echo:") ? useEchoUi.getState().openIds.includes(id.slice("echo:".length))
    : id.startsWith("proq:") ? useEqUi.getState().openIds.includes(id.slice("proq:".length))
    : id.startsWith("panman:") ? usePanUi.getState().openIds.includes(id.slice("panman:".length))
    : id.startsWith("wheel:") ? useWheelUi.getState().openIds.includes(id.slice("wheel:".length))
    : ui.openChannelIds.includes(id.slice("channel:".length));
  return [...useMusicWindows.getState().order].reverse().find(open) ?? null;
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
    case "chopper":
      return piano.openChopper();
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

function runPlaylistKey(action: PlaylistKeyAction) {
  switch (action.type) {
    case "tool":
      return playlist.setTool(action.tool);
    case "selectAll":
      return playlist.selectAll();
    case "deselect":
      return playlist.deselect();
    case "invert":
      return playlist.invertSelection();
    case "copy":
      return playlist.copy();
    case "cut":
      return playlist.cut();
    case "paste":
      return playlist.paste();
    case "duplicate":
      return playlist.duplicate();
    case "delete":
      return playlist.deleteSelected();
    case "mute":
      return playlist.setMuted(true);
    case "unmute":
      return playlist.setMuted(false);
    case "quantize":
      return playlist.quantize();
    case "selectSimilar":
      return playlist.selectSimilar();
    case "timeAround":
      return playlist.selectTimeAroundClips();
    case "insertSpace":
      return playlist.insertTimeSpace(false);
    case "insertSpaceSliced":
      return playlist.insertTimeSpace(true);
    case "deleteSpace":
      return playlist.deleteTimeSpace();
    case "picker":
      return usePlaylist.setState({ pickerOpen: !usePlaylist.getState().pickerOpen });
    case "centre":
      return playlist.centreOnPlayhead();
    case "home":
      return playlist.toSongStart();
    case "close":
      return useMusicUi.getState().setPlaylistOpen(false);
    case "nudge":
      return playlist.nudge(action.snaps, action.tracks);
    case "shiftTime":
      return playlist.shiftTime(action.direction);
    case "zoom":
      return playlist.zoomBy(action.factor);
    case "zoomPreset":
      return playlist.zoomPreset(action.preset);
    case "movePatterns":
      return playlist.movePickedPatterns(action.direction);
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
    case "delete":
      return mixer.deleteTracks(mixer.selectedTracks());
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
    case "exportWav":
      return void useSongExport.getState().begin("wav");
    case "exportMp3":
      return void useSongExport.getState().begin("mp3");
    case "toggleRack":
      return ui.setRackOpen(!ui.rackOpen);
    case "togglePiano":
      return ui.pianoOpen ? ui.setPianoOpen(false) : openPianoRoll();
    case "togglePlaylist":
      return ui.setPlaylistOpen(!ui.playlistOpen);
    case "toggleMode":
      return switchMode(useTransport.getState().mode === "song" ? "pattern" : "song");
    case "toggleRecord":
      return useRecording.getState().setOn(!useRecording.getState().on);
    case "toggleMixer":
      return ui.setMixerOpen(!ui.mixerOpen);
    case "toggleBrowser":
      return useBrowser.getState().setOpen(!useBrowser.getState().open);
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
      if (e.isComposing || isTyping(e.target) || keptByWindow(e.target) || dialogOpen()) return;
      // The Browser's list has keys of its own (`browser/keys.ts`): only the editor-wide ones pass it.
      const inBrowser = e.target instanceof HTMLElement && e.target.closest("[data-browser]") !== null;
      // The Piano roll's own keys, while it's the window in front.
      if (frontWindow() === "piano") {
        const piano = resolvePianoKey(e);
        if (piano) {
          e.preventDefault();
          e.stopPropagation();
          return runPianoKey(piano);
        }
      }
      // The Playlist's, while it's in front.
      if (frontWindow() === "playlist") {
        const own = resolvePlaylistKey(e);
        if (own) {
          e.preventDefault();
          e.stopPropagation();
          return runPlaylistKey(own);
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
      if (inBrowser && !isGlobalKey(action)) return;
      // With the Piano roll or the mixer in front, only the keys for everything (play, undo, the windows) are the rack's.
      if ((frontWindow() === "piano" || frontWindow() === "mixer" || frontWindow() === "playlist") && !isGlobalKey(action)) return;
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
