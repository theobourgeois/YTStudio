/**
 * Right-click menus: one shared menu for the lane area (its content depends
 * on whether a clip or empty space was clicked) and one per track header.
 */
import { useState, type MouseEvent, type ReactNode } from "react";
import { useShallow } from "zustand/react/shallow";
import {
  PiArrowDown,
  PiArrowUp,
  PiArrowsIn,
  PiArrowsOut,
  PiBooks,
  PiClipboard,
  PiCopy,
  PiCopySimple,
  PiFilmStrip,
  PiMagicWand,
  PiMusicNotes,
  PiPaintBrushBroad,
  PiScissors,
  PiSelectionAll,
  PiSlidersHorizontal,
  PiSpeakerHigh,
  PiSpeakerSlash,
  PiSubtitles,
  PiTrash,
  PiArrowLineLeft,
} from "react-icons/pi";
import type { Track, TransitionAlignment } from "@shared/types";
import { MOTION, effectDefinition, findEffect, isTextClip, isVideoEffect, setParams } from "@shared/effects";
import { type TransitionRef, findWindow, parseRefKey, setTransitionParams } from "@shared/transition-windows";
import {
  addTrack,
  clipsAtTime,
  closeGap,
  gapAt,
  getClip,
  isOnVideoTrack,
  removeTrack,
  setTrackMuted,
  videoTracks,
} from "@shared/timeline";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuRadioGroup,
  ContextMenuRadioItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { useSaveToLibrary } from "@/components/library/library-dialogs";
import { SHORTCUT_KEYS } from "@/hooks/shortcuts";
import { useCaptions } from "@/stores/captions";
import { useEditor } from "@/stores/editor";
import { useLayout } from "@/stores/layout";
import { usePlayback } from "@/stores/playback";
import { lanePoint, useTimelineContext } from "./context";
import { laneAt } from "./geometry";

type MenuTarget =
  | { kind: "transition"; ref: TransitionRef }
  | { kind: "clip"; clipId: string; time: number }
  | { kind: "lane"; trackId: string | null; time: number };

const editor = useEditor.getState;

/** Wraps the lane area (a single element) so right-clicks open the timeline menu. */
export function LanesContextMenu({ children }: { children: ReactNode }) {
  const ctx = useTimelineContext();
  const [target, setTarget] = useState<MenuTarget | null>(null);

  const onContextMenu = (e: MouseEvent) => {
    const s = editor();
    const p = lanePoint(ctx, e.clientX, e.clientY);
    if (s.gestureBase || !p) {
      e.preventDefault(); // also keeps the menu closed
      return;
    }
    const time = Math.max(0, p.x / s.zoom);
    const key = (e.target as Element).closest<HTMLElement>("[data-transition]")?.dataset.transition;
    const ref = key ? parseRefKey(key) : null;
    if (ref) {
      if (findWindow(s.project, ref)) {
        s.selectTransition(ref);
        setTarget({ kind: "transition", ref });
        return;
      }
    }
    const clipId = (e.target as Element).closest<HTMLElement>("[data-clip-id]")?.dataset.clipId;
    if (clipId && getClip(s.project, clipId)) {
      if (!s.selectedClipIds.includes(clipId)) s.select(clipId);
      setTarget({ kind: "clip", clipId, time });
    } else {
      const trackId = laneAt(ctx.lanesLayout.current, p.y)?.trackId ?? null;
      if (trackId) s.selectGap(trackId, time);
      setTarget({ kind: "lane", trackId, time });
    }
  };

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild onContextMenu={onContextMenu}>
        {children}
      </ContextMenuTrigger>
      <ContextMenuContent className="w-60">
        {target?.kind === "transition" && <TransitionMenuItems target={target} />}
        {target?.kind === "clip" && <ClipMenuItems target={target} />}
        {target?.kind === "lane" && <LaneMenuItems target={target} />}
      </ContextMenuContent>
    </ContextMenu>
  );
}

function TransitionMenuItems({ target }: { target: Extract<MenuTarget, { kind: "transition" }> }) {
  const alignment = useEditor((s) => {
    const w = findWindow(s.project, target.ref);
    return w?.from && w.to ? w.transition.alignment : null;
  });
  return (
    <>
      <ContextMenuItem onSelect={() => useLayout.getState().setLeftPanel("properties")}>
        <PiSlidersHorizontal /> Properties
      </ContextMenuItem>
      {alignment && (
        <>
          <ContextMenuSeparator />
          <ContextMenuLabel className="text-xs text-muted-foreground">Alignment</ContextMenuLabel>
          <ContextMenuRadioGroup
            value={alignment}
            onValueChange={(v) => editor().commit((p) => setTransitionParams(p, target.ref, { alignment: v as TransitionAlignment }))}
          >
            <ContextMenuRadioItem value="center">Center at cut</ContextMenuRadioItem>
            <ContextMenuRadioItem value="start">Start at cut</ContextMenuRadioItem>
            <ContextMenuRadioItem value="end">End at cut</ContextMenuRadioItem>
          </ContextMenuRadioGroup>
        </>
      )}
      <ContextMenuSeparator />
      <ContextMenuItem variant="destructive" onSelect={() => editor().deleteSelected()}>
        <PiTrash /> Delete transition
        <ContextMenuShortcut>{SHORTCUT_KEYS.delete}</ContextMenuShortcut>
      </ContextMenuItem>
    </>
  );
}

function ClipMenuItems({ target }: { target: Extract<MenuTarget, { kind: "clip" }> }) {
  const count = useEditor((s) => s.selectedClipIds.length);
  const canPaste = useEditor((s) => s.clipboard.length > 0);
  const fit = useEditor((s) => {
    const clip = getClip(s.project, target.clipId);
    return clip && (findEffect(clip, MOTION.type)?.params.fit as string | undefined);
  });
  // Media on a video track is framed; text has no frame to fit.
  const framed = useEditor((s) => {
    const clip = getClip(s.project, target.clipId);
    return !!clip && isOnVideoTrack(s.project, clip) && !isTextClip(clip);
  });
  const playheadOnSelection = useEditor((s) => {
    const t = usePlayback.getState().time;
    return clipsAtTime(s.project, t).some((c) => s.selectedClipIds.includes(c.id));
  });
  const plural = count > 1 ? ` ${count} clips` : "";
  const hasSound = useEditor((s) =>
    s.selectedClipIds.some((id) => {
      const clip = getClip(s.project, id);
      return !!clip && !clip.caption && !!s.assets.find((a) => a.id === clip.assetId)?.hasAudio;
    }),
  );

  const setFit = (value: string) => {
    const s = editor();
    s.commit((p) =>
      s.selectedClipIds.reduce((q, id) => {
        const clip = getClip(q, id);
        return clip && isOnVideoTrack(q, clip) && !isTextClip(clip) ? setParams(q, id, MOTION.type, { fit: value }) : q;
      }, p),
    );
  };

  return (
    <>
      <ContextMenuItem onSelect={() => useLayout.getState().setLeftPanel("properties")}>
        <PiSlidersHorizontal /> Properties
      </ContextMenuItem>
      {hasSound && (
        <ContextMenuItem onSelect={() => useCaptions.getState().openDialog(editor().selectedClipIds)}>
          <PiSubtitles /> Auto captions…
        </ContextMenuItem>
      )}
      <ContextMenuSeparator />
      <ContextMenuItem onSelect={() => editor().splitAt([target.clipId], target.time)}>
        <PiScissors /> Split here
      </ContextMenuItem>
      <ContextMenuItem disabled={!playheadOnSelection} onSelect={() => editor().splitAtPlayhead()}>
        <PiScissors /> Split at playhead
        <ContextMenuShortcut>{SHORTCUT_KEYS.split}</ContextMenuShortcut>
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem onSelect={() => editor().cutSelected()}>
        <PiScissors /> Cut{plural}
        <ContextMenuShortcut>{SHORTCUT_KEYS.cut}</ContextMenuShortcut>
      </ContextMenuItem>
      <ContextMenuItem onSelect={() => editor().copySelected()}>
        <PiCopy /> Copy{plural}
        <ContextMenuShortcut>{SHORTCUT_KEYS.copy}</ContextMenuShortcut>
      </ContextMenuItem>
      <ContextMenuItem disabled={!canPaste} onSelect={() => editor().paste()}>
        <PiClipboard /> Paste at playhead
        <ContextMenuShortcut>{SHORTCUT_KEYS.paste}</ContextMenuShortcut>
      </ContextMenuItem>
      <ContextMenuItem onSelect={() => editor().duplicateSelected()}>
        <PiCopySimple /> Duplicate{plural}
        <ContextMenuShortcut>{SHORTCUT_KEYS.duplicate}</ContextMenuShortcut>
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem onSelect={() => editor().copyEffects(target.clipId)}>
        <PiMagicWand /> Copy effects
        <ContextMenuShortcut>{SHORTCUT_KEYS.copyEffects}</ContextMenuShortcut>
      </ContextMenuItem>
      <PasteEffectsMenu plural={plural} />
      <ContextMenuSeparator />
      <ContextMenuItem onSelect={() => useSaveToLibrary.getState().open(editor().selectedClipIds)}>
        <PiBooks /> Save{plural} to Library…
      </ContextMenuItem>
      <ContextMenuSeparator />
      {framed && (
        <>
          <ContextMenuLabel className="text-xs text-muted-foreground">Framing</ContextMenuLabel>
          <ContextMenuRadioGroup value={fit} onValueChange={setFit}>
            <ContextMenuRadioItem value="contain">
              <PiArrowsIn /> Fit (whole frame)
            </ContextMenuRadioItem>
            <ContextMenuRadioItem value="cover">
              <PiArrowsOut /> Fill (crop to canvas)
            </ContextMenuRadioItem>
          </ContextMenuRadioGroup>
          <ContextMenuSeparator />
        </>
      )}
      <ContextMenuItem onSelect={() => editor().moveSelectedToTrack(-1)}>
        <PiArrowUp /> Move to track above
        <ContextMenuShortcut>{SHORTCUT_KEYS.moveUp}</ContextMenuShortcut>
      </ContextMenuItem>
      <ContextMenuItem onSelect={() => editor().moveSelectedToTrack(1)}>
        <PiArrowDown /> Move to track below
        <ContextMenuShortcut>{SHORTCUT_KEYS.moveDown}</ContextMenuShortcut>
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem variant="destructive" onSelect={() => editor().deleteSelected()}>
        <PiTrash /> Delete{plural}
        <ContextMenuShortcut>{SHORTCUT_KEYS.delete}</ContextMenuShortcut>
      </ContextMenuItem>
      <ContextMenuItem variant="destructive" onSelect={() => editor().deleteSelected(true)}>
        <PiArrowLineLeft /> Ripple delete{plural}
        <ContextMenuShortcut>{SHORTCUT_KEYS.rippleDelete}</ContextMenuShortcut>
      </ContextMenuItem>
    </>
  );
}

/** Paste every copied effect, or one of them, onto the selected clips (Premiere's Paste Attributes). */
function PasteEffectsMenu({ plural }: { plural: string }) {
  // Copied effects that some selected clip has (a video can't take a text's Text), or video
  // effects, which any clip on a video track can take.
  const types = useEditor(
    useShallow((s) => {
      const copied = s.effectsClipboard?.effects ?? [];
      const clips = s.selectedClipIds.map((id) => getClip(s.project, id));
      const visual = clips.some((c) => c && isOnVideoTrack(s.project, c));
      const pastable = copied.filter(
        (e) => (visual && isVideoEffect(e)) || clips.some((c) => c?.effects.some((own) => own.id === e.id)),
      );
      return [...new Set(pastable.map((e) => e.type))];
    }),
  );
  return (
    <ContextMenuSub>
      <ContextMenuSubTrigger disabled={types.length === 0}>
        <PiPaintBrushBroad /> Paste effects{plural && ` onto${plural}`}
      </ContextMenuSubTrigger>
      <ContextMenuSubContent className="w-52">
        <ContextMenuItem onSelect={() => editor().pasteEffects()}>
          All effects
          <ContextMenuShortcut>{SHORTCUT_KEYS.pasteEffects}</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuSeparator />
        {types.map((type) => (
          <ContextMenuItem key={type} onSelect={() => editor().pasteEffects([type])}>
            {effectDefinition(type)?.label ?? type}
          </ContextMenuItem>
        ))}
      </ContextMenuSubContent>
    </ContextMenuSub>
  );
}

function LaneMenuItems({ target }: { target: Extract<MenuTarget, { kind: "lane" }> }) {
  const canPaste = useEditor((s) => s.clipboard.length > 0);
  const hasClips = useEditor((s) => s.project.clips.length > 0);
  const hasGap = useEditor((s) => !!target.trackId && gapAt(s.project, target.trackId, target.time) !== null);
  const { trackId, time } = target;

  return (
    <>
      <ContextMenuItem disabled={!canPaste} onSelect={() => editor().paste(time)}>
        <PiClipboard /> Paste here
      </ContextMenuItem>
      <ContextMenuItem
        disabled={!hasGap}
        onSelect={() => trackId && editor().commit((p) => closeGap(p, trackId, time))}
      >
        <PiArrowLineLeft /> Close gap
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem disabled={!hasClips} onSelect={() => editor().selectAll()}>
        <PiSelectionAll /> Select all
        <ContextMenuShortcut>{SHORTCUT_KEYS.selectAll}</ContextMenuShortcut>
      </ContextMenuItem>
      {trackId && (
        <ContextMenuItem disabled={!hasClips} onSelect={() => selectTrack(trackId)}>
          <PiSelectionAll /> Select all on this track
        </ContextMenuItem>
      )}
      <ContextMenuSeparator />
      <AddTrackItems />
    </>
  );
}

function selectTrack(trackId: string) {
  const s = editor();
  s.setSelection(s.project.clips.filter((c) => c.trackId === trackId).map((c) => c.id));
}

function AddTrackItems({ after }: { after?: Track }) {
  // Next to the clicked track when there is one, otherwise at the edge of its group.
  const index = useEditor((s) => (after ? s.project.tracks.findIndex((t) => t.id === after.id) : -1));
  return (
    <>
      <ContextMenuItem
        onSelect={() =>
          editor().commit((p) => addTrack(p, "video", after?.kind === "video" ? index : undefined).project)
        }
      >
        <PiFilmStrip /> Add video track{after?.kind === "video" ? " above" : ""}
      </ContextMenuItem>
      <ContextMenuItem
        onSelect={() =>
          editor().commit((p) => addTrack(p, "audio", after?.kind === "audio" ? index + 1 : undefined).project)
        }
      >
        <PiMusicNotes /> Add audio track{after?.kind === "audio" ? " below" : ""}
      </ContextMenuItem>
    </>
  );
}

export function TrackHeaderMenu({ track, children }: { track: Track; children: ReactNode }) {
  const hasClips = useEditor((s) => s.project.clips.some((c) => c.trackId === track.id));
  const removable = useEditor((s) => track.kind === "audio" || videoTracks(s.project).length > 1);
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent className="w-56">
        <ContextMenuLabel className="text-xs text-muted-foreground">{track.name}</ContextMenuLabel>
        <ContextMenuItem onSelect={() => editor().commit((p) => setTrackMuted(p, track.id, !track.muted))}>
          {track.muted ? <PiSpeakerHigh /> : <PiSpeakerSlash />}
          {track.muted ? "Unmute track" : "Mute track"}
        </ContextMenuItem>
        <ContextMenuItem disabled={!hasClips} onSelect={() => selectTrack(track.id)}>
          <PiSelectionAll /> Select all clips on track
        </ContextMenuItem>
        <ContextMenuSeparator />
        <AddTrackItems after={track} />
        <ContextMenuSeparator />
        <ContextMenuItem
          variant="destructive"
          disabled={!removable}
          onSelect={() => editor().commit((p) => removeTrack(p, track.id))}
        >
          <PiTrash /> Delete track{hasClips ? " and its clips" : ""}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
