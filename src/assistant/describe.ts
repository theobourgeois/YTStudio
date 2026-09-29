/**
 * What the assistant reads: the timeline, clips, media, the catalogue of
 * effects and transitions, and the Library, written compactly for a model
 * (ids first, times in seconds, only what differs from the defaults).
 */
import { CAPTION_ANIMATIONS, CAPTION_LENGTHS, CAPTION_PRESETS, isCaptionClip, timelineWords } from "@shared/captions";
import {
  APPEARANCE,
  EFFECT_TAG_LABELS,
  type EffectDefinition,
  MOTION,
  OPACITY,
  TEXT,
  VIDEO_EFFECTS,
  VOLUME,
  effectDefinition,
  isTextClip,
} from "@shared/effects";
import { folderPath, folderSubtree, libraryItemDuration, libraryItemKind, searchItems } from "@shared/library";
import { type ParamSpec, sameValue } from "@shared/params";
import { clipEnd, clipName, clipSpeed, getTrack, outputSize, projectDuration, timelineTime, trackClips } from "@shared/timeline";
import { type TransitionWindow, trackTransitions } from "@shared/transition-windows";
import { TRANSITIONS } from "@shared/transitions";
import type { Clip, Effect, FontFamily, Library, MediaAsset, MusicAnalysis, ParamValue, Project, Transcript } from "@shared/types";
import { range, secs, value } from "./input";

export interface TimelineView {
  playhead: number;
  selectedClipIds: readonly string[];
}

export interface TimelineFilter {
  from?: number;
  to?: number;
  trackId?: string;
  captions?: boolean;
}

type Assets = Readonly<Record<string, MediaAsset>>;

const quote = (s: string, max = 60) => JSON.stringify(s.length > max ? `${s.slice(0, max - 1)}…` : s);

/** What's different about one effect: `scale 1.2, position animated (3 keyframes)`. */
function effectSummary(def: EffectDefinition, effect: Effect, skip: readonly string[] = []): string[] {
  const out: string[] = [];
  for (const spec of def.params) {
    if (skip.includes(spec.key)) continue;
    const keys = effect.keyframes?.[spec.key];
    if (keys?.length) {
      out.push(`${spec.key} animated (${keys.length} keyframe${keys.length === 1 ? "" : "s"})`);
      continue;
    }
    const v = effect.params[spec.key];
    if (v !== undefined && !sameValue(v, spec.default)) out.push(`${spec.key} ${value(v)}`);
  }
  return out;
}

function clipLine(clip: Clip, assets: Assets, windows: TransitionWindow[]): string {
  const asset = assets[clip.assetId];
  const parts: string[] = [];
  if (isTextClip(clip)) {
    const text = String(clip.effects.find((e) => e.type === TEXT.type)?.params.text ?? "");
    parts.push(`${isCaptionClip(clip) ? "caption" : "text"} ${quote(text.replace(/\n/g, "\\n"))}`);
  } else {
    const kind = asset ? asset.kind : "offline media";
    parts.push(`${quote(clipName(clip, asset), 48)} (${kind}${asset ? `, ${asset.id}` : ""})`);
    if (asset) parts.push(`source ${range(clip.in, clip.out)}${asset.kind === "image" ? "" : ` of ${secs(asset.duration)}`}`);
    const timing = [
      ...(clipSpeed(clip) !== 1 ? [`speed ${clipSpeed(clip)}×`] : []),
      ...(clip.reversed ? ["reversed"] : []),
      ...(clip.keepPitch === false ? ["pitch follows speed"] : []),
    ];
    if (timing.length) parts.push(timing.join(", "));
  }
  const fx: string[] = [];
  for (const effect of clip.effects) {
    const def = effectDefinition(effect.type);
    if (!def) continue;
    if (def.shader) {
      const summary = effectSummary(def, effect);
      fx.push(`${effect.id}${effect.enabled ? "" : " (off)"}${summary.length ? ` (${summary.join(", ")})` : ""}`);
      continue;
    }
    // Text clips: the words are shown above; style only.
    const summary = effectSummary(def, effect, def === TEXT ? ["text"] : []);
    if (!effect.enabled && !def.alwaysOn) parts.push(`${effect.id} off`);
    else if (summary.length) parts.push(`${effect.id}: ${summary.join(", ")}`);
  }
  if (fx.length) parts.push(`fx: ${fx.join(", ")}`);
  for (const w of windows) {
    if (w.ref.clipId !== clip.id) continue;
    const label = `${w.def.type} ${secs(w.transition.duration)}s`;
    if (w.from && w.to) parts.push(`${w.ref.edge === "out" ? "out" : "in"}: ${label} into ${w.to.id} (plays ${range(w.start, w.end)})`);
    else parts.push(`${w.ref.edge}: ${label} ${w.from ? "to nothing" : "from nothing"}`);
  }
  return `  ${clip.id}  ${range(clip.start, clipEnd(clip))}  ${parts.join(" · ")}`;
}

/** The whole timeline as text (see `get_timeline`). */
export function describeTimeline(project: Project, assets: Assets, view: TimelineView, filter: TimelineFilter = {}): string {
  const { width, height } = outputSize(project.settings.aspectRatio, "1080p");
  const lines = [
    `${quote(project.name)} · ${project.settings.aspectRatio} (${width}×${height} at 1080p) · ${project.settings.fps} fps · length ${secs(projectDuration(project))}s`,
    `Playhead ${secs(view.playhead)} · ${view.selectedClipIds.length ? `selected: ${view.selectedClipIds.join(", ")}` : "nothing selected"}`,
  ];
  if (filter.from !== undefined || filter.to !== undefined) lines.push(`Showing ${range(filter.from ?? 0, filter.to ?? projectDuration(project))} only`);
  lines.push("Tracks, top to bottom (a video track is drawn over the ones below it):");

  const inRange = (c: Clip) => (filter.from === undefined || clipEnd(c) > filter.from) && (filter.to === undefined || c.start < filter.to);
  for (const track of project.tracks) {
    if (filter.trackId && track.id !== filter.trackId) continue;
    const all = trackClips(project, track.id);
    const clips = all.filter(inRange);
    const head = `${quote(track.name)} ${track.id} · ${track.kind}${track.muted ? " · muted" : ""}`;
    const captions = all.length > 0 && all.every(isCaptionClip);
    if (captions && !filter.captions) {
      lines.push(`${head} · ${all.length} captions over ${range(all[0].start, clipEnd(all.at(-1)!))} (captions: true lists them)`);
      continue;
    }
    lines.push(all.length ? head : `${head} · empty`);
    const windows = track.kind === "video" ? trackTransitions(project, track.id) : [];
    let end = filter.from ?? 0;
    for (const clip of clips) {
      if (clip.start - end > 1e-3 && (filter.from === undefined || clip.start > filter.from)) lines.push(`  gap ${range(end, clip.start)}`);
      lines.push(clipLine(clip, assets, windows));
      end = Math.max(end, clipEnd(clip));
    }
  }
  if (project.clips.length === 0) lines.push("The timeline is empty. Add media with add_clips (see list_media).");
  return lines.join("\n");
}

const round = (v: ParamValue): ParamValue =>
  typeof v === "number" ? Math.round(v * 10000) / 10000 : Array.isArray(v) ? [round(v[0]) as number, round(v[1]) as number] : v;

/** Everything about some clips, as JSON (see `get_clips`). Keyframe times are timeline times. */
export function describeClips(project: Project, assets: Assets, ids: readonly string[]): string {
  const out = ids.map((id) => {
    const clip = project.clips.find((c) => c.id === id);
    if (!clip) return { id, error: "no such clip" };
    const asset = assets[clip.assetId];
    const track = getTrack(project, clip.trackId);
    const windows = track?.kind === "video" ? trackTransitions(project, track.id).filter((w) => w.ref.clipId === clip.id) : [];
    return {
      id: clip.id,
      track: track && { id: track.id, name: track.name, kind: track.kind },
      start: round(clip.start),
      end: round(clipEnd(clip)),
      ...(isTextClip(clip)
        ? { kind: clip.caption ? "caption" : "text" }
        : {
            kind: asset?.kind ?? "offline",
            media: asset && { id: asset.id, name: asset.name, duration: round(asset.duration) },
            source: { in: round(clip.in), out: round(clip.out) },
            speed: clipSpeed(clip),
            reversed: clip.reversed === true,
            keepPitch: clip.keepPitch !== false,
          }),
      effects: clip.effects.map((e) => ({
        id: e.id,
        type: e.type,
        enabled: e.enabled,
        params: Object.fromEntries(Object.entries(e.params).map(([k, v]) => [k, round(v)])),
        ...(e.keyframes && {
          keyframes: Object.fromEntries(
            Object.entries(e.keyframes).map(([k, keys]) => [
              k,
              keys.map((kf) => ({ time: round(timelineTime(clip, kf.time)), value: round(kf.value), easing: kf.easing })),
            ]),
          ),
        }),
      })),
      transitions: windows.map((w) => ({
        edge: w.ref.edge,
        type: w.transition.type,
        duration: w.transition.duration,
        alignment: w.transition.alignment,
        params: w.transition.params,
        plays: [round(w.start), round(w.end)],
        from: w.from?.id ?? null,
        to: w.to?.id ?? null,
      })),
    };
  });
  return JSON.stringify(out, null, 1);
}

/** The video's media files (see `list_media`). */
/** `marked`: the part of a file the user marked with In/Out in the source preview, if any. */
export function describeMedia(
  project: Project,
  assets: readonly MediaAsset[],
  marked: (asset: MediaAsset) => { in: number; out: number } | null = () => null,
): string {
  if (assets.length === 0) return "No media imported yet. Import files with import_media (paths on this computer or URLs).";
  return assets
    .map((a) => {
      const uses = project.clips.filter((c) => c.assetId === a.id).map((c) => c.id);
      const picture = a.hasVideo && a.width && a.height ? ` ${a.width}×${a.height}` : "";
      const fps = a.kind === "video" && a.fps ? ` ${Math.round(a.fps * 100) / 100}fps` : "";
      const length = a.kind === "image" ? "still" : `${secs(a.duration)}s`;
      const sound = a.kind === "video" ? (a.hasAudio ? ", has sound" : ", silent") : "";
      const status = a.status === "error" ? ` · UNUSABLE: ${a.error ?? "couldn't be read"}` : "";
      const used = uses.length ? ` · on the timeline ${uses.length}× (${uses.slice(0, 6).join(", ")}${uses.length > 6 ? "…" : ""})` : " · not used";
      const range = marked(a);
      const marks = range ? ` · the user marked ${secs(range.in)}–${secs(range.out)}s (In/Out: use it as add_clips in/out)` : "";
      return `${a.id}  ${quote(a.name, 56)}  ${a.kind}${picture}${fps} ${length}${sound}${status}${used}${marks}`;
    })
    .join("\n");
}

function specLine(spec: ParamSpec): string {
  const d = value(spec.default);
  switch (spec.kind) {
    case "number": {
      const unit = spec.scale === 100 ? " (1 = 100%)" : spec.unit ? ` ${spec.unit}` : "";
      return `${spec.key}: ${spec.min}..${spec.max}${unit}, default ${d}`;
    }
    case "vec2":
      return `${spec.key}: [x, y] as fractions of the ${spec.space === "canvas" ? "canvas" : "clip's frame"}, default ${d}`;
    case "choice":
      return `${spec.key}: ${spec.options.map((o) => o.value).join(" | ")}, default ${d}`;
    case "boolean":
      return `${spec.key}: true | false, default ${d}`;
    case "color":
      return `${spec.key}: "#rrggbb", default ${d}`;
    case "font":
      return `${spec.key}: font family (see get_catalog "fonts"), default ${d}`;
    case "fontStyle":
      return `${spec.key}: one of the font's styles, default ${d}`;
    default:
      return `${spec.key}: text, default ${d}`;
  }
}

const matches = (query: string | undefined, ...fields: string[]) =>
  !query || fields.some((f) => f.toLowerCase().includes(query.toLowerCase()));

export type CatalogKind = "video_effects" | "transitions" | "clip_properties" | "caption_styles" | "fonts";

/** What exists to use (see `get_catalog`). Fonts are passed in (they come from the server). */
export function describeCatalog(kind: CatalogKind, query?: string, fonts: readonly FontFamily[] = []): string {
  const params = (specs: readonly ParamSpec[]) => (specs.length ? specs.map((s) => `    ${specLine(s)}`).join("\n") : "    (no parameters)");
  switch (kind) {
    case "video_effects": {
      const found = VIDEO_EFFECTS.filter((d) => matches(query, d.type, d.label, ...(d.shader?.tags ?? [])));
      if (!found.length) return `No video effect matches "${query}".`;
      return [
        "Video effects (add_effect; each is drawn over the clip's picture before Motion places it):",
        ...found.map((d) => `${d.type}  "${d.label}" [${(d.shader?.tags ?? []).map((t) => EFFECT_TAG_LABELS[t]).join(", ")}]\n${params(d.params)}`),
      ].join("\n");
    }
    case "transitions": {
      const found = TRANSITIONS.filter((d) => matches(query, d.type, d.label, ...d.tags));
      if (!found.length) return `No transition matches "${query}".`;
      return [
        "Transitions (set_transition; duration 0.1..5 s, alignment center | start | end):",
        ...found.map((d) => `${d.type}  "${d.label}" [${d.tags.join(", ")}] default ${d.duration}s\n${params(d.params)}`),
      ].join("\n");
    }
    case "clip_properties":
      return [
        "Built-in effects (set_properties / set_keyframes with these effect ids):",
        ...[MOTION, OPACITY, VOLUME, TEXT, APPEARANCE].map((d) => {
          const where = d === VOLUME ? "clips with sound" : d === TEXT || d === APPEARANCE ? "text clips" : "clips with a picture";
          return `${d.type}  "${d.label}" (${where})\n${params(d.params)}`;
        }),
      ].join("\n");
    case "caption_styles":
      return [
        "Caption presets (generate_captions preset / style_captions preset):",
        ...CAPTION_PRESETS.map((p) => `  ${p.id}  "${p.label}": ${JSON.stringify({ ...p.text, ...p.appearance })}`),
        "Lengths (generate_captions length):",
        ...CAPTION_LENGTHS.map((l) => `  ${l.value}: ${l.hint}`),
        'Animations (a transition each caption appears with; any transition type works, or "none"):',
        ...CAPTION_ANIMATIONS.map((a) => `  ${a.type} (${a.label}, ${a.duration}s)`),
      ].join("\n");
    case "fonts": {
      const found = fonts.filter((f) => matches(query, f.family));
      if (!found.length) return query ? `No installed font matches "${query}".` : "No fonts found.";
      return [
        `${found.length} installed font famil${found.length === 1 ? "y" : "ies"} (family: styles):`,
        ...found.slice(0, 300).map((f) => `  ${f.family}: ${f.styles.map((s) => s.name).join(", ")}`),
        ...(found.length > 300 ? [`  … ${found.length - 300} more (narrow with query)`] : []),
      ].join("\n");
    }
  }
}

/** The Library (see `get_library`). */
export function describeLibrary(library: Library, query?: string, folderId?: string): string {
  const media = new Map(library.media.map((m) => [m.id, m]));
  const path = (id: string | null) => folderPath(library.folders, id).map((f) => f.name).join("/") || "top level";
  const scope = folderId ? folderSubtree(library.folders, folderId) : null;
  const lines: string[] = [];
  const folders = library.folders.filter((f) => !scope || scope.has(f.id));
  if (folders.length && !query) {
    lines.push("Folders:");
    const visit = (parent: string | null, depth: number) => {
      for (const f of folders.filter((x) => x.parentId === parent).sort((a, b) => a.name.localeCompare(b.name))) {
        const count = library.items.filter((i) => i.folderId === f.id).length;
        lines.push(`${"  ".repeat(depth + 1)}${f.id}  ${quote(f.name)} (${count} item${count === 1 ? "" : "s"})`);
        visit(f.id, depth + 1);
      }
    };
    visit(folderId ? (library.folders.find((f) => f.id === folderId)?.parentId ?? null) : null, 0);
    if (folderId && lines.length === 1) lines.pop();
  }
  let items = library.items.filter((i) => !scope || (i.folderId !== null && scope.has(i.folderId)));
  if (query) items = searchItems(items, query);
  lines.push(items.length ? "Items:" : query ? `No item matches "${query}".` : "No items.");
  for (const item of items) {
    const kind = libraryItemKind(item, media);
    const length = kind === "image" ? "still" : `${secs(libraryItemDuration(item, media))}s`;
    const what = kind === "clips" ? `saved clips (${item.kind === "clips" ? item.template.clips.length : 0})` : kind;
    lines.push(`  ${item.id}  ${quote(item.name)}  ${what} ${length} · in ${path(item.folderId)}${item.favorite ? " · ★" : ""}`);
  }
  return lines.join("\n");
}

/** A pause this long between words starts a new line of the transcript. */
const PHRASE_GAP = 0.35;
const PHRASE_WORDS = 14;

/**
 * What's said in clips (see `get_transcript`): per clip, lines of words each
 * with its timeline start time (`word@12.34`), the line's end after it. A new
 * line starts after a pause or a sentence's end, so pauses show between lines.
 */
export function describeTranscript(clips: readonly Clip[], transcripts: readonly Transcript[], assets: Assets): string {
  const out: string[] = ["Timeline times. Each word is written word@start; a line ends at the time after the dash."];
  const words = timelineWords(clips, transcripts);
  clips.forEach((clip, group) => {
    const own = words.filter((w) => w.group === group);
    out.push(`${clip.id} "${clipName(clip, assets[clip.assetId])}" ${range(clip.start, clipEnd(clip))}${own.length ? "" : ": no speech"}`);
    let line: typeof own = [];
    const flush = () => {
      if (!line.length) return;
      out.push(`  ${line.map((w) => `${w.text.trim()}@${secs(w.start)}`).join(" ")} – ${secs(line.at(-1)!.end)}`);
      line = [];
    };
    for (const w of own) {
      const prev = line.at(-1);
      if (prev && (w.start - prev.end > PHRASE_GAP || /[.!?…]$/.test(prev.text.trim()) || line.length >= PHRASE_WORDS)) flush();
      line.push(w);
    }
    flush();
  });
  return out.join("\n");
}

/** Most beats listed at once (a long song has hundreds; bars are listed in full). */
const MAX_BEATS = 400;

/**
 * A music analysis for the model (see `analyze_music`), with times moved by `shift` (source -> timeline for a
 * clip) and kept inside `span`.
 */
export function describeMusic(label: string, music: MusicAnalysis, shift: number, span: { start: number; end: number }, timeline: boolean): string {
  const at = (t: number) => t + shift;
  const inside = (t: number) => t >= span.start - 1e-3 && t <= span.end + 1e-3;
  const times = (list: number[]) => list.map(at).filter(inside);
  const where = timeline ? "timeline" : "source";
  const lines = [`${label} ${range(span.start, span.end)} (${where} times)`];
  if (music.bpm === null) {
    lines.push("No steady beat here (speech, ambient sound, or free-time music): cut on the sections or drops instead.");
  } else {
    const beat = 60 / music.bpm;
    const steadiness = music.confidence >= 0.5 ? "a clear beat" : music.confidence >= 0.3 ? "a fairly clear beat" : "a weak beat, so treat these as approximate";
    lines.push(`${music.bpm} BPM: a beat every ${secs(beat)}s, a bar (4 beats) every ${secs(beat * 4)}s; ${steadiness} (confidence ${music.confidence}).`);
    lines.push(`Bars start at: ${times(music.downbeats).map(secs).join(", ") || "(none in this range)"}`);
    const beats = times(music.beats);
    lines.push(`Beats: ${beats.slice(0, MAX_BEATS).map(secs).join(" ")}${beats.length > MAX_BEATS ? ` … (${beats.length - MAX_BEATS} more: ask for a shorter range)` : ""}`);
  }
  const sections = music.sections
    .map((s) => ({ ...s, start: Math.max(span.start, at(s.start)), end: Math.min(span.end, at(s.end)) }))
    .filter((s) => s.end - s.start > 0.05);
  const feel = (level: number) => (level >= 0.85 ? "loud" : level >= 0.6 ? "medium" : level >= 0.3 ? "quiet" : "very quiet");
  lines.push(`Sections: ${sections.map((s) => `${range(s.start, s.end)} ${feel(s.level)} (${s.db} dB)`).join(" · ") || "(none)"}`);
  const drops = music.drops.filter((d) => inside(at(d.time)));
  lines.push(
    drops.length
      ? `Drops (the energy jumps up; biggest first): ${drops.map((d) => `${secs(at(d.time))} (+${d.rise} dB)`).join(", ")}`
      : "No drops: the energy doesn't jump up anywhere here.",
  );
  return lines.join("\n");
}
