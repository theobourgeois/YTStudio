/**
 * The Effects tab's video effects, like Premiere's Video Effects or CapCut's
 * Effects: search, filter by category, hover a card to see it (moving effects
 * play, the others compare before and after), then drag it onto a clip on the
 * timeline or the canvas, or double-click it or press + to add it to the
 * selected clips. Its settings are then in the Properties tab.
 */
import { useMemo, useState } from "react";
import { EFFECT_TAGS, EFFECT_TAG_LABELS, type EffectTag, VIDEO_EFFECTS } from "@shared/effects";
import { setEffectDragData } from "@/lib/dnd";
import { useEditor } from "@/stores/editor";
import { LibraryCard, LibraryGrid, filterLibrary } from "./library-grid";
import { drawThumbnail, effectThumb } from "./thumbnails";

const ITEMS = VIDEO_EFFECTS.map((def) => ({ def, label: def.label, tags: def.shader?.tags ?? [] }));

/** Categories that some effect has, in display order. */
const TAGS = EFFECT_TAGS.filter((tag) => ITEMS.some((d) => d.tags.includes(tag)));

/** One sweep of the before/after comparison, there and back. */
const COMPARE_MS = 2600;

export function VideoEffectsPanel() {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<EffectTag | "all">("all");
  const visible = useMemo(() => filterLibrary(ITEMS, EFFECT_TAG_LABELS, query, filter), [query, filter]);

  return (
    <LibraryGrid
      search="effects"
      tags={TAGS}
      labels={EFFECT_TAG_LABELS}
      query={query}
      onQuery={setQuery}
      filter={filter}
      onFilter={setFilter}
      count={visible.length}
    >
      {visible.map(({ def }) => {
        const thumb = effectThumb(def);
        return (
          <LibraryCard
            key={def.type}
            thumb={thumb}
            label={def.label}
            data={{ "data-effect-type": def.type }}
            play={(canvas, elapsed) => {
              if (def.shader?.animated) void drawThumbnail(thumb, thumb.posterAt + elapsed / 1000, canvas);
              else void drawThumbnail(thumb, thumb.posterAt, canvas, 0.5 - 0.5 * Math.cos((elapsed / COMPARE_MS) * 2 * Math.PI));
            }}
            onApply={() => useEditor.getState().applyEffect(def.type)}
            applyHint="Add to the selected clips"
            onDragStart={(dt) => setEffectDragData(dt, def.type)}
          />
        );
      })}
    </LibraryGrid>
  );
}
