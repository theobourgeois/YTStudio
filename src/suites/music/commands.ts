/**
 * Everything the music editor does, by name, for the command palette (⇧⌘P / F1): the windows, the tools and
 * snaps, each window's edits, and every channel, pattern and insert to go to. Each command runs what its key
 * does (the workspace's runners), so the palette, the menus and the keys never differ; its keys are shown on
 * its row, so they're learnt. The window in front's commands come first.
 */
import type { Command } from "@/components/command-palette/command-palette";
import { IS_MAC } from "@/lib/key-labels";
import { useBrowser } from "./browser/store";
import type { MusicKeyAction } from "./keys";
import type { MusicEdit } from "./menus";
import { useMidi } from "./midi";
import type { MixerKeyAction } from "./mixer/keys";
import { useMixerView } from "./mixer/view";
import { openPianoRoll } from "./piano/actions";
import { SNAPS, SNAP_LABELS } from "./piano/geometry";
import type { PianoKeyAction } from "./piano/keys";
import { PIANO_TOOLS, usePiano } from "./piano/store";
import type { PlaylistKeyAction } from "./playlist/keys";
import { PLAYLIST_TOOLS, usePlaylist } from "./playlist/store";
import { useMusicPreferences } from "./preferences";
import { useRecording } from "./recording";
import { useMusic } from "./store";
import { useTransport } from "./transport";
import { type WindowId, useMusicUi } from "./ui";

interface CommandContext {
  front: WindowId | null;
  runKey: (action: MusicKeyAction) => void;
  runPianoKey: (action: PianoKeyAction) => void;
  runPlaylistKey: (action: PlaylistKeyAction) => void;
  runMixerKey: (action: MixerKeyAction) => void;
  runEdit: (command: MusicEdit) => void;
}

const key = (mac: string, other: string) => (IS_MAC ? mac : other);

const TOOL_NAMES: Record<string, string> = {
  draw: "Draw",
  paint: "Paint",
  delete: "Delete",
  mute: "Mute",
  slip: "Slip",
  slice: "Slice",
  select: "Select",
  zoom: "Zoom",
  playback: "Playback",
};
const TOOL_KEYS: Record<string, string> = { draw: "P", paint: "B", delete: "D", mute: "T", slip: "S", slice: "C", select: "E", zoom: "Z", playback: "Y" };

/** The palette's commands now (it asks each time it opens, so they're the song's and the windows' as they are). */
export function musicCommands({ front, runKey, runPianoKey, runPlaylistKey, runMixerKey, runEdit }: CommandContext): Command[] {
  const song = useMusic.getState().history?.doc;
  const ui = useMusicUi.getState();
  const piano = usePiano.getState();
  const playlist = usePlaylist.getState();
  const transport = useTransport.getState();
  const commands: Command[] = [];
  const add = (group: string, command: Omit<Command, "group">) => commands.push({ group, ...command });

  // The windows: open (or close) each, the next to the front.
  const window = (id: string, title: string, open: boolean, action: MusicKeyAction, keys: string) =>
    add("Window", { id: `window-${id}`, title, keywords: ["show", "open", "close", "window"], checked: open, keys, run: () => runKey(action) });
  window("playlist", "Playlist", ui.playlistOpen, { type: "togglePlaylist" }, key("⌥1", "F5"));
  window("rack", "Channel Rack", ui.rackOpen, { type: "toggleRack" }, key("⌥2", "F6"));
  window("piano", "Piano Roll", ui.pianoOpen, { type: "togglePiano" }, key("⌥3", "F7"));
  window("mixer", "Mixer", ui.mixerOpen, { type: "toggleMixer" }, key("⌥4", "F9"));
  window("browser", "Browser", useBrowser.getState().open, { type: "toggleBrowser" }, key("⌥5", "Alt+F8"));
  add("Window", { id: "window-graph", title: "Graph Editor", checked: ui.graphOpen, run: () => runKey({ type: "toggleGraph" }) });
  add("Window", { id: "window-next", title: "Next Window", keywords: ["cycle", "switch", "focus"], keys: "⌥`", run: () => runKey({ type: "cycleWindow", direction: 1 }) });
  add("Window", { id: "window-previous", title: "Previous Window", keywords: ["cycle", "switch", "focus"], keys: "⇧⌥`", run: () => runKey({ type: "cycleWindow", direction: -1 }) });

  // Play, record, the song's modes.
  add("Transport", { id: "play", title: transport.playing ? "Stop" : "Play", keywords: ["start", "pause"], keys: "Space", run: () => runKey({ type: "togglePlay" }) });
  add("Transport", { id: "record", title: "Record", checked: useRecording.getState().on, keys: "R", run: () => runKey({ type: "toggleRecord" }) });
  add("Transport", {
    id: "mode",
    title: transport.mode === "song" ? "Pattern Mode" : "Song Mode",
    keywords: ["switch", "pattern", "song"],
    keys: "L",
    run: () => runKey({ type: "toggleMode" }),
  });
  add("Transport", {
    id: "metronome",
    title: "Metronome",
    keywords: ["click"],
    checked: transport.metronome,
    run: () => transport.setMetronome(!transport.metronome, useMusicPreferences.getState().metronomeSound),
  });
  add("Transport", { id: "typing", title: "Typing Keyboard to Piano", keywords: ["computer keyboard", "play notes"], checked: useMidi.getState().typing, run: () => runKey({ type: "toggleTyping" }) });
  add("Transport", { id: "step-edit", title: "Step Edit", keywords: ["record", "write notes", "midi"], checked: piano.stepEdit, keys: "⌘E", run: () => runKey({ type: "toggleStepEdit" }) });

  // The song's Edit menu, on the window in front.
  add("Edit", { id: "undo", title: "Undo", keys: "⌘Z", run: () => runKey({ type: "undo" }) });
  add("Edit", { id: "redo", title: "Redo", keys: key("⇧⌘Z", "Ctrl+Y"), run: () => runKey({ type: "redo" }) });
  add("Edit", { id: "cut", title: "Cut", keys: "⌘X", run: () => runEdit("cut") });
  add("Edit", { id: "copy", title: "Copy", keys: "⌘C", run: () => runEdit("copy") });
  add("Edit", { id: "paste", title: "Paste", keys: "⌘V", run: () => runEdit("paste") });
  add("Edit", { id: "delete", title: "Delete", keywords: ["remove"], keys: "⌫", run: () => runEdit("delete") });
  add("Edit", { id: "select-all", title: "Select All", keys: "⌘A", run: () => runEdit("selectAll") });
  add("File", { id: "export-wav", title: "Export WAV…", keywords: ["render", "bounce"], keys: "⌘R", run: () => runKey({ type: "exportWav" }) });
  add("File", { id: "export-mp3", title: "Export MP3…", keywords: ["render", "bounce"], keys: "⇧⌘R", run: () => runKey({ type: "exportMp3" }) });

  // The rack.
  const inRack = front === "rack";
  const rack = (id: string, title: string, action: MusicKeyAction, keys?: string, keywords?: string[]) =>
    add("Channel Rack", { id: `rack-${id}`, title, keys, keywords, preferred: inRack, run: () => runKey(action) });
  rack("add", "Add Channel…", { type: "addChannel" }, undefined, ["new", "instrument", "plugin", "sampler"]);
  rack("clone", "Clone Channel", { type: "clone" }, "⌥C", ["duplicate"]);
  rack("up", "Move Channel Up", { type: "move", direction: -1 }, "⌥↑");
  rack("down", "Move Channel Down", { type: "move", direction: 1 }, "⌥↓");
  rack("rotate-left", "Rotate Steps Left", { type: "rotate", direction: -1 }, "⇧⌘←");
  rack("rotate-right", "Rotate Steps Right", { type: "rotate", direction: 1 }, "⇧⌘→");
  rack("toggle-step", "Toggle Step at Cursor", { type: "toggleStep" }, "↩");
  rack("open", "Open Channel Settings", { type: "openChannel" }, "⇧↩", ["plugin", "instrument"]);
  rack("free-tracks", "Assign Free Mixer Tracks", { type: "assignFreeTracks" }, "⌘L", ["route", "insert"]);
  add("Channel Rack", { id: "rack-next-pattern", title: "Next Pattern", keys: "Num +", run: () => runKey({ type: "nextPattern" }) });
  add("Channel Rack", { id: "rack-previous-pattern", title: "Previous Pattern", keys: "Num −", run: () => runKey({ type: "previousPattern" }) });

  // The Piano roll's tools, snaps and edits (it opens first, where it isn't).
  if (ui.pianoOpen) {
    const inPiano = front === "piano";
    const p = (id: string, title: string, action: PianoKeyAction, keys?: string, keywords?: string[], checked?: boolean) =>
      add("Piano Roll", { id: `piano-${id}`, title, keys, keywords, checked, preferred: inPiano, run: () => runPianoKey(action) });
    for (const tool of PIANO_TOOLS) p(`tool-${tool}`, `${TOOL_NAMES[tool]} Tool`, { type: "tool", tool }, TOOL_KEYS[tool], ["tool"], piano.tool === tool);
    for (const snap of SNAPS) {
      add("Piano Roll", { id: `piano-snap-${snap}`, title: `Snap to ${SNAP_LABELS[snap]}`, keywords: ["grid", "magnet"], checked: piano.snap === snap, preferred: inPiano, run: () => piano.setSnap(snap) });
    }
    p("quantize", "Quantize", { type: "quantize" }, "⌘Q");
    p("quantize-starts", "Quantize Start Times", { type: "quantizeStarts" }, "⇧Q");
    p("quantizer", "Quantizer…", { type: "quantizer" }, "⌥Q");
    p("legato", "Legato", { type: "legato" }, "⌘L");
    p("glue", "Glue Notes", { type: "glue" }, "⌘G", ["join", "merge"]);
    p("chop", "Chop Notes", { type: "chop" }, "⌘U", ["split"]);
    p("chopper", "Chopper…", { type: "chopper" }, "⌥U");
    p("duplicate", "Duplicate Notes", { type: "duplicate" }, "⌘B");
    p("invert", "Invert Selection", { type: "invert" }, "⇧I");
    p("deselect", "Deselect", { type: "deselect" }, "⌘D");
    p("mute", "Mute Notes", { type: "mute" }, "⌥M");
    p("unmute", "Unmute Notes", { type: "unmute" }, "⇧⌥M");
    p("ghosts", "Ghost Notes", { type: "ghosts" }, "⌥V", ["other channels"], piano.ghosts);
    p("lane", "Event Lane", { type: "lane" }, "⇧↩", ["velocity", "pan"]);
    p("properties", "Note Properties…", { type: "properties" }, "F2", ["velocity", "pan", "edit note"]);
    p("louder", "Louder", { type: "velocity", direction: 1 }, "⇧⌥↑", ["velocity"]);
    p("softer", "Softer", { type: "velocity", direction: -1 }, "⇧⌥↓", ["velocity"]);
    p("longer", "Longer Notes", { type: "length", direction: 1 }, "⇧⌥→", ["length"]);
    p("shorter", "Shorter Notes", { type: "length", direction: -1 }, "⇧⌥←", ["length"]);
    p("mark-in", "Mark In at Cursor", { type: "markIn" }, "I", ["time selection", "loop"]);
    p("mark-out", "Mark Out at Cursor", { type: "markOut" }, "O", ["time selection", "loop"]);
    p("select-row", "Select Notes at Cursor's Pitch", { type: "selectRow" }, "⇧X");
    p("centre", "Centre on Playhead", { type: "centre" }, "⇧0", ["scroll"]);
  }

  // The Playlist's.
  if (ui.playlistOpen) {
    const inPlaylist = front === "playlist";
    const pl = (id: string, title: string, action: PlaylistKeyAction, keys?: string, keywords?: string[], checked?: boolean) =>
      add("Playlist", { id: `playlist-${id}`, title, keys, keywords, checked, preferred: inPlaylist, run: () => runPlaylistKey(action) });
    for (const tool of PLAYLIST_TOOLS) pl(`tool-${tool}`, `${TOOL_NAMES[tool]} Tool`, { type: "tool", tool }, TOOL_KEYS[tool], ["tool"], playlist.tool === tool);
    for (const snap of SNAPS) {
      add("Playlist", {
        id: `playlist-snap-${snap}`,
        title: `Snap to ${SNAP_LABELS[snap]}`,
        keywords: ["grid", "magnet"],
        checked: playlist.snap === snap,
        preferred: inPlaylist,
        run: () => usePlaylist.setState({ snap }),
      });
    }
    pl("picker", "Picker Panel", { type: "picker" }, "⌥P", ["patterns", "clips"], playlist.pickerOpen);
    pl("stretch", "Stretch Mode", { type: "stretch" }, "⇧M", undefined, playlist.stretch);
    pl("consolidate", "Consolidate Clips", { type: "consolidate" }, "⌘⌥C", ["render", "bounce"]);
    pl("select-similar", "Select Similar Clips", { type: "selectSimilar" }, "⇧C");
    pl("quantize", "Quantize Clips", { type: "quantize" }, "⇧Q");
    pl("insert-space", "Insert Space", { type: "insertSpace" }, "⌘Insert", ["time"]);
    pl("delete-space", "Delete Space", { type: "deleteSpace" }, "⌘⌫", ["time"]);
    pl("marker", "Add Time Marker", { type: "addMarker" }, "⌥T");
    pl("mark-in", "Mark In at Cursor", { type: "markIn" }, "I", ["time selection", "loop"]);
    pl("mark-out", "Mark Out at Cursor", { type: "markOut" }, "O", ["time selection", "loop"]);
    pl("select-track", "Select Clips on Cursor's Track", { type: "selectTrack" }, "⇧X");
    pl("rename-track", "Rename Track at Cursor", { type: "renameTrack" }, "F2");
    pl("song-start", "Go to Song Start", { type: "home" }, "Home");
    pl("song-end", "Go to Song End", { type: "end" }, "End");
  }

  // The mixer's.
  if (ui.mixerOpen) {
    const inMixer = front === "mixer";
    const m = (id: string, title: string, action: MixerKeyAction, keys?: string, keywords?: string[]) =>
      add("Mixer", { id: `mixer-${id}`, title, keys, keywords, preferred: inMixer, run: () => runMixerKey(action) });
    m("mute", "Mute Track", { type: "mute" }, "M");
    m("solo", "Solo Track", { type: "solo", alone: false }, "S");
    m("rename", "Rename Track", { type: "rename" }, "F2");
    m("route", "Route Selected Channels Here", { type: "route", starting: false }, "⌘L", ["link", "assign"]);
    m("bus", "Route to New Bus", { type: "bus" }, "⌘G", ["group", "submix"]);
  }

  if (!song) return commands;

  // Go to: a channel (its Piano roll), a pattern, an insert.
  song.channels.forEach((channel, index) => {
    add("Go to Channel", {
      id: `channel-${channel.id}`,
      title: channel.name,
      keywords: [`channel ${index + 1}`, "piano roll"],
      run: () => openPianoRoll(channel.id),
    });
  });
  for (const pattern of song.patterns) {
    add("Go to Pattern", { id: `pattern-${pattern.id}`, title: pattern.name, keywords: ["pattern"], run: () => useMusic.getState().selectPattern(pattern.id) });
  }
  song.mixer.tracks.forEach((track, index) => {
    const name = track.name ?? (index === 0 ? "Master" : `Insert ${index}`);
    add("Go to Insert", {
      id: `insert-${track.id}`,
      title: name,
      keywords: ["mixer", "insert", `insert ${index}`],
      run: () => {
        if (!useMusicUi.getState().mixerOpen) useMusicUi.getState().setMixerOpen(true);
        useMusicUi.getState().setTrackSelection([track.id]);
        useMixerView.getState().reveal(track.id);
      },
    });
  });
  return commands;
}
