/**
 * The music suite's tools (`shared/music/tools.ts`), run in the tab. `MusicToolName` makes
 * TypeScript insist every tool has a handler here. Edits are the pure functions of `tool-edits.ts`,
 * applied to the open song as one undo step, or to a song that isn't open by loading and saving it.
 */
import { createId } from "@shared/ids";
import { addChannels, addPluginChannel, updateChannel } from "@shared/music/edits";
import { pasteTrackState, setEffect, trackState } from "@shared/music/mixer";
import type { MusicToolName } from "@shared/music/tools";
import { KIT_SOUNDS } from "@shared/music/tools";
import type { MusicProject } from "@shared/music/types";
import { type ToolResult, textResult } from "@shared/tool-spec";
import type { MediaAsset } from "@shared/types";
import { api } from "@/lib/api";
import type { ToolRunContext } from "../types";
import { musicApi } from "./api";
import { describeSong } from "./context";
import { useMusic } from "./store";
import {
  type EditResult,
  type SongEdit,
  addPatternTool,
  editStep,
  findPattern,
  moveChannelTool,
  removeChannelTool,
  removePatternTool,
  setStepsTool,
  transposeChannelsTool,
  setNotesTool,
  describeNotes,
  soloChannelTool,
  updateChannelTool,
  updatePatternTool,
  updateSong,
} from "./tool-edits";
import { useTransport } from "./transport";
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
      const wanted = String(input.plugin).trim().toLowerCase();
      const instruments = (await musicApi.listEnginePlugins()).filter((p) => p.isInstrument);
      const plugin = instruments.find((p) => p.id.toLowerCase() === wanted) ?? instruments.find((p) => p.name.toLowerCase() === wanted);
      if (!plugin) throw new Error(`There's no instrument plugin "${String(input.plugin)}" on this computer. The ones found: ${instruments.map((p) => p.name).join(", ") || "none"}.`);
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
  edit_step: edit(editStep),
  add_pattern: edit(addPatternTool),
  update_pattern: edit(updatePatternTool),
  remove_pattern: edit(removePatternTool),
  async get_mixer(_input, ctx) {
    const target = await targetOf(ctx);
    return textResult(describeMixer(target.song, target.open ? useTransport.getState().effects : null));
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
  async play_song(input, ctx) {
    const target = await targetOf(ctx);
    requireOpen(target, "Playing");
    if (input.action !== "play" && input.action !== "stop") throw new Error('"action" must be "play" or "stop".');
    useTransport.getState()[input.action]();
    return textResult(input.action === "play" ? "Playing the pattern shown, on a loop." : "Stopped.");
  },
};

export async function runMusicTool(name: string, input: Input, ctx: ToolRunContext): Promise<ToolResult> {
  const handler = (TOOLS as Record<string, ((input: Input, ctx: ToolRunContext) => Promise<ToolResult>) | undefined>)[name];
  if (!handler) return { content: [{ type: "text", text: `Unknown tool: ${name}` }], isError: true };
  return handler(input, ctx);
}
