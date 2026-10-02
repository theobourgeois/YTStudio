/**
 * The music suite's tools (`shared/music/tools.ts`), run in the tab. `MusicToolName` makes
 * TypeScript insist every tool has a handler here. Edits are the pure functions of `tool-edits.ts`,
 * applied to the open song as one undo step, or to a song that isn't open by loading and saving it.
 */
import { createId } from "@shared/ids";
import { AUTO_TUNE_PLUGIN } from "@shared/music/auto-tune-presets";
import { GROSS_BEAT_PLUGIN } from "@shared/music/gross-beat-presets";
import { addChannels, addPluginChannel, replaceChannel, updateChannel } from "@shared/music/edits";
import { pasteTrackState, setEffect, trackState } from "@shared/music/mixer";
import { EXPORT_FORMATS, type ExportFormat, type ExportSettings } from "@shared/music/export";
import type { MusicToolName } from "@shared/music/tools";
import { KIT_SOUNDS } from "@shared/music/tools";
import type { MusicProject } from "@shared/music/types";
import { type ToolResult, textResult } from "@shared/tool-spec";
import type { MediaAsset } from "@shared/types";
import { api } from "@/lib/api";
import type { ToolRunContext } from "../types";
import { musicApi } from "./api";
import { describeSong } from "./context";
import { useSongExport } from "./export/store";
import { useMusicUi } from "./ui";
import { useMusic } from "./store";
import {
  type EditResult,
  type SongEdit,
  addPatternTool,
  findChannel,
  editStep,
  findPattern,
  moveChannelTool,
  removeChannelTool,
  removePatternTool,
  setStepsTool,
  transposeChannelsTool,
  transposePatternsTool,
  movePatternTool,
  setNotesTool,
  chopNotesTool,
  describeNotes,
  soloChannelTool,
  updateChannelTool,
  updatePatternTool,
  updateSong,
} from "./tool-edits";
import { switchMode, useTransport } from "./transport";
import { armedIn, takesOf, useRecording } from "./recording";
import { inputChoices, inputKey, useInputs } from "./inputs";
import { inputText } from "./mixer/tool-edits";
import { COUNT_IN_BARS, countInBars, useMusicPreferences } from "./preferences";
import { addAudioClips, clipContext } from "@shared/music/playlist";
import {
  chopClipsTool,
  describePlaylist,
  makeClipUniqueTool,
  placeClipsTool,
  removeClipsTool,
  sliceClipsTool,
  splitByChannelTool,
  updateClipsTool,
  updatePlaylistTrackTool,
} from "./playlist/tool-edits";
import { describeBrowser, describeFolder, describeSearch, loadSampleEdit, sampleChannel } from "./browser/describe";
import { addAutomationEdit, describeAutomations, resolveControl, updateAutomationTool } from "./automation/tool-edits";
import { matches, pluginOwners, songControls } from "./automation/controls";
import { usePlaylist } from "./playlist/store";
import { pitchHistory } from "./auto-tune/pitch-history";
import { describeAutoTune, findTune, updateAutoTuneTool } from "./auto-tune/tool-edits";
import { describeGrossBeat, setGrossBeatSlotTool, updateGrossBeatTool } from "./gross-beat/tool-edits";
import { useBrowser } from "./browser/store";
import {
  addMixerTrackTool,
  describeMixer,
  findTrack,
  groupMixerTracksTool,
  moveMixerTrackTool,
  removeMixerEffectTool,
  removeMixerTrackTool,
  routeChannelsTool,
  setSendTool,
  slotForEffect,
  soloMixerTrackTool,
  trackLabel,
  updateMixerEffectTool,
  updateMixerTrackTool,
} from "./mixer/tool-edits";

type Input = Record<string, unknown>;

/** The song a call acts on: the open one (through its store), or one loaded for the call. */
interface Target {
  projectId: string;
  song: MusicProject;
  assets: MediaAsset[];
  patternId: string | null;
  open: boolean;
}

async function targetOf(ctx: ToolRunContext): Promise<Target> {
  const open = useMusic.getState();
  const projectId = ctx.chat ?? open.projectId;
  if (!projectId) throw new Error("No song is open in the editor. Ask the user to open one.");
  if (projectId === open.projectId && open.history) {
    return { projectId, song: open.history.doc, assets: open.assets, patternId: open.patternId, open: true };
  }
  const [song, assets] = await Promise.all([api.getDocument("music", projectId), api.listMedia(projectId)]);
  return { projectId, song, assets, patternId: null, open: false };
}

/** Apply an edit to the target: an undo step in the open song, a save for one that isn't open. */
async function apply(target: Target, update: (song: MusicProject) => MusicProject): Promise<void> {
  if (target.open && useMusic.getState().projectId === target.projectId) return useMusic.getState().commit(update);
  const next = update(target.song);
  if (next !== target.song) await api.saveDocument("music", target.projectId, next);
}

const edit =
  (run: SongEdit) =>
  async (input: Input, ctx: ToolRunContext): Promise<ToolResult> => {
    const target = await targetOf(ctx);
    const env = { patternId: target.patternId };
    let result: EditResult | null = null;
    // An edit that can't be made throws here, before anything changes.
    await apply(target, (song) => (result = run(song, input, env)).song);
    const { text, showPattern } = result as unknown as EditResult;
    if (showPattern && target.open) useMusic.getState().selectPattern(showPattern);
    return textResult(text);
  };

/** The song open in the editor, for tools that only make sense there (what's shown, what plays). */
function requireOpen(target: Target, what: string) {
  if (!target.open) throw new Error(`${what} only works on the song open in the editor, and this chat's song isn't open. Ask the user to open it.`);
}

/** An instrument plugin of this computer's, by its id or name; the error lists the ones there are. */
async function findInstrument(ref: unknown) {
  const wanted = String(ref).trim().toLowerCase();
  const instruments = (await musicApi.listEnginePlugins()).filter((p) => p.isInstrument);
  const plugin = instruments.find((p) => p.id.toLowerCase() === wanted) ?? instruments.find((p) => p.name.toLowerCase() === wanted);
  if (!plugin) throw new Error(`There's no instrument plugin "${String(ref)}" on this computer. The ones found: ${instruments.map((p) => p.name).join(", ") || "none"}.`);
  return plugin;
}

const TOOLS: Record<MusicToolName, (input: Input, ctx: ToolRunContext) => Promise<ToolResult>> = {
  async get_song(_input, ctx) {
    const target = await targetOf(ctx);
    return textResult(describeSong(target.song, target.assets, target.patternId));
  },
  update_song: edit(updateSong),
  async list_plugins(input) {
    const effects = input.kind === "effect";
    const plugins = (await musicApi.listEnginePlugins()).filter((p) => p.isInstrument !== effects);
    if (!plugins.length) return textResult(`No ${effects ? "effect" : "instrument"} plugins have been found on this computer. The user can scan for them from the audio settings (or the rack's + button).`);
    return textResult([`${effects ? "Effect" : "Instrument"} plugins on this computer:`, ...plugins.map((p) => `- ${p.name} (${p.manufacturer}, ${p.format}), id ${p.id}`)].join("\n"));
  },
  async add_channel(input, ctx) {
    const target = await targetOf(ctx);
    const name = typeof input.name === "string" && input.name.trim() ? input.name.trim() : null;
    if (input.plugin !== undefined) {
      const plugin = await findInstrument(input.plugin);
      await apply(target, (song) => {
        const next = addPluginChannel(song, { id: plugin.id, name: plugin.name, format: plugin.format });
        return name ? updateChannel(next, next.channels[next.channels.length - 1].id, { name }) : next;
      });
      return textResult(`Added the channel "${name ?? plugin.name}" playing the plugin ${plugin.name}. Its sound is set in the plugin's own window, which the user opens from the rack.`);
    }
    let sample: MediaAsset | null = null;
    if (input.kit !== undefined) {
      if (!KIT_SOUNDS.includes(input.kit as (typeof KIT_SOUNDS)[number])) throw new Error(`"kit" must be one of: ${KIT_SOUNDS.join(", ")}.`);
      const kit = input.kit as string;
      const response = await fetch(`/kit/${kit}.wav`);
      if (!response.ok) throw new Error(`The starter kit's ${kit} is missing.`);
      sample = await api.uploadMedia(target.projectId, new File([await response.blob()], `${kit[0].toUpperCase()}${kit.slice(1)}.wav`, { type: "audio/wav" }));
      if (target.open && useMusic.getState().projectId === target.projectId) useMusic.setState({ assets: [...useMusic.getState().assets, sample] });
    } else if (input.mediaId !== undefined) {
      sample = target.assets.find((a) => a.id === input.mediaId && a.hasAudio) ?? null;
      if (!sample) {
        const files = target.assets.filter((a) => a.hasAudio).map((a) => `${a.name} (${a.id})`);
        throw new Error(`There's no audio file "${String(input.mediaId)}" in the project. ${files.length ? `Its audio files: ${files.join(", ")}.` : "It has none: use `kit` for a starter drum."}`);
      }
    }
    const channelName = name ?? (sample ? sample.name.replace(/\.[^.]+$/, "") : "Channel");
    await apply(target, (song) => addChannels(song, [{ name: channelName, sampleId: sample?.id ?? null }]));
    return textResult(`Added the channel "${channelName}"${sample ? ` playing ${sample.name}` : " with no sample (silent until it has one)"}. Read get_song for its id.`);
  },
  update_channel: edit(updateChannelTool),
  async replace_channel(input, ctx) {
    const target = await targetOf(ctx);
    const old = findChannel(target.song, input.channel);
    if (old.kind === "audio") throw new Error(`"${old.name}" is an audio clip's channel: it has no instrument to replace.`);
    const plugin = input.plugin === undefined ? null : await findInstrument(input.plugin);
    const id = createId("chan");
    await apply(target, (song) => replaceChannel(song, old.id, plugin && { id: plugin.id, name: plugin.name, format: plugin.format }, id));
    return textResult(`Replaced "${old.name}" with ${plugin ? `the plugin ${plugin.name}` : "an empty sampler"} (channel ${id}), playing its notes.`);
  },
  remove_channel: edit(removeChannelTool),
  solo_channel: edit(soloChannelTool),
  move_channel: edit(moveChannelTool),
  set_steps: edit(setStepsTool),
  transpose_channels: edit(transposeChannelsTool),
  async get_notes(input, ctx) {
    const target = await targetOf(ctx);
    return textResult(describeNotes(target.song, input, { patternId: target.patternId }));
  },
  set_notes: edit(setNotesTool),
  chop_notes: edit(chopNotesTool),
  edit_step: edit(editStep),
  add_pattern: edit(addPatternTool),
  update_pattern: edit(updatePatternTool),
  remove_pattern: edit(removePatternTool),
  transpose_patterns: edit(transposePatternsTool),
  move_pattern: edit(movePatternTool),
  async get_mixer(_input, ctx) {
    const target = await targetOf(ctx);
    return textResult(describeMixer(target.song, target.open ? useTransport.getState().effects : null, target.open ? useRecording.getState().armed : []));
  },
  async list_audio_inputs(_input, ctx) {
    const target = await targetOf(ctx);
    await useInputs.getState().load();
    const { device, channels } = useInputs.getState();
    const lines = device
      ? [`The input device is "${device}". Its inputs, as update_mixer_track's "input" takes them:`, ...inputChoices(channels).map((c) => `- "${inputText(c.input)}": ${c.label}${c.input.stereo ? " (stereo pair)" : ""}`)]
      : ["No input device is open: the user chooses one in Settings (⌘,, Music → Input device). Until then nothing can be recorded."];
    const armed = target.open ? armedIn(target.song, useRecording.getState().armed) : [];
    const taking = target.song.mixer.tracks.filter((t) => t.input);
    lines.push(
      "",
      taking.length
        ? `Tracks with an input: ${taking.map((t) => `${trackLabel(target.song, t)} takes "${inputText(t.input!)}"${armed.includes(t.id) ? " (armed)" : ""}`).join("; ")}.`
        : "No mixer track takes an input yet.",
    );
    if (device && taking.some((t) => !channels.length || !inputChoices(channels).some((c) => inputKey(c.input) === inputKey(t.input)))) lines.push("Some of those inputs aren't on this device: they record silence.");
    return textResult(lines.join("\n"));
  },
  async arm_tracks(input, ctx) {
    const target = await targetOf(ctx);
    requireOpen(target, "Arming tracks");
    if (!Array.isArray(input.tracks) || !input.tracks.length) throw new Error('"tracks" must be a list of mixer tracks (ids, numbers or names from get_mixer).');
    const tracks = input.tracks.map((ref) => findTrack(target.song, ref));
    const arm = input.armed !== false;
    const without = tracks.filter((t) => !t.input);
    if (arm && without.length) throw new Error(`${without.map((t) => trackLabel(target.song, t)).join(", ")} ${without.length === 1 ? "has" : "have"} no input: give ${without.length === 1 ? "it" : "them"} one with update_mixer_track first ("input").`);
    for (const track of tracks) useRecording.getState().arm(track.id, arm);
    return textResult(`${arm ? "Armed" : "Disarmed"} ${tracks.map((t) => trackLabel(target.song, t)).join(", ")}. Armed now: ${useRecording.getState().armed.map((id) => trackLabel(target.song, findTrack(target.song, id))).join(", ") || "none"}.`);
  },
  async record_audio(input, ctx) {
    const target = await targetOf(ctx);
    requireOpen(target, "Recording");
    const recording = useRecording.getState();
    if (input.action === "stop") {
      const active = recording.active;
      useTransport.getState().stop();
      if (!active) return textResult("Nothing was recording; stopped.");
      const takes = await takesOf(active.id, active.tracks.length);
      if (!takes.length) return textResult("Stopped. Nothing was recorded (it was stopped in its count-in, or the takes couldn't be kept).");
      const song = useMusic.getState().history!.doc;
      const ctxClip = clipContext(song);
      return textResult(
        [
          `Stopped. ${takes.length} take${takes.length === 1 ? "" : "s"} placed on the Playlist:`,
          ...takes.map((t) => `- ${trackLabel(song, findTrack(song, t.track))}${t.pass ? ` pass ${t.pass + 1}` : ""}: ${t.seconds.toFixed(1)} s from bar ${(t.startTick / ctxClip.barTicks + 1).toFixed(2).replace(/\.00$/, "")}`),
          "get_playlist has the clips (each on its own audio clip channel, routed back into the track that recorded it).",
        ].join("\n"),
      );
    }
    if (input.action !== "start") throw new Error('"action" must be "start" or "stop".');
    if (recording.active) throw new Error("It's recording already: stop it first.");
    const armed = armedIn(target.song, recording.armed);
    if (!armed.length) throw new Error("No mixer track is armed: give one an input (update_mixer_track) and arm it (arm_tracks).");
    const options: Partial<ReturnType<typeof useMusicPreferences.getState>["recording"]> = {};
    if (input.countIn !== undefined) {
      if (input.countIn !== 0 && !COUNT_IN_BARS.includes(input.countIn as (typeof COUNT_IN_BARS)[number])) throw new Error(`"countIn" must be 0 (none) or ${COUNT_IN_BARS.join(", ")} (bars).`);
      options.countIn = input.countIn !== 0;
      if (input.countIn !== 0) options.countInBars = input.countIn as number;
    }
    if (typeof input.loop === "boolean") options.loop = input.loop;
    if (typeof input.blend === "boolean") options.blend = input.blend;
    if (Object.keys(options).length) useMusicPreferences.getState().setRecording(options);
    if (input.bar !== undefined) {
      if (typeof input.bar !== "number" || !(input.bar >= 1)) throw new Error('"bar" must be a bar number, 1 or more.');
      useTransport.getState().setSongStartTick(Math.round((input.bar - 1) * clipContext(target.song).barTicks));
    }
    if (useTransport.getState().playing) useTransport.getState().stop();
    recording.setOn(true);
    await recording.record();
    // In pattern mode it switches to the song first, and starts once the engine has it.
    for (let waited = 0; !useRecording.getState().active && waited < 3000; waited += 50) await new Promise((resolve) => setTimeout(resolve, 50));
    if (!useRecording.getState().active) throw new Error("Recording didn't start (the audio engine may have refused: see the editor).");
    const prefs = useMusicPreferences.getState().recording;
    return textResult(
      `Recording ${armed.map((id) => trackLabel(target.song, findTrack(target.song, id))).join(", ")}${countInBars(prefs) ? ` after ${countInBars(prefs)} bar${countInBars(prefs) === 1 ? "" : "s"} of count-in` : ""}${prefs.loop ? ", looping (a take each pass)" : ""}. ` +
        "The user performs now; call record_audio with action \"stop\" when they're done (or they press Stop).",
    );
  },
  route_channels: edit(routeChannelsTool),
  update_mixer_track: edit(updateMixerTrackTool),
  set_send: edit(setSendTool),
  solo_mixer_track: edit(soloMixerTrackTool),
  group_mixer_tracks: edit(groupMixerTracksTool),
  add_mixer_track: edit(addMixerTrackTool),
  remove_mixer_track: edit(removeMixerTrackTool),
  move_mixer_track: edit(moveMixerTrackTool),
  async add_mixer_effect(input, ctx) {
    const target = await targetOf(ctx);
    const track = findTrack(target.song, input.track);
    const slot = slotForEffect(target.song, track, input);
    const wanted = String(input.plugin ?? "").trim().toLowerCase();
    // Ours first: Gross Beat isn't a plugin, and its settings are the song's (the tools set them).
    if (wanted === GROSS_BEAT_PLUGIN.name.toLowerCase() || wanted === GROSS_BEAT_PLUGIN.id || wanted === "grossbeat") {
      const replaced = track.effects[slot];
      const id = createId("fx");
      await apply(target, (song) => setEffect(song, track.id, slot, GROSS_BEAT_PLUGIN, id));
      return textResult(
        `Put Gross Beat (${id}) in slot ${slot + 1} of ${trackLabel(target.song, track)}${replaced ? `, replacing ${replaced.plugin.name}` : ""}. ` +
          "It plays its Empty slots (the sound as it is) until you pick others: get_gross_beat lists them, update_gross_beat picks them, set_gross_beat_slot draws your own.",
      );
    }
    if (wanted === AUTO_TUNE_PLUGIN.name.toLowerCase() || wanted === AUTO_TUNE_PLUGIN.id || wanted === "autotune" || wanted === "auto tune") {
      const replaced = track.effects[slot];
      const id = createId("fx");
      await apply(target, (song) => setEffect(song, track.id, slot, AUTO_TUNE_PLUGIN, id));
      return textResult(
        `Put Auto-Tune (${id}) in slot ${slot + 1} of ${trackLabel(target.song, track)}${replaced ? `, replacing ${replaced.plugin.name}` : ""}. ` +
          "It comes hard-tuned (retune speed 0), Alto/Tenor, C Chromatic: set the song's key with update_auto_tune (key and scale, or detectKey), and its sound (a preset, or retune speed, humanize, flex-tune).",
      );
    }
    const effects = (await musicApi.listEnginePlugins()).filter((p) => !p.isInstrument);
    const plugin = effects.find((p) => p.id.toLowerCase() === wanted) ?? effects.find((p) => p.name.toLowerCase() === wanted);
    if (!plugin) throw new Error(`There's no effect plugin "${String(input.plugin)}" on this computer. The ones found: ${effects.map((p) => p.name).join(", ") || "none"}.`);
    const replaced = track.effects[slot];
    await apply(target, (song) => setEffect(song, track.id, slot, { id: plugin.id, name: plugin.name, format: plugin.format }));
    return textResult(
      `Put ${plugin.name} in slot ${slot + 1} of ${trackLabel(target.song, track)}${replaced ? `, replacing ${replaced.plugin.name}` : ""}. Its settings are in its own window, which the user opens from the mixer.`,
    );
  },
  update_mixer_effect: edit(updateMixerEffectTool),
  async get_gross_beat(input, ctx) {
    return textResult(describeGrossBeat((await targetOf(ctx)).song, input));
  },
  update_gross_beat: edit((song, input) => updateGrossBeatTool(song, input)),
  async get_auto_tune(input, ctx) {
    const song = (await targetOf(ctx)).song;
    // What it heard in the last few seconds (the engine says it to the open song's tab).
    const history = pitchHistory(findTune(song, input).effect.id);
    const recent = history ? history.readings.slice(-Math.ceil(4 / history.step)) : [];
    return textResult(describeAutoTune(song, input, recent));
  },
  update_auto_tune: edit((song, input) => updateAutoTuneTool(song, input)),
  set_gross_beat_slot: edit((song, input) => setGrossBeatSlotTool(song, input)),
  remove_mixer_effect: edit(removeMixerEffectTool),
  async copy_track_state(input, ctx) {
    const target = await targetOf(ctx);
    const from = findTrack(target.song, input.from);
    const to = findTrack(target.song, input.to);
    if (from.id === to.id) throw new Error('"from" and "to" are the same track.');
    const state = trackState(target.song, from.id)!;
    const ids = new Map(state.effects.flatMap((effect) => (effect ? [[effect.id, createId("fx")] as const] : [])));
    // The effects' settings files first, so the copies start as the originals are.
    if (ids.size) await musicApi.copyStates({ projectId: target.projectId, copies: [...ids].map(([source, copy]) => ({ from: source, to: copy })) });
    await apply(target, (song) => pasteTrackState(song, to.id, state, ids));
    return textResult(`Copied ${trackLabel(target.song, from)}'s effects (${ids.size}) and controls onto ${trackLabel(target.song, to)}.`);
  },
  async show_pattern(input, ctx) {
    const target = await targetOf(ctx);
    requireOpen(target, "Showing a pattern");
    const pattern = findPattern(target.song, input.pattern, { patternId: target.patternId });
    useMusic.getState().selectPattern(pattern.id);
    return textResult(`The channel rack shows "${pattern.name}".`);
  },
  async list_samples(input) {
    if (typeof input.folder === "string" && input.folder.trim()) {
      const folder = input.folder.trim().replace(/\/+$/, "");
      return textResult(describeFolder(folder, await musicApi.listBrowserFolder(folder)));
    }
    const state = await musicApi.browser();
    useBrowser.setState({ state });
    return textResult(describeBrowser(state));
  },
  async search_samples(input) {
    const query = typeof input.query === "string" ? input.query.trim() : "";
    if (!query) throw new Error('"query" must be the words to look for ("808 kick").');
    const limit = typeof input.limit === "number" ? Math.max(1, Math.min(200, Math.round(input.limit))) : 30;
    const [result, state] = await Promise.all([musicApi.searchBrowser(query, limit), musicApi.browser()]);
    return textResult(describeSearch(query, result, state));
  },
  async preview_sample(input) {
    if (input.stop === true) {
      useBrowser.getState().stopPreview();
      await musicApi.engine("stopPreview", {});
      return textResult("Stopped the preview.");
    }
    if (typeof input.path !== "string" || !input.path) throw new Error('"path" must be a file\'s full path, from search_samples or list_samples.');
    const start = typeof input.start === "number" && input.start > 0 ? input.start : 0;
    const id = `assistant-${Date.now()}`;
    await musicApi.previewFile({ path: input.path, start, id });
    // The Browser shows it playing, as if the user had clicked it.
    useBrowser.setState({ previewing: { path: input.path, id } });
    return textResult(`Playing ${input.path.slice(input.path.lastIndexOf("/") + 1)} to the user${start ? ` from ${start}s` : ""}. You can't hear it: ask them what they think.`);
  },
  async load_sample(input, ctx) {
    const target = await targetOf(ctx);
    const paths = Array.isArray(input.paths) ? input.paths.filter((p): p is string => typeof p === "string" && p.length > 0) : [];
    if (!paths.length) throw new Error('"paths" must be a list of files\' full paths, from search_samples or list_samples.');
    const toChannel = input.channel !== undefined && input.channel !== null && input.channel !== "";
    // Checked before any file is copied: a channel that isn't there, or can't take a sample.
    if (toChannel) sampleChannel(target.song, input.channel);
    const assets: MediaAsset[] = [];
    for (const path of toChannel ? paths.slice(0, 1) : paths) {
      const asset = await musicApi.useBrowserFile({ projectId: target.projectId, path });
      if (!asset.hasAudio) throw new Error(`${asset.name} has no sound.`);
      assets.push(asset);
    }
    if (target.open && useMusic.getState().projectId === target.projectId) {
      const known = new Set(useMusic.getState().assets.map((a) => a.id));
      const added = assets.filter((a) => !known.has(a.id));
      if (added.length) useMusic.setState({ assets: [...useMusic.getState().assets, ...added] });
    }
    let text = "";
    await apply(target, (song) => {
      const result = loadSampleEdit(song, assets, input);
      text = result.text;
      return result.song;
    });
    return textResult(text);
  },
  async add_sample_folder(input) {
    if (typeof input.path !== "string" || !input.path.trim()) throw new Error('"path" must be the folder\'s full path.');
    const state = await musicApi.addBrowserRoot({ path: input.path.trim() });
    useBrowser.setState({ state });
    const root = state.roots[state.roots.length - 1];
    if (root) useBrowser.getState().expand(root.path);
    return textResult(`Added ${root?.path ?? input.path} to the Browser.\n\n${describeBrowser(state)}`);
  },
  async star_sample(input) {
    if (typeof input.path !== "string" || !input.path) throw new Error('"path" must be a file\'s or folder\'s full path.');
    const favourite = input.favourite !== false;
    const state = await musicApi.setBrowserFavourite({ path: input.path, favourite });
    useBrowser.setState({ state });
    return textResult(`${favourite ? "Starred" : "Unstarred"} ${input.path}. Favourites: ${state.favourites.length ? state.favourites.join(", ") : "none"}.`);
  },
  async get_automation(input, ctx) {
    const target = await targetOf(ctx);
    return textResult(describeAutomations(target.song, input.automation));
  },
  async list_controls(input, ctx) {
    const target = await targetOf(ctx);
    const song = target.song;
    const query = typeof input.query === "string" ? input.query : "";
    const wantsPlugin = (input.channel !== undefined && input.channel !== "") || input.track !== undefined;
    if (!wantsPlugin) {
      const lines = ["Controls that can be automated (add_automation's `control` and what it belongs to):"];
      for (const group of songControls(song)) {
        const rows = group.rows.filter((r) => matches(query, r.name, r.owner));
        if (rows.length) lines.push("", `${group.title}:`, ...rows.map((r) => `- ${r.name} of ${r.owner}${r.automated ? " (automated)" : ""}`));
      }
      const owners = pluginOwners(song);
      lines.push("", owners.length ? `Plugins with their own parameters (ask with \`channel\`, or \`track\` and \`slot\`): ${owners.map((o) => o.name).join(", ")}.` : "No plugins: the song has no plugin channels or mixer effects.");
      return textResult(lines.join("\n"));
    }
    const owner = resolveControl(song, { ...input, control: "parameter", parameter: "?" });
    if ("kind" in owner) throw new Error("Name a plugin: a plugin channel (`channel`), or a mixer `track` and `slot`.");
    const parameters = await musicApi.pluginParameters(owner.owner, owner.id);
    const shown = parameters.filter((p) => matches(query, p.name));
    const lines = [`${owner.ownerName}'s parameters${query ? ` matching "${query}"` : ""} (${shown.length} of ${parameters.length}): name (id) = value now.`];
    for (const p of shown.slice(0, 400)) lines.push(`- ${p.name} (${p.id}) = ${p.text || Math.round(p.value * 100) + "%"}`);
    if (shown.length > 400) lines.push(`… ${shown.length - 400} more: give a \`query\`.`);
    return textResult(lines.join("\n"));
  },
  async add_automation(input, ctx) {
    const target = await targetOf(ctx);
    let control = resolveControl(target.song, input);
    let value: number | undefined;
    if (!("kind" in control)) {
      // A plugin's parameter: its id and value now are the engine's.
      const { owner, id, parameter, ownerName } = control;
      const parameters = await musicApi.pluginParameters(owner, id);
      const wanted = parameter.toLowerCase();
      const found = parameters.find((p) => p.id === parameter) ?? parameters.find((p) => p.name.toLowerCase() === wanted) ?? parameters.find((p) => p.name.toLowerCase().includes(wanted));
      if (!found) {
        const near = parameters.filter((p) => matches(parameter, p.name)).slice(0, 20);
        throw new Error(`${ownerName} has no parameter "${parameter}". ${near.length ? `Close: ${near.map((p) => p.name).join(", ")}.` : "list_controls lists them."}`);
      }
      control = { kind: "plugin", owner, id, param: found.id, index: found.index, name: found.name };
      value = found.value;
    }
    const resolved = control;
    let text = "";
    let made = "";
    await apply(target, (song) => {
      const result = addAutomationEdit(song, input, resolved, value);
      text = result.text;
      made = result.automationId;
      return result.song;
    });
    if (target.open && made) usePlaylist.setState({ source: { kind: "automation", ref: made }, pickerTab: "automation" });
    return textResult(text);
  },
  update_automation: edit(updateAutomationTool),
  async play_song(input, ctx) {
    const target = await targetOf(ctx);
    requireOpen(target, "Playing");
    if (input.action !== "play" && input.action !== "stop") throw new Error('"action" must be "play" or "stop".');
    if (input.mode !== undefined && input.mode !== "pattern" && input.mode !== "song") throw new Error('"mode" must be "pattern" or "song".');
    const transport = useTransport.getState();
    if (input.action === "stop") {
      transport.stop();
      return textResult("Stopped.");
    }
    const mode = (input.mode as "pattern" | "song" | undefined) ?? transport.mode;
    if (mode === "song" && input.bar !== undefined) {
      if (typeof input.bar !== "number" || !(input.bar >= 1)) throw new Error('"bar" must be a bar number, 1 or more.');
      transport.setSongStartTick(Math.round((input.bar - 1) * clipContext(target.song).barTicks));
    }
    if (transport.playing && mode === transport.mode) transport.play();
    else switchMode(mode, true);
    return textResult(mode === "song" ? `Playing the song (the playlist)${input.bar !== undefined ? ` from bar ${input.bar}` : ""}, round and round.` : "Playing the pattern shown, on a loop.");
  },
  async export_song(input, ctx) {
    const target = await targetOf(ctx);
    // The engine has the open song's plugins: only it can be exported.
    requireOpen(target, "Exporting");
    const patch: Partial<ExportSettings> = {};
    if (input.formats !== undefined) {
      const formats = Array.isArray(input.formats) ? input.formats.filter((f): f is ExportFormat => EXPORT_FORMATS.includes(f as ExportFormat)) : [];
      if (!formats.length || formats.length !== (input.formats as unknown[]).length) throw new Error(`"formats" must be a list of: ${EXPORT_FORMATS.join(", ")}.`);
      patch.formats = formats;
    }
    if (input.mode !== undefined) {
      if (input.mode !== "song" && input.mode !== "pattern") throw new Error('"mode" must be "song" or "pattern".');
      patch.mode = input.mode;
    }
    if (input.tail !== undefined) {
      if (input.tail !== "cut" && input.tail !== "ring") throw new Error('"tail" must be "cut" or "ring".');
      patch.tail = input.tail;
    }
    if (input.stems !== undefined) patch.stems = input.stems === true;
    if (input.preventClipping !== undefined) patch.preventClipping = input.preventClipping === true;
    if (input.wavBits !== undefined) {
      if (![16, 24, 32].includes(input.wavBits as number)) throw new Error('"wavBits" must be 16, 24 or 32.');
      patch.wavBits = input.wavBits as ExportSettings["wavBits"];
    }
    if (input.mp3Bitrate !== undefined) {
      if (typeof input.mp3Bitrate !== "number" || input.mp3Bitrate < 64 || input.mp3Bitrate > 320) throw new Error('"mp3Bitrate" must be 64 to 320 (kilobits a second).');
      patch.mp3Bitrate = input.mp3Bitrate;
    }
    const exporter = useSongExport.getState();
    exporter.setSettings(patch);
    // Kept on the server: the window lists them, to download or show.
    useSongExport.setState({ destination: null });
    exporter.reset();
    useMusicUi.getState().setExportOpen(true);
    const job = await exporter.run();
    if (job.state === "failed") throw new Error(`The export failed: ${job.error ?? "no reason given"}.`);
    if (job.state === "aborted") return textResult("The export was stopped before it finished.");
    const size = (bytes: number) => (bytes < 1e6 ? `${Math.max(1, Math.round(bytes / 1e3))} KB` : `${(bytes / 1e6).toFixed(1)} MB`);
    const lines = [
      `Exported ${job.files.length} file${job.files.length === 1 ? "" : "s"}${job.length !== null ? ` of ${job.length.toFixed(1)} s of song` : ""} in ${(job.seconds ?? 0).toFixed(1)} s:`,
      ...job.files.map((f) => `- ${f.name} (${size(f.bytes)})`),
      "They're listed in the export window for the user to download or show in Finder.",
    ];
    if (job.peakDb !== null && job.peakDb > 0)
      lines.push(
        job.gainDb < 0
          ? `The mix peaks ${job.peakDb.toFixed(1)} dB over full scale (too hot): every file was turned down ${(-job.gainDb).toFixed(1)} dB so it doesn't clip. Suggest bringing the master or the loudest channels down.`
          : `The mix peaks ${job.peakDb.toFixed(1)} dB over full scale, so the files clip. Suggest bringing the master or the loudest channels down.`,
      );
    if (job.missing.length) lines.push(`Not heard (their plugin or sample couldn't be loaded): ${job.missing.join(", ")}.`);
    return textResult(lines.join("\n"));
  },
  async get_playlist(_input, ctx) {
    const target = await targetOf(ctx);
    return textResult(describePlaylist(target.song, target.open ? useTransport.getState().mode : null));
  },
  place_clips: edit(placeClipsTool),
  update_clips: edit(updateClipsTool),
  remove_clips: edit(removeClipsTool),
  slice_clips: edit(sliceClipsTool),
  chop_clips: edit(chopClipsTool),
  split_by_channel: edit(splitByChannelTool),
  make_clip_unique: edit(makeClipUniqueTool),
  update_playlist_track: edit(updatePlaylistTrackTool),
  async add_audio_clip(input, ctx) {
    const target = await targetOf(ctx);
    const track = input.track;
    const bar = input.bar;
    if (!Number.isInteger(track) || (track as number) < 1) throw new Error('"track" must be a track\'s number, 1 or more.');
    if (typeof bar !== "number" || !(bar >= 1)) throw new Error('"bar" must be a bar number, 1 or more.');
    const assets: MediaAsset[] = [];
    if (typeof input.mediaId === "string" && input.mediaId) {
      const asset = target.assets.find((a) => a.id === input.mediaId && a.hasAudio);
      if (!asset) throw new Error(`There's no audio file "${input.mediaId}" in the project. Its audio files: ${target.assets.filter((a) => a.hasAudio).map((a) => `${a.name} (${a.id})`).join(", ") || "none"}.`);
      assets.push(asset);
    }
    const paths = Array.isArray(input.paths) ? input.paths.filter((p): p is string => typeof p === "string" && p.length > 0) : [];
    for (const path of paths) {
      const asset = await musicApi.useBrowserFile({ projectId: target.projectId, path });
      if (!asset.hasAudio) throw new Error(`${asset.name} has no sound.`);
      assets.push(asset);
    }
    if (!assets.length) throw new Error('Give the files: "paths" (the Browser\'s, from search_samples) or a "mediaId".');
    if (target.open && useMusic.getState().projectId === target.projectId) {
      const known = new Set(useMusic.getState().assets.map((a) => a.id));
      const added = assets.filter((a) => !known.has(a.id));
      if (added.length) useMusic.setState({ assets: [...useMusic.getState().assets, ...added] });
    }
    const start = Math.round((bar - 1) * clipContext(target.song).barTicks);
    let made: number[] = [];
    await apply(target, (song) => {
      const result = addAudioClips(song, assets.map((a) => ({ name: a.name.replace(/\.[^.]+$/, ""), sampleId: a.id, seconds: a.duration })), { start, track: (track as number) - 1, after: input.after === true });
      made = result.clipIds;
      return result.song;
    });
    return textResult(`Added ${assets.length} audio clip${assets.length === 1 ? "" : "s"} (clip ${made.join(", ")}) from bar ${bar} on track ${track}: ${assets.map((a) => a.name).join(", ")}. Each has a channel of its own in the rack's Audio group; read get_playlist.`);
  },
};

export async function runMusicTool(name: string, input: Input, ctx: ToolRunContext): Promise<ToolResult> {
  const handler = (TOOLS as Record<string, ((input: Input, ctx: ToolRunContext) => Promise<ToolResult>) | undefined>)[name];
  if (!handler) return { content: [{ type: "text", text: `Unknown tool: ${name}` }], isError: true };
  return handler(input, ctx);
}
