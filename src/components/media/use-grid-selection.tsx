import { useMemo, useRef, useState, type DragEvent, type KeyboardEvent, type MouseEvent, type PointerEvent } from "react";
import { cancelActiveDrag, startPointerDrag } from "@/lib/pointer-drag";
import {
  type Box,
  NO_SELECTION,
  actionTargets,
  boxBetween,
  boxesOverlap,
  clickSelect,
  marqueeSelect,
  orderedSelection,
  pruneSelection,
} from "./grid-selection";

/**
 * Presses here don't start a selection box: cards, buttons, folder rows, the
 * scrollbar. Cards do with ⌘/⇧ held (like Finder), instead of being dragged.
 */
const NOT_EMPTY_SPACE = "[data-grid-item], button, [role=button], input, a, [data-slot=scroll-area-scrollbar]";

/**
 * Selection for a grid of cards (see `grid-selection.ts`). Cards get
 * `data-grid-item={id}`; the element around the scroll area gets
 * `containerProps` and renders `marquee`; `contentRef` goes on the scrolled
 * content. With cards selected, Delete/Backspace (or ⌘⌫) calls `onDelete`,
 * Escape clears and ⌘A selects every card shown.
 */
export function useGridSelection(order: readonly string[], { onDelete, dragItems = false }: { onDelete: (ids: string[]) => void; dragItems?: boolean }) {
  const [raw, setRaw] = useState(NO_SELECTION);
  const [box, setBox] = useState<Box | null>(null);
  const sel = useMemo(() => pruneSelection(raw, order), [raw, order]);
  const selected = useMemo(() => new Set(sel.ids), [sel]);
  const contentRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  /** A box is being pressed out (so the card under it isn't dragged). */
  const boxing = useRef(false);
  /** The press already handled the click that follows it. */
  const clickHandled = useRef(false);

  const selectOnly = (id: string) => setRaw({ ids: [id], anchor: id });

  return {
    contentRef,
    isSelected: (id: string) => selected.has(id),
    /** What a card's actions apply to: the selection when the card is in it, else the card. */
    targets: (id: string) => actionTargets(sel, order, id),
    /** A card was clicked. True for a plain click, which the card also acts on (e.g. previews). */
    click(e: MouseEvent, id: string): boolean {
      if (clickHandled.current) return false;
      const mods = { toggle: e.metaKey || e.ctrlKey, range: e.shiftKey };
      setRaw(clickSelect(sel, order, id, mods));
      return !mods.toggle && !mods.range;
    },
    /** Right-clicking or dragging a card that isn't selected selects it alone (like Finder). */
    grab(id: string): string[] {
      if (!selected.has(id)) selectOnly(id);
      return actionTargets(sel, order, id);
    },
    clear: () => setRaw(NO_SELECTION),
    select: (ids: string[]) => setRaw({ ids, anchor: ids[0] ?? null }),

    containerProps: {
      ref: containerRef,
      onPointerDown(e: PointerEvent<HTMLDivElement>) {
        const target = e.target as Element;
        // React bubbles events from portalled menus here too.
        if (e.button !== 0 || !e.currentTarget.contains(target)) return;
        const additive = e.metaKey || e.ctrlKey || e.shiftKey;
        const blocker = target.closest<HTMLElement>(NOT_EMPTY_SPACE);
        // The card's own buttons are nearer than the card, so they still block.
        const card = (additive || dragItems) && blocker?.dataset.gridItem;
        if (blocker && !card) return;
        const content = contentRef.current;
        const container = containerRef.current;
        if (!content || !container) return;
        // Focus the grid so Delete and ⌘A reach it.
        content.focus({ preventScroll: true });
        const base = sel;
        const mods = { toggle: e.metaKey || e.ctrlKey, range: e.shiftKey };
        const done = () => {
          boxing.current = false;
          if (!card) return;
          // The click that follows (if it reaches the card at all) was this press.
          clickHandled.current = true;
          setTimeout(() => (clickHandled.current = false));
        };
        // Kept in content coordinates, so the box stays anchored if the grid scrolls.
        const start = content.getBoundingClientRect();
        const origin = { x: e.clientX - start.left, y: e.clientY - start.top };
        boxing.current = startPointerDrag(e, {
          threshold: 4,
          onMove(ev) {
            const c = content.getBoundingClientRect();
            const hit = boxBetween({ x: origin.x + c.left, y: origin.y + c.top }, { x: ev.clientX, y: ev.clientY });
            const hits: string[] = [];
            for (const el of content.querySelectorAll<HTMLElement>("[data-grid-item]")) {
              const r = el.getBoundingClientRect();
              if (boxesOverlap(hit, r) && el.dataset.gridItem) hits.push(el.dataset.gridItem);
            }
            setRaw(marqueeSelect(base, hits, additive));
            const p = container.getBoundingClientRect();
            setBox({ left: hit.left - p.left, top: hit.top - p.top, right: hit.right - p.left, bottom: hit.bottom - p.top });
          },
          onEnd() {
            setBox(null);
            done();
          },
          onCancel() {
            setBox(null);
            setRaw(base);
            done();
          },
          onClick() {
            if (card) setRaw(clickSelect(base, order, card, mods));
            else if (!additive) setRaw(NO_SELECTION);
            done();
          },
        });
      },
      // Not the card's own drag (which would also select it alone).
      onDragStartCapture(e: DragEvent<HTMLDivElement>) {
        if (!boxing.current) return;
        e.preventDefault();
        e.stopPropagation();
      },
      // ⌃-click on a Mac opens the menu instead.
      onContextMenuCapture() {
        if (boxing.current) cancelActiveDrag();
      },
      onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
        const target = e.target as Element;
        if (e.defaultPrevented || !e.currentTarget.contains(target) || target.closest("input, textarea")) return;
        const ids = orderedSelection(sel, order);
        if ((e.key === "Delete" || e.key === "Backspace") && ids.length > 0 && !e.altKey) {
          e.preventDefault(); // not also the timeline's Delete
          onDelete(ids);
        } else if (e.key === "Escape" && ids.length > 0) {
          e.preventDefault();
          setRaw(NO_SELECTION);
        } else if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "a") {
          e.preventDefault(); // not also the timeline's Select All
          setRaw({ ids: [...order], anchor: order[0] ?? null });
        }
      },
    },

    marquee: box && (
      <div
        aria-hidden
        className="pointer-events-none absolute rounded-sm border border-brand/80 bg-brand/15"
        style={{ left: box.left, top: box.top, width: box.right - box.left, height: box.bottom - box.top }}
      />
    ),
  };
}
