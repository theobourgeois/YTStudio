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
  clipKind,
  CAMERA,
  MASK,
  SOLID,
  TEXT_ANIMATOR,
} from "@shared/effects";
import { ANIMATOR_PRESETS } from "@shared/text-animators";
import { SHAPE_EFFECTS } from "@shared/effect-library/shape";
import { EXPRESSION_GLOBALS } from "@shared/expressions";
import { isPath } from "@shared/params";
import { folderPath, folderSubtree, libraryItemDuration, libraryItemKind, searchItems } from "@shared/library";
import { type ParamSpec, sameValue } from "@shared/params";
import { subclipsByAsset } from "@shared/subclips";
import { clipEnd, clipName, clipSpeed, getTrack, outputSize, projectDuration, timelineTime, trackClips } from "@shared/timeline";
import { type TransitionWindow, trackTransitions } from "@shared/transition-windows";
import { PRESETS, type PresetDefinition } from "@shared/presets";
import { TRANSITIONS } from "@shared/transitions";
import type { Clip, Effect, FontFamily, Library, Marker, MediaAsset, MusicAnalysis, ParamValue, Project, Transcript } from "@shared/types";
import { clipMarkers, sequenceMarkers } from "@shared/markers";
import { getSequence, sequenceDuration } from "@shared/sequences";
import { remapSegments } from "@shared/time-remap";
import { isRemapped } from "@shared/effects";
import { pathText, range, secs, value } from "./input";

export interface TimelineView {
  playhead: number;
  selectedClipIds: readonly string[];
  /** The nested sequence `project` is a view of (absent or null: the main one). */
  sequenceId?: string | null;
}

export interface TimelineFilter {
  from?: number;
  to?: number;
  trackId?: string;
  captions?: boolean;
}

type Assets = Readonly<Record<string, MediaAsset>>;

const quote = (s: string, max = 60) => JSON.stringify(s.length > max ? `${s.slice(0, max - 1)}…` : s);

/** `3.5 "Drop" (marker_ab12)`. */
const markerText = (m: Marker, time: number) => `${secs(time)}${m.label ? ` ${quote(m.label, 40)}` : ""} (${m.id})`;

/** What's different about one effect: `scale 1.2, position animated (3 keyframes)`. */
function effectSummary(def: EffectDefinition, effect: Effect, skip: readonly string[] = []): string[] {
  const out: string[] = [];
  for (const spec of def.params) {
    if (skip.includes(spec.key)) continue;
    const keys = effect.keyframes?.[spec.key];
    const expression = effect.expressions?.[spec.key];
    if (expression !== undefined) out.push(`${spec.key} = expression ${quote(expression.replace(/\s+/g, " "), 80)}`);
    if (keys?.length) {
      out.push(`${spec.key} animated (${keys.length} keyframe${keys.length === 1 ? "" : "s"})`);
      continue;
    }
    if (expression !== undefined) continue;
    const v = effect.params[spec.key];
    if (v !== undefined && !sameValue(v, spec.default)) out.push(`${spec.key} ${value(v)}`);
  }
  return out;
}

function clipLine(clip: Clip, assets: Assets, windows: TransitionWindow[]): string {
  const asset = assets[clip.assetId];
  const parts: string[] = [];
  const kind = clipKind(clip);
  if (kind === "text") {
    const text = String(clip.effects.find((e) => e.type === TEXT.type)?.params.text ?? "");
    parts.push(`${isCaptionClip(clip) ? "caption" : "text"} ${quote(text.replace(/\n/g, "\\n"))}`);
  } else if (kind === "adjustment") {
    parts.push("adjustment layer (changes the tracks below it)");
  } else if (kind === "solid") {
    parts.push("solid");
  } else if (kind === "shape") {
    parts.push("shape layer (vector shapes; its contents are its effects, in order)");
  } else if (kind === "camera") {
    parts.push("camera (3D layers are seen through it)");
  } else if (kind === "null") {
    parts.push("null object (draws nothing; clips parented to it follow its motion)");
  } else if (asset?.sequence) {
    parts.push(`nested sequence ${quote(asset.name)} (${asset.id}), showing ${range(clip.in, clip.out)} of its ${secs(asset.duration)}s`);
    if (clipSpeed(clip) !== 1 || clip.reversed) parts.push([`speed ${clipSpeed(clip)}×`, clip.reversed && "reversed"].filter(Boolean).join(", "));
  } else {
    const kind = asset ? asset.kind : "offline media";
    parts.push(`${quote(clipName(clip, asset), 48)} (${kind}${asset ? `, ${asset.id}` : ""})`);
    if (asset) parts.push(`source ${range(clip.in, clip.out)}${asset.kind === "image" ? "" : ` of ${secs(asset.duration)}`}`);
    const timing = [
      ...(clipSpeed(clip) !== 1 ? [`speed ${clipSpeed(clip)}×`] : []),
      ...(clip.reversed ? ["reversed"] : []),
      ...(clip.keepPitch === false ? ["pitch follows speed"] : []),
      ...(clip.timeInterpolation ? [clip.timeInterpolation === "flow" ? "optical flow" : "frame blending"] : []),
    ];
    if (timing.length) parts.push(timing.join(", "));
  }
  const fx: string[] = [];
  for (const effect of clip.effects) {
    const def = effectDefinition(effect.type);
    if (!def) continue;
    if (def.shader || def.stackable) {
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
  if (clip.parent) parts.push(`parent: ${clip.parent.id}`);
  const marks = clipMarkers(clip);
  if (marks.length) parts.push(`markers: ${marks.map((m) => markerText(m.marker, m.time)).join(", ")}`);
  const remap = remapSegments(clip);
  if (remap.length) {
    parts.push(`time remapped: ${remap.map((s) => `${range(s.start, s.end)} ${s.speed === 0 ? "freeze" : `${Math.round(s.speed * 100)}%`}`).join(", ")}`);
  }
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
  const open = view.sequenceId ? getSequence(project, view.sequenceId) : undefined;
  const lines = [
    open
      ? `Nested sequence ${open.id} ${quote(open.name)} of ${quote(project.name)} · ${project.settings.aspectRatio} (${width}×${height}) · ${project.settings.fps} fps · length ${secs(sequenceDuration(open))}s${open.duration === undefined ? "" : " (set)"} · open_sequence(null) goes back to the main sequence`
      : `${quote(project.name)} · ${project.settings.aspectRatio} (${width}×${height} at 1080p) · ${project.settings.fps} fps · length ${secs(projectDuration(project))}s`,
    `Playhead ${secs(view.playhead)} · ${view.selectedClipIds.length ? `selected: ${view.selectedClipIds.join(", ")}` : "nothing selected"}`,
  ];
  const markers = sequenceMarkers(project);
  if (markers.length) {
    const shown = markers.slice(0, 60).map((m) => markerText(m, m.time));
    lines.push(`Markers (set_markers): ${shown.join(", ")}${markers.length > 60 ? `, … ${markers.length - 60} more` : ""}`);
  }
  const nested = (project.sequences ?? []).filter((s) => s.id !== open?.id);
  if (nested.length) {
    lines.push(
      `Nested sequences (open_sequence to edit inside; add one with add_clips assetId = its id): ${nested
        .map((s) => `${s.id} ${quote(s.name)} ${s.settings.aspectRatio} ${secs(sequenceDuration(s))}s, ${s.clips.length} clips`)
        .join("; ")}`,
    );
  }
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

/** A value as the model reads it: numbers rounded, a path as SVG path data (in fractions of the clip's frame). */
const round = (v: ParamValue): ParamValue =>
  typeof v === "number" ? Math.round(v * 10000) / 10000 : Array.isArray(v) ? [round(v[0]) as number, round(v[1]) as number] : isPath(v) ? pathText(v) : v;

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
      ...(clip.parent && { parent: clip.parent.id }),
      ...(clipMarkers(clip).length && { markers: clipMarkers(clip).map((m) => ({ id: m.marker.id, time: round(m.time), ...(m.marker.label && { label: m.marker.label }) })) }),
      ...(asset?.sequence && { nestedSequence: { id: asset.id, name: asset.name, duration: round(asset.duration) } }),
      ...(isRemapped(clip) && {
        remap: remapSegments(clip).map((seg, index) => ({
          index,
          start: round(seg.start),
          end: round(seg.end),
          speed: round(seg.speed),
          media: [round(seg.mediaFrom), round(seg.mediaTo)],
        })),
      }),
      ...(clipKind(clip) === "text"
        ? { kind: clip.caption ? "caption" : "text" }
        : clipKind(clip) !== "media"
          ? { kind: clipKind(clip) === "adjustment" ? "adjustment layer" : clipKind(clip) === "null" ? "null object" : clipKind(clip) === "shape" ? "shape layer" : clipKind(clip) }
          : {
            kind: asset?.kind ?? "offline",
            media: asset && { id: asset.id, name: asset.name, duration: round(asset.duration) },
            source: { in: round(clip.in), out: round(clip.out) },
            speed: clipSpeed(clip),
            reversed: clip.reversed === true,
            keepPitch: clip.keepPitch !== false,
            timeInterpolation: clip.timeInterpolation ?? "frames",
          }),
      effects: clip.effects.map((e) => ({
        id: e.id,
        type: e.type,
        enabled: e.enabled,
        params: Object.fromEntries(Object.entries(e.params).map(([k, v]) => [k, round(v)])),
        ...(e.expressions && { expressions: e.expressions }),
        ...(e.keyframes && {
          keyframes: Object.fromEntries(
            Object.entries(e.keyframes).map(([k, keys]) => [
              k,
              keys.map((kf) => ({
                time: round(timelineTime(clip, kf.time)),
                value: round(kf.value),
                easing: kf.easing,
                ...(kf.influence !== undefined && { influence: kf.influence }),
                ...(kf.handleIn && { handleIn: kf.handleIn }),
                ...(kf.handleOut && { handleOut: kf.handleOut }),
                ...(kf.spatialIn && { spatialIn: kf.spatialIn }),
                ...(kf.spatialOut && { spatialOut: kf.spatialOut }),
              })),
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
      const subclips = (subclipsByAsset(project).get(a.id) ?? []).map(
        (s) => `\n  subclip ${s.id}  ${quote(s.name, 56)}  ${secs(s.in)}–${secs(s.out)}s (${secs(s.out - s.in)}s)`,
      );
      return `${a.id}  ${quote(a.name, 56)}  ${a.kind}${picture}${fps} ${length}${sound}${status}${used}${marks}${subclips.join("")}`;
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
      return spec.space === "px"
        ? `${spec.key}: [x, y] in px (of the canvas at 1080p), default ${d}`
        : `${spec.key}: [x, y] as fractions of the ${spec.space === "canvas" ? "canvas" : "clip's frame"}, default ${d}`;
    case "path":
      return `${spec.key}: a path in fractions of the clip's frame (SVG path data, or [[x, y], ...] for a polygon), default ${d}`;
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

export type CatalogKind = "video_effects" | "masks_and_shapes" | "text_animators" | "expressions" | "presets" | "transitions" | "clip_properties" | "caption_styles" | "fonts";

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
    case "masks_and_shapes": {
      const found = [MASK, ...SHAPE_EFFECTS].filter((d) => matches(query, d.type, d.label));
      if (!found.length) return `No mask or shape content matches "${query}".`;
      return [
        "Masks and shape layers (add_effect with these types; then set_properties / set_keyframes with the effect id it returns).",
        "mask goes on any clip with a picture (and on adjustment layers: where they change what's below): the clip only shows inside its path. " +
          "Several combine in order (mode add / subtract / intersect); feather softens the edge, expansion grows or shrinks it; keyframe `path` to morph it (e.g. a reveal, a rotoscope).",
        "The rest are a shape layer's contents (add_layer kind \"shape\" makes one with a first vector-shape): vector-shape draws a rectangle, ellipse, polygon, star or a drawn path " +
          "with its own fill, gradient and stroke; the operators change every shape before them in the list (edit_effect move to reorder): trim-paths (animate end 0→1 to draw a line on), " +
          "repeater, offset-paths, round-corners, wiggle-paths, zig-zag, merge-paths. Sizes are px of the canvas at 1080p; positions and path points are fractions of the frame.",
        ...found.map((d) => `${d.type}  "${d.label}"\n${params(d.params)}`),
      ].join("\n");
    }
    case "expressions":
      return [
        "Expressions (set_expression): a JavaScript-like script on a number or point parameter, run at every frame; its last statement is the value. " +
          "Numbers, [x, y] arrays (array ± array, array * number), + - * / % **, comparisons, && || ?:, variables (a = 1), if/else, Math.*. No loops or functions. " +
          "Values are in the parameter's own units (see the other catalogues): positions are canvas fractions, scale 1 = 100%, rotation degrees.",
        ...EXPRESSION_GLOBALS.filter((g) => matches(query, g.name, g.description)).map((g) => `  ${g.signature}: ${g.description}`),
      ].join("\n");
    case "text_animators":
      return [
        'Text animators (add_effect type "text-animator" on text clips; a text can have several). The text is laid along 0..1, each ' +
          "character (or word, or line: basedOn) taking an equal stretch; the range start..end (both moved by offset) picks the ones the values " +
          "below are applied to, by `shape`: square (all or nothing, partly for a unit the range only partly covers), ramp-up / ramp-down " +
          "(building up / fading out across the range, and staying past its end), triangle, round, smooth (peaking in the middle). " +
          "Letters outside the range are untouched. So to fade a text in letter by letter: opacity 0, and keyframe `start` from 0 to 1 " +
          "(set_keyframes effect text-animator param start): the hidden range shrinks from the left.",
        `text-animator  "Animator"\n${params(TEXT_ANIMATOR.params)}`,
        "Presets (add_effect type text-animator, preset <id>): their range is keyframed from the clip's start, longer for longer texts.",
        ...ANIMATOR_PRESETS.filter((p) => matches(query, p.id, p.label)).map((p) => `  ${p.id}  "${p.label}": ${JSON.stringify(p.params)}, animates ${Object.keys(p.keys).join(", ")}`),
      ].join("\n");
    case "presets": {
      const found = PRESETS.filter((d) => matches(query, d.type, d.label, d.kind, ...d.tags));
      if (!found.length) return `No preset matches "${query}".`;
      const what = (d: PresetDefinition) =>
        d.effects.map((fx) => `${fx.type}${fx.keys ? ` (animates ${Object.keys(fx.keys).join(", ")})` : ""}`).join(", ");
      return [
        "Presets (apply_preset). Transitions: an adjustment layer centred on a cut. Effects: on clips, " +
          "from their start (in), to their end (out), or over all of them (stretch).",
        ...found.map(
          (d) =>
            `${d.type}  "${d.label}" ${d.kind}${d.kind === "effect" ? ` (${d.anchor ?? "start"})` : ""} [${d.tags.join(", ")}] ${d.duration}s: ${what(d)}`,
        ),
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
        ...[MOTION, OPACITY, VOLUME, TEXT, APPEARANCE, SOLID, CAMERA].map((d) => {
          const where =
            d === VOLUME
              ? "clips with sound"
              : d === TEXT || d === APPEARANCE
                ? "text clips"
                : d === SOLID
                  ? "solids"
                  : d === CAMERA
                    ? "camera clips (add_layer kind camera)"
                    : "clips with a picture, and adjustment layers";
          return `${d.type}  "${d.label}" (${where})\n${params(d.params)}`;
        }),
      ].join("\n");
    case "caption_styles":
      return [
        "Caption presets (generate_captions preset / style_captions preset):",
        ...CAPTION_PRESETS.map((p) => `  ${p.id}  "${p.label}": ${JSON.stringify({ ...p.text, ...p.appearance })}`),
        "Lengths (generate_captions length):",
        ...CAPTION_LENGTHS.map((l) => `  ${l.value}: ${l.hint}`),
        'Animations (spoken-* follow the speech word by word with a text animator; the others are a transition each caption appears with, and any transition type works; or "none"):',
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
/** `times: "source"`: the clips are whole files (from 0), so their times are the files' own. */
export function describeTranscript(
  clips: readonly Clip[],
  transcripts: readonly Transcript[],
  assets: Assets,
  times: "timeline" | "source" = "timeline",
): string {
  const kind = times === "source" ? "Source times (seconds into the file)" : "Timeline times";
  const out: string[] = [`${kind}. Each word is written word@start; a line ends at the time after the dash.`];
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
