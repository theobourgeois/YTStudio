import { type ReactNode, useEffect } from "react";
import type { EngineKey } from "@shared/music/engine";
import { AssistantPanel } from "@/components/assistant/assistant-panel";
import { PopupContainerProvider } from "@/components/ui/portal-container";
import { keptByWindow, nativeWindowsOn } from "@/components/windows/floating-window";
import { useMainWindowPopups } from "@/components/windows/native/popups";
import { addWindowListener, isHtmlElement, ownerWindow, queryAnywhere } from "@/lib/window-events";
import { PlainWorkspace, WorkspaceError, WorkspaceLoading } from "@/components/workspace/plain-workspace";
import { BrowserPanel } from "./browser/browser-panel";
import { togglePreview } from "./browser/actions";
import { carriesSamples, dropAsChannels } from "./browser/drops";
import { useBrowser } from "./browser/store";
import { ChannelRack } from "./channel-rack";
import { ChannelSettingsWindow } from "./channel-settings";
import { startEngineSync } from "./engine-sync";
import { type MusicKeyAction, isGlobalKey, isTyping, resolveMusicKey, resolvePluginWindowKey, takesMenuKey } from "./keys";
import { IS_MAC } from "@/lib/key-labels";
import { assignFreeTracks, cloneSelected, copySteps, cutSteps, deleteSelected, moveSelected, muteAt, pasteSteps, rotate, selectNeighbour } from "./rack-actions";
import { useMusic, useSong } from "./store";
import { MusicToolbar } from "./toolbar";
import { useRecording } from "./recording";
import { typingKey, useMidi } from "./midi";
import { switchMode, useTransport } from "./transport";
import * as playlist from "./playlist/actions";
import { type PlaylistKeyAction, resolvePlaylistKey } from "./playlist/keys";
import { PlaylistWindow } from "./playlist/playlist-window";
import { usePlaylist } from "./playlist/store";
import { resolvePianoKey, type PianoKeyAction } from "./piano/keys";
import * as piano from "./piano/actions";
import { openPianoRoll } from "./piano/actions";
import { Chopper } from "./piano/chopper";
import { Quantizer } from "./piano/quantizer";
import { NoteProperties } from "./piano/note-properties";
import { PianoRoll } from "./piano/piano-roll";
import { usePiano } from "./piano/store";
import { TransposeWindow } from "./transpose-window";
import { ConvertWindow } from "./convert/convert-window";
import { useConvert } from "./convert/actions";
import { StemsWindow } from "./stems/stems-window";
import { useStems } from "./stems/actions";
import { PluginManager } from "./plugin-manager";
import { ExportWindow } from "./export/export-window";
import { VisualizerWindow } from "./visualizer/visualizer-window";
import { useSongExport } from "./export/store";
import * as mixer from "./mixer/actions";
import { type MixerKeyAction, resolveMixerKey } from "./mixer/keys";
import { MixerWindow } from "./mixer/mixer-window";
import { FillInsertsWindow } from "./mixer/fill-inserts";
import { useMixerView } from "./mixer/view";
import { type WindowId, useMusicUi, useMusicWindows } from "./ui";
import { MusicDesktop } from "./window";
import { AutomationWindow } from "./automation/automation-window";
import { ModulatorsWindow } from "./modulation/modulators-window";
import { useModulationUi } from "./modulation/store";
import { AutoTuneWindow } from "./auto-tune/auto-tune-window";
import { useTuneUi } from "./auto-tune/store";
import { EchoBoyWindow } from "./echo-boy/echo-boy-window";
import { useEchoUi } from "./echo-boy/store";
import { GrossBeatWindow } from "./gross-beat/gross-beat-window";
import { PitchWheelWindow } from "./pitch-wheel/pitch-wheel-window";
import { SerumPlayerWindow } from "./serum/serum-player";
import { useSerumUi } from "./serum/store";
import { useWheelUi } from "./pitch-wheel/store";
import { useGrossUi } from "./gross-beat/store";
import { ProQWindow } from "./pro-q/pro-q-window";
import { useEqUi } from "./pro-q/store";
import { OttWindow } from "./ott/ott-window";
import { useOttUi } from "./ott/store";
import { ProCWindow } from "./pro-c/pro-c-window";
import { useCompUi } from "./pro-c/store";
import { ProLWindow } from "./pro-l/pro-l-window";
import { useLimUi } from "./pro-l/store";
import { holdFreeze, reverbOf, stepReverbPreset, toggleFreeze, toggleReverbAB, setReverb } from "./reverb/actions";
import { HOLD_MS, resolveReverbKey } from "./reverb/keys";
import { ReverbWindow } from "./reverb/reverb-window";
import { useVerbUi } from "./reverb/store";
import { PanManWindow } from "./panman/panman-window";
import { usePanUi } from "./panman/store";
import { AutomationChooser } from "./automation/chooser";
import { useAutomationUi } from "./automation/store";
import { VocalMixDialog } from "./vocal-mix/dialog";
import { type MusicEdit, MusicMenus } from "./menus";

/** The music suite's main column (`clientSuite("music").Workspace`): its menus, toolbar, windows and assistant. */
export default function MusicWorkspace() {
  const projectId = useMusic((s) => s.projectId);
  const loaded = useMusic((s) => s.history !== null);
  const loadError = useMusic((s) => s.loadError);

  // The engine plays the open song for as long as it's open.
  useEffect(() => (projectId && loaded ? startEngineSync({ onKey: runPluginWindowKey }) : undefined), [projectId, loaded]);
  useMusicKeys(loaded);
  useNoPageZoom(loaded);

  if (!projectId || !loaded) {
    return <PlainWorkspace>{loadError ? <WorkspaceError noun="song" error={loadError} /> : <WorkspaceLoading />}</PlainWorkspace>;
  }
  return (
    <MainWindowPopups>
      <div key={projectId} className="flex min-h-0 flex-1 flex-col" data-suite="music">
        <MusicToolbar />
        <MusicMenus run={runKey} edit={runEdit} />
        <VocalMixDialog />
        <div className="flex min-h-0 flex-1">
          <BrowserPanel />
          <div className="flex min-w-0 flex-1 flex-col">
            <Windows />
          </div>
          <AssistantPanel suite="music" />
        </div>
      </div>
    </MainWindowPopups>
  );
}

/**
 * The toolbar's and side panels' menus (the pattern picker...) in the window the panels' menus are drawn in, when
 * the editor's windows are windows of the system: drawn in the page, they'd open under the rack and the Playlist.
 */
function MainWindowPopups({ children }: { children: ReactNode }) {
  const container = useMainWindowPopups(nativeWindowsOn());
  return <PopupContainerProvider value={container}>{children}</PopupContainerProvider>;
}

/** The editor's desktop and the windows open on it: the channel rack, and the settings of the channels clicked. */
function Windows() {
  const rackOpen = useMusicUi((s) => s.rackOpen);
  const pianoOpen = useMusicUi((s) => s.pianoOpen);
  const playlistOpen = useMusicUi((s) => s.playlistOpen);
  const mixerOpen = useMusicUi((s) => s.mixerOpen);
  const fillInsertsOpen = useMusicUi((s) => s.fillInsertsOpen);
  const transposeOpen = useMusicUi((s) => s.transposeOpen);
  const exportOpen = useMusicUi((s) => s.exportOpen);
  const visualizerOpen = useMusicUi((s) => s.visualizerOpen);
  const pluginManagerOpen = useMusicUi((s) => s.pluginManager !== null);
  const editingNote = usePiano((s) => s.editing);
  const chopping = usePiano((s) => s.chopping);
  const quantizing = usePiano((s) => s.quantizing);
  const stemsOpen = useStems((s) => s.target !== null);
  const convertOpen = useConvert((s) => s.target !== null);
  const openIds = useMusicUi((s) => s.openChannelIds);
  const channels = useSong((song) => song.channels);
  const automations = useSong((song) => song.automations);
  const openAutomations = useAutomationUi((s) => s.openIds);
  const chooserOpen = useAutomationUi((s) => s.chooserOpen);
  const modulatorsOpen = useModulationUi((s) => s.open);
  const openGrossBeats = useGrossUi((s) => s.openIds);
  const openAutoTunes = useTuneUi((s) => s.openIds);
  const openEchoBoys = useEchoUi((s) => s.openIds);
  const openProQs = useEqUi((s) => s.openIds);
  const openOtts = useOttUi((s) => s.openIds);
  const openProCs = useCompUi((s) => s.openIds);
  const openProLs = useLimUi((s) => s.openIds);
  const openReverbs = useVerbUi((s) => s.openIds);
  const openPanMen = usePanUi((s) => s.openIds);
  const openPitchWheels = useWheelUi((s) => s.openIds);
  const openSerums = useSerumUi((s) => s.openIds);
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
      {fillInsertsOpen && <FillInsertsWindow />}
      {transposeOpen && <TransposeWindow />}
      {exportOpen && <ExportWindow />}
      {visualizerOpen && <VisualizerWindow />}
      {pluginManagerOpen && <PluginManager />}
      {pianoOpen && editingNote !== null && <NoteProperties key={editingNote} />}
      {pianoOpen && chopping && <Chopper />}
      {pianoOpen && quantizing && <Quantizer />}
      {stemsOpen && <StemsWindow />}
      {convertOpen && <ConvertWindow />}
      {channels.map((channel, index) => (openIds.includes(channel.id) ? <ChannelSettingsWindow key={channel.id} channel={channel} index={index} /> : null))}
      {automations.map((automation, index) => (openAutomations.includes(automation.id) ? <AutomationWindow key={automation.id} automation={automation} index={index} /> : null))}
      {chooserOpen && <AutomationChooser />}
      {modulatorsOpen && <ModulatorsWindow />}
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
      {openOtts.map((effectId, index) => (
        <OttWindow key={effectId} effectId={effectId} index={index} />
      ))}
      {openProCs.map((effectId, index) => (
        <ProCWindow key={effectId} effectId={effectId} index={index} />
      ))}
      {openProLs.map((effectId, index) => (
        <ProLWindow key={effectId} effectId={effectId} index={index} />
      ))}
      {openReverbs.map((effectId, index) => (
        <ReverbWindow key={effectId} effectId={effectId} index={index} />
      ))}
      {openPanMen.map((effectId, index) => (
        <PanManWindow key={effectId} effectId={effectId} index={index} />
      ))}
      {openPitchWheels.map((effectId, index) => (
        <PitchWheelWindow key={effectId} effectId={effectId} index={index} />
      ))}
      {openSerums.map((channelId, index) => (
        <SerumPlayerWindow key={channelId} channelId={channelId} index={index} />
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
    : id === "visualizer" ? ui.visualizerOpen
    : id === "plugins" ? ui.pluginManager !== null
    : id === "note" ? usePiano.getState().editing !== null
    : id === "chopper" ? usePiano.getState().chopping
    : id === "quantizer" ? usePiano.getState().quantizing
    : id === "stems" ? useStems.getState().target !== null
    : id === "to-notes" ? useConvert.getState().target !== null
    : id === "automate" ? useAutomationUi.getState().chooserOpen
    : id === "modulators" ? useModulationUi.getState().open
    : id.startsWith("automation:") ? useAutomationUi.getState().openIds.includes(id.slice("automation:".length))
    : id.startsWith("gross:") ? useGrossUi.getState().openIds.includes(id.slice("gross:".length))
    : id.startsWith("tune:") ? useTuneUi.getState().openIds.includes(id.slice("tune:".length))
    : id.startsWith("echo:") ? useEchoUi.getState().openIds.includes(id.slice("echo:".length))
    : id.startsWith("proq:") ? useEqUi.getState().openIds.includes(id.slice("proq:".length))
    : id.startsWith("ott:") ? useOttUi.getState().openIds.includes(id.slice("ott:".length))
    : id.startsWith("proc:") ? useCompUi.getState().openIds.includes(id.slice("proc:".length))
    : id.startsWith("prol:") ? useLimUi.getState().openIds.includes(id.slice("prol:".length))
    : id.startsWith("verb:") ? useVerbUi.getState().openIds.includes(id.slice("verb:".length))
    : id.startsWith("panman:") ? usePanUi.getState().openIds.includes(id.slice("panman:".length))
    : id.startsWith("wheel:") ? useWheelUi.getState().openIds.includes(id.slice("wheel:".length))
    : id.startsWith("serum:") ? useSerumUi.getState().openIds.includes(id.slice("serum:".length))
    : ui.openChannelIds.includes(id.slice("channel:".length));
  return [...useMusicWindows.getState().order].reverse().find(open) ?? null;
}

/** A Reverb window's key (`reverb/keys.ts`). F: a tap toggles the song's Freeze; held past `HOLD_MS`, it's momentary until let go. */
function runReverbKey(effectId: string, action: ReturnType<typeof resolveReverbKey> & object) {
  switch (action.type) {
    case "preset":
      return stepReverbPreset(effectId, action.by);
    case "ab":
      return toggleReverbAB(effectId);
    case "display": {
      const reverb = reverbOf(effectId);
      if (reverb) setReverb(effectId, { view: { display: reverb.view.display === "decay" ? "shape" : "decay" } });
      return;
    }
    case "freeze": {
      const down = performance.now();
      let held = false;
      const timer = window.setTimeout(() => {
        held = true;
        holdFreeze(effectId, true);
      }, HOLD_MS);
      const up = (e: KeyboardEvent) => {
        if (e.key.toLowerCase() !== "f") return;
        stop();
        window.clearTimeout(timer);
        if (held) holdFreeze(effectId, false);
        else if (performance.now() - down < HOLD_MS) toggleFreeze(effectId);
      };
      const stop = addWindowListener("keyup", up, true);
      return;
    }
  }
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
    case "quantizer":
      return piano.openQuantizer();
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
    case "consolidate":
      return playlist.consolidateSelected();
    case "timeAround":
      return playlist.selectTimeAroundClips();
    case "insertSpace":
      return playlist.insertTimeSpace(false);
    case "insertSpaceSliced":
      return playlist.insertTimeSpace(true);
    case "deleteSpace":
      return playlist.deleteTimeSpace();
    case "addMarker":
      return playlist.addTimeMarker();
    case "picker":
      return usePlaylist.setState({ pickerOpen: !usePlaylist.getState().pickerOpen });
    case "stretch":
      return usePlaylist.setState({ stretch: !usePlaylist.getState().stretch });
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
      return action.alone ? mixer.soloAlone(mixer.currentTrack()) : mixer.toggleSolo(mixer.currentTrack());
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
    case "bus":
      return mixer.routeSelectedToNewBus();
    case "deselect":
      return mixer.selectOnlyCurrent();
    case "rename":
      return useMixerView.getState().rename(mixer.currentTrack());
    case "delete":
      return mixer.deleteTracks(mixer.selectedTracks());
  }
}

function runKey(action: MusicKeyAction) {
  const ui = useMusicUi.getState();
  switch (action.type) {
    case "togglePlay": {
      // A preview playing (a whole song from the Online tab, say): Space pauses it rather than starting the song.
      const previewing = useBrowser.getState().previewing;
      if (previewing) return togglePreview(previewing.path);
      return useTransport.getState().toggle();
    }
    case "undo":
    case "redo": {
      // A Serum player in front undoes its own steps (Serum's sound isn't the song's: `docs/serum/player.md` §5, Q1).
      const front = frontWindow();
      if (front?.startsWith("serum:")) return void useSerumUi.getState()[action.type](front.slice("serum:".length));
      return action.type === "undo" ? useMusic.getState().undo() : useMusic.getState().redo();
    }
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
    case "toggleTyping":
      return useMidi.getState().setTyping(!useMidi.getState().typing);
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

/**
 * The menu bar's Edit commands, on the window in front as their keys are: the Piano roll's notes, the Playlist's
 * clips, else the rack's steps (which have no Select All).
 */
function runEdit(command: MusicEdit) {
  const front = frontWindow();
  const window = front === "piano" ? piano : front === "playlist" ? playlist : null;
  if (window) return command === "delete" ? window.deleteSelected() : window[command]();
  if (command === "cut") cutSteps();
  else if (command === "copy") copySteps();
  else if (command === "paste") pasteSteps();
  else if (command === "delete") deleteSelected();
}

/** Dialogs and open menus own the keyboard. */
const dialogOpen = () => queryAnywhere(":is([role=dialog], [role=alertdialog], [role=menu]):not([data-state=closed])") !== null;

/**
 * A key a plugin's window passed on (the engine's own window: the page doesn't have the focus). Only a
 * tab that's showing runs it, so two tabs don't both toggle play.
 */
function runPluginWindowKey(key: EngineKey) {
  if (document.visibilityState !== "visible" || dialogOpen()) return;
  if (typingKey(key, key.down !== false) || key.down === false) return;
  const action = resolvePluginWindowKey(key);
  if (action && document.visibilityState === "visible" && !dialogOpen()) runKey(action);
}

/**
 * Ctrl+wheel is FL's zoom (the Piano roll, the Playlist) and fine steps (knobs): one that misses them
 * (a header, a gap) mustn't zoom the whole page instead, as a browser on Windows does.
 */
function useNoPageZoom(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    return addWindowListener("wheel", (e) => e.ctrlKey && e.preventDefault(), { passive: false });
  }, [enabled]);
}

/** The music editor's keys (`keys.ts`). (The video editor's shortcuts are off without a video open.) */
function useMusicKeys(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.isComposing || isTyping(e.target)) return;
      // Windows' menu keys stay the editor's (Alt is FL's modifier for clicks and drags).
      if (takesMenuKey(e, IS_MAC)) return e.preventDefault();
      if (dialogOpen()) return;
      // The typing keyboard, while it's on: its keys play notes, before any window's shortcut.
      if (typingKey(e, true)) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      if (keptByWindow(e.target)) return;
      // The Browser's list has keys of its own (`browser/keys.ts`): only the editor-wide ones pass it.
      const inBrowser = isHtmlElement(e.target) && e.target.closest("[data-browser]") !== null;
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
      // A Reverb's, while it's in front: F (a tap toggles Freeze, held it's momentary), ← →, Tab, A.
      const front = frontWindow();
      if (front?.startsWith("verb:") && !e.repeat) {
        const own = resolveReverbKey(e);
        if (own) {
          e.preventDefault();
          e.stopPropagation();
          return runReverbKey(front.slice("verb:".length), own);
        }
      }
      // A Serum player's, while it's in front: ↑ ↓ step through its list of presets (each step loads one). A focused
      // knob (a macro) keeps its own arrows.
      const keepsArrows = isHtmlElement(e.target) && e.target.closest("[role=slider], [role=spinbutton], [role=combobox]");
      if (front?.startsWith("serum:") && !keepsArrows && (e.key === "ArrowUp" || e.key === "ArrowDown") && !e.altKey && !e.metaKey && !e.ctrlKey && !e.shiftKey) {
        e.preventDefault();
        e.stopPropagation();
        return void useSerumUi.getState().step(front.slice("serum:".length), e.key === "ArrowDown" ? 1 : -1);
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
      if (action.type === "copy" && ownerWindow(e.target).getSelection()?.toString()) return;
      // A focused knob, number or list keeps its own arrows. (A menu's button doesn't: it opens with Enter.)
      const own = isHtmlElement(e.target) && e.target.closest("[role=slider], [role=spinbutton], [role=combobox]");
      if (own && action.type === "select") return;
      e.preventDefault();
      // Ours alone: whatever has the focus (a menu's button opens on Alt+Down, a knob turns) doesn't see it too.
      e.stopPropagation();
      // Held down, a toggle is pressed once (a window's key held a moment opened it and closed it again).
      if (e.repeat && action.type.startsWith("toggle")) return;
      runKey(action);
    };
    // A typing keyboard key let go: its note ends (wherever the focus went meanwhile).
    const onKeyUp = (e: KeyboardEvent) => {
      if (typingKey(e, false)) e.stopPropagation();
    };
    // Before the page's own handlers, for the same reason.
    // (In every window the editor's are: a native one is a window of its own.)
    const stopDown = addWindowListener("keydown", onKeyDown, true);
    const stopUp = addWindowListener("keyup", onKeyUp, true);
    return () => {
      stopDown();
      stopUp();
    };
  }, [enabled]);
}
