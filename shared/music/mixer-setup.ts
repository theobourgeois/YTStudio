import { canSend, routeChannels, updateMixerTrack } from "./mixer.ts";
import { createMixerTrack, MASTER_TRACK_ID, MAX_INSERTS } from "./project.ts";
import type { Channel, MixerTrack, MusicProject } from "./types.ts";

export const MIX_ROLES = ["instr", "bass", "drums"] as const;
export type MixRole = (typeof MIX_ROLES)[number];
export type SetupBus = MixRole | "vocals" | "mixbus";
export const ROLE_COLORS: Record<SetupBus, string> = { instr: "#c85454", bass: "#5279cf", drums: "#c6aa43", vocals: "#4e9d61", mixbus: "#409ca0" };
export const ROLE_LABELS: Record<MixRole, string> = { instr: "Instruments", bass: "Bass", drums: "Drums" };
export interface ChannelEvidence { channelId: string; name: string; kind: Channel["kind"]; preset: string | null; category: string | null; filename: string | null; supported: boolean; issue?: string }
export interface ChannelClassification extends ChannelEvidence { role: MixRole | "unknown"; confidence: number; probabilities?: Record<string, number>; source: "jev" | "rule" | "existing" | "unavailable" }
export interface MixerSetupResult { channels: ChannelClassification[]; model: string | null }
export interface MixerSetupRequest { projectId: string; song: MusicProject; overrides?: Record<string, { preset: string; category: string }> }
export const isMixRole = (role: unknown): role is MixRole => MIX_ROLES.includes(role as MixRole);

/** User conventions take precedence over model uncertainty, especially 808 → bass. */
export function explicitMixRole(evidence: ChannelEvidence): MixRole | null {
  const name = (evidence.filename ?? evidence.preset ?? "").replace(/_/g, " ");
  if (/\b808\b/i.test(name) || /^808$/i.test(evidence.category ?? "")) return "bass";
  const category = evidence.category?.trim().toLowerCase();
  if (category === "bass" || category === "sub") return "bass";
  if (["lead", "pad", "synth", "arpeggio", "arp", "keys", "chord", "pluck"].includes(category ?? "")) return "instr";
  if (["drums", "drum", "percussion"].includes(category ?? "")) return "drums";
  if (!evidence.filename && /^(BA|BS)\b/i.test(name)) return "bass";
  if (!evidence.filename && /^(SY|ARP|LD|PD|PL|KEY)\b/i.test(name)) return "instr";
  if (evidence.filename && /^(KICK|SNARE|HH|OH|CLAP|PERC)\b/i.test(name.replace(/_/g, " "))) return "drums";
  return null;
}

/** Only genuinely untouched tracks may be claimed for the template. */
export function setupTrackFree(song: MusicProject, track: MixerTrack): boolean {
  const defaults = createMixerTrack(track.id);
  return track.id !== MASTER_TRACK_ID && JSON.stringify(track) === JSON.stringify(defaults)
    && !song.channels.some((c) => c.mixerTrack === track.id)
    && !song.mixer.tracks.some((t) => t.sends.some((s) => s.to === track.id) || t.effects.some((e) => e?.sidechain?.track === track.id))
    && !song.playlist.tracks.some((t) => t.mixerTrack === track.id)
    && !song.automations.some((a) => a.target.kind === "mixer" && a.target.track === track.id);
}

/** Pure atomic setup; throwing leaves the caller's original document untouched. */
export function fillMixerInserts(song: MusicProject, assignments: ReadonlyMap<string, MixRole>, names: ReadonlyMap<string, string> = new Map()): MusicProject {
  if (!assignments.size) return song;
  for (const [id, role] of assignments) if (!song.channels.some((c) => c.id === id) || !isMixRole(role)) throw new Error("The channel rack changed. Run Fill inserts again.");
  let next = song;
  const ensureCount = (count: number) => {
    if (count > MAX_INSERTS + 1) throw new Error("The mixer has no room for more inserts.");
    if (next.mixer.tracks.length < count) next = { ...next, mixer: { ...next.mixer, tracks: [...next.mixer.tracks, ...Array.from({ length: count - next.mixer.tracks.length }, () => createMixerTrack())] } };
  };
  ensureCount(26);
  const busIds = new Map<SetupBus, string>();
  (["instr", "bass", "drums", "vocals", "mixbus"] as SetupBus[]).forEach((role, i) => {
    const existing = next.mixer.tracks.filter((t) => t.setupRole === role && !t.setupChannel);
    if (existing.length > 1) throw new Error(`More than one managed ${role} bus exists.`);
    const template = next.mixer.tracks.filter((t) => t.name?.toLowerCase() === role && t.dock === "right" && !t.setupChannel && !t.setupRole && !t.input && !next.channels.some((c) => c.mixerTrack === t.id));
    if (!existing.length && template.length > 1) throw new Error(`More than one ${role} template bus exists.`);
    const track = existing[0] ?? template[0] ?? next.mixer.tracks[21 + i];
    if (!existing.length && !template.length && !setupTrackFree(next, track)) throw new Error(`Insert ${21 + i} is already in use. Move it before filling inserts; its settings have been preserved.`);
    if (next.channels.some((c) => c.mixerTrack === track.id) || track.input) throw new Error(`The ${role} bus is being used as a source or recording input.`);
    busIds.set(role, track.id);
    next = updateMixerTrack(next, track.id, { name: role, color: ROLE_COLORS[role], dock: "right" });
    next = { ...next, mixer: { ...next.mixer, tracks: next.mixer.tracks.map((t) => t.id === track.id ? { ...t, setupRole: role } : t) } };
  });
  // Capture identities before adding sources: template 16 is recording, 17–20 are vocals.
  // Existing managed setups retain these identities even when source growth changes numbers.
  const recording = next.mixer.tracks.find((t) => t.id === "insert_16" && !t.setupChannel)
    ?? next.mixer.tracks.find((t) => !t.setupChannel && (t.input || /^(rec|recording)$/i.test(t.name ?? "")))
    ?? next.mixer.tracks[16];
  const boundaryId = recording.id;
  const route = (from: string, to: string) => {
    const track = next.mixer.tracks.find((t) => t.id === from)!;
    const outputs = track.sends.filter((s) => s.level > 0);
    if (outputs.some((s) => s.to !== MASTER_TRACK_ID && s.to !== to && !(track.setupChannel && [...busIds.values()].includes(s.to)))) throw new Error(`${track.name ?? "This insert"} has custom output routing. Its routing has been preserved.`);
    // Keep explicit sidechain-only links, while replacing the audible output.
    const sends = [...track.sends.filter((s) => s.level === 0 && s.to !== to), track.sends.find((s) => s.to === to && s.level > 0) ?? { to, level: 1 }];
    if (!canSend(next, from, to)) throw new Error(`Routing ${track.name} would create a feedback loop.`);
    next = { ...next, mixer: { ...next.mixer, tracks: next.mixer.tracks.map((t) => t.id === from ? { ...t, sends } : t) } };
  };
  route(busIds.get("mixbus")!, MASTER_TRACK_ID);
  for (const role of ["instr", "bass", "drums", "vocals"] as const) route(busIds.get(role)!, busIds.get("mixbus")!);
  for (const channel of song.channels.filter((c) => assignments.has(c.id))) {
    const role = assignments.get(channel.id)!;
    const current = next.mixer.tracks.find((t) => t.id === channel.mixerTrack)!;
    const managed = next.mixer.tracks.find((t) => t.setupChannel === channel.id);
    if (managed?.input) throw new Error(`${channel.name} uses a recording input. Its settings have been preserved.`);
    let track: MixerTrack | undefined = managed;
    if (managed && current.id !== managed.id) throw new Error(`${channel.name} was manually routed elsewhere. Its routing has been preserved.`);
    if (!track && current.id !== MASTER_TRACK_ID) {
      if (next.mixer.tracks.indexOf(current) >= next.mixer.tracks.findIndex((t) => t.id === boundaryId) || current.setupChannel && current.setupChannel !== channel.id) throw new Error(`${channel.name} uses a recording/vocal or managed insert. Its routing has been preserved.`);
      if (busIds.has(current.setupRole as SetupBus) && !current.setupChannel || next.channels.filter((c) => c.mixerTrack === current.id).length !== 1 || current.input) throw new Error(`${channel.name} shares an insert or uses a bus/recording input. Route it to its own insert first.`);
      track = current;
    }
    if (!track) track = next.mixer.tracks.find((t, i) => i < next.mixer.tracks.findIndex((candidate) => candidate.id === boundaryId) && setupTrackFree(next, t));
    if (!track) { ensureCount(next.mixer.tracks.length + 1); track = next.mixer.tracks.at(-1)!; }
    const id = track.id;
    next = routeChannels(next, [channel.id], id);
    next = updateMixerTrack(next, id, { name: names.get(channel.id) || channel.name, color: ROLE_COLORS[role] });
    next = { ...next, mixer: { ...next.mixer, tracks: next.mixer.tracks.map((t) => t.id === id ? { ...t, setupRole: role, setupChannel: channel.id } : t) } };
    route(id, busIds.get(role)!);
  }
  // Keep all owned sources before recording/vocals, grouped by role and rack order.
  // Stable ids preserve every effect, automation target, channel and send as numbers change.
  const rackOrder = new Map(next.channels.map((c, i) => [c.id, i]));
  const owned = next.mixer.tracks.filter((t) => t.setupChannel && rackOrder.has(t.setupChannel) && isMixRole(t.setupRole));
  owned.sort((a, b) => MIX_ROLES.indexOf(a.setupRole as MixRole) - MIX_ROLES.indexOf(b.setupRole as MixRole) || rackOrder.get(a.setupChannel!)! - rackOrder.get(b.setupChannel!)!);
  const ownedIds = new Set(owned.map((t) => t.id));
  const remaining = next.mixer.tracks.filter((t) => !ownedIds.has(t.id));
  next = { ...next, mixer: { ...next.mixer, tracks: [remaining[0], ...owned, ...remaining.slice(1)] } };
  // Repeated runs produce no history entry if nothing changed.
  return JSON.stringify(next) === JSON.stringify(song) ? song : next;
}
