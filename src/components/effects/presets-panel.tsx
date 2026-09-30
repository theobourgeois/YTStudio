/**
 * The Effects tab's presets, like After Effects' Animation Presets: ready-made
 * transitions (an adjustment layer animated across a cut) and moves and looks
 * (put on clips). Hover a card to watch it, then drag it onto a cut (a
 * transition) or a clip (an effect preset; on empty space it makes an adjustment
 * layer), or double-click it or press + to use it at the playhead. Everything
 * it adds stays editable in the Properties tab.
 */
import { useMemo, useState } from "react";
import { PRESETS, PRESET_TAGS, PRESET_TAG_LABELS, type PresetDefinition, type PresetTag } from "@shared/presets";
import { setPresetDragData } from "@/lib/dnd";
import { useEditor } from "@/stores/editor";
import { LibraryCard, LibraryGrid, filterLibrary } from "./library-grid";
import { drawThumbnail, presetThumb } from "./thumbnails";

/** Tags that some preset has, in display order. */
const TAGS = PRESET_TAGS.filter((tag) => PRESETS.some((d) => d.tags.includes(tag)));

/** How long a card holds still before and after playing its preset, in ms. */
const PAUSE_MS = 350;

/** A transition plays at its own speed; a slow move plays faster, so the card shows all of it. */
const playMs = (def: PresetDefinition) => Math.min(2000, Math.max(700, def.duration * 1000));

export function PresetsPanel() {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<PresetTag | "all">("all");
  const visible = useMemo(() => filterLibrary(PRESETS, PRESET_TAG_LABELS, query, filter), [query, filter]);

  return (
    <LibraryGrid
      search="presets"
      tags={TAGS}
      labels={PRESET_TAG_LABELS}
      query={query}
      onQuery={setQuery}
      filter={filter}
      onFilter={setFilter}
      count={visible.length}
    >
      {visible.map((def) => {
        const thumb = presetThumb(def);
        const transition = def.kind === "transition";
        return (
          <LibraryCard
            key={def.type}
            thumb={thumb}
            label={def.label}
            data={{ "data-preset-type": def.type, "data-preset-kind": def.kind }}
            play={(canvas, elapsed) => {
              const ms = playMs(def);
              const phase = (elapsed % (ms + 2 * PAUSE_MS)) - PAUSE_MS;
              void drawThumbnail(thumb, (Math.min(ms, Math.max(0, phase)) / ms) * def.duration, canvas);
            }}
            onApply={() => useEditor.getState().applyPreset(def.type)}
            applyHint={transition ? "Add at the nearest cut" : "Add to the selected clips"}
            onDragStart={(dt) => setPresetDragData(dt, def.kind, def.type)}
          />
        );
      })}
    </LibraryGrid>
  );
}
