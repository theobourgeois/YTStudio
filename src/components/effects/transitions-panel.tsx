/**
 * The Effects tab's transitions, like CapCut's Transitions or Premiere's
 * Video Transitions: search, filter by tag, hover a card to watch it play,
 * then drag it onto a cut or clip edge, double-click it or press + to put it
 * on the edit point nearest the playhead.
 */
import { useMemo, useState } from "react";
import { TAG_LABELS, TRANSITIONS, TRANSITION_TAGS, type TransitionTag } from "@shared/transitions";
import { getClip } from "@shared/timeline";
import { storedTransition } from "@shared/transition-windows";
import { setTransitionDragData } from "@/lib/dnd";
import { useEditor } from "@/stores/editor";
import { LibraryCard, LibraryGrid, filterLibrary } from "./library-grid";
import { drawThumbnail, transitionThumb } from "./thumbnails";

/** Tags that some transition has, in display order. */
const TAGS = TRANSITION_TAGS.filter((tag) => TRANSITIONS.some((d) => d.tags.includes(tag)));

/** One loop of the hover animation: the transition, then a pause on each side. */
const LOOP_MS = 1800;

export function TransitionsPanel() {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<TransitionTag | "all">("all");
  const visible = useMemo(() => filterLibrary(TRANSITIONS, TAG_LABELS, query, filter), [query, filter]);
  // The selected transition's type, highlighted in the grid.
  const selectedType = useEditor((s) => {
    const ref = s.selectedTransition;
    const clip = ref && getClip(s.project, ref.clipId);
    return (clip && storedTransition(clip, ref.edge)?.type) ?? null;
  });

  return (
    <LibraryGrid
      search="transitions"
      tags={TAGS}
      labels={TAG_LABELS}
      query={query}
      onQuery={setQuery}
      filter={filter}
      onFilter={setFilter}
      count={visible.length}
    >
      {visible.map((def) => {
        const thumb = transitionThumb(def);
        return (
          <LibraryCard
            key={def.type}
            thumb={thumb}
            label={def.label}
            selected={def.type === selectedType}
            data={{ "data-transition-type": def.type }}
            play={(canvas, elapsed) => {
              // 0..1 over 70% of the loop, holding the ends in between.
              const phase = (elapsed % LOOP_MS) / LOOP_MS;
              void drawThumbnail(thumb, Math.min(1, Math.max(0, (phase - 0.15) / 0.7)), canvas);
            }}
            onApply={() => useEditor.getState().applyTransition(def.type)}
            applyHint="Add at the nearest cut"
            onDragStart={(dt) => setTransitionDragData(dt, def.type)}
          />
        );
      })}
    </LibraryGrid>
  );
}
