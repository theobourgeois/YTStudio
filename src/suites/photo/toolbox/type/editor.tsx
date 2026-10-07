/**
 * Typing on the canvas (docs/photo/tools/type.md, "The tool"): a `<textarea>` over the text layer, transformed with it
 * onto the screen, set in its font, size, letter spacing, line height and alignment so its lines are the drawn ones.
 * Its own letters are transparent (the renderer draws the real ones under it): only the caret and the selection show.
 * A dashed outline shows the frame; a paragraph box has handles that resize it (the words reflow).
 */
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { type Affine, apply, compose, invert, layerMatrix } from "@shared/photo/layers";
import { letterSpacingOf, textScale } from "@shared/photo/text";
import type { TextLayer } from "@shared/photo/types";
import { startPointerDrag } from "@/lib/pointer-drag";
import { layoutWithFonts } from "../../text-measure";
import { usePhotoDoc } from "../../store";
import { usePhotoUi } from "../../ui";
import type { DocPointOf } from "../kit";
import { commitText, resizeBox, typeText, useTypeSession } from "./session";

let focused: HTMLTextAreaElement | null = null;

/** Puts the keyboard back in the text being typed (after an option of the bar took it). */
export const focusTypeEditor = () => requestAnimationFrame(() => focused?.focus({ preventScroll: true }));

/** Layer pixels → CSS pixels of the canvas's box. */
function toScreen(layer: TextLayer, view: { x: number; y: number; zoom: number }): Affine {
  const k = view.zoom / devicePixelRatio;
  return compose([k, 0, 0, k, -view.x * k, -view.y * k], layerMatrix(layer.transform, layer.size));
}

const css = (m: Affine) => `matrix(${m.map((v) => Math.round(v * 1e6) / 1e6).join(",")})`;

export function TypeEditor({ docPoint }: { docPoint: DocPointOf }) {
  const editing = useTypeSession((s) => s.editing);
  const layer = usePhotoDoc((d) => d.layers.find((l) => l.id === editing?.layerId));
  const view = usePhotoUi((s) => s.view);
  if (!editing || layer?.kind !== "text" || !view) return null;
  return <Editing layer={layer} view={view} caret={editing.caret} docPoint={docPoint} />;
}

/** A box's eight handles, as fractions of it. */
const HANDLES: [number, number][] = [[0, 0], [0.5, 0], [1, 0], [1, 0.5], [1, 1], [0.5, 1], [0, 1], [0, 0.5]];

function Editing({ layer, view, caret, docPoint }: { layer: TextLayer; view: { x: number; y: number; zoom: number }; caret: number | "all" | "end"; docPoint: DocPointOf }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const { text, font, align, box, origin } = layer;
  const layout = useMemo(() => layoutWithFonts(layer), [layer]);
  const m = toScreen(layer, view);
  // The field is set unscaled and scaled as a whole: its glyphs, advances and ascent then are the drawn ones.
  const scale = textScale(layer);

  // Focused once it's there (after the press that started it has finished), the caret where it was asked for.
  useEffect(() => {
    const el = ref.current!;
    focused = el;
    const id = setTimeout(() => {
      el.focus({ preventScroll: true });
      if (caret === "all") el.select();
      else {
        const at = caret === "end" ? el.value.length : caret;
        el.setSelectionRange(at, at);
      }
    });
    return () => {
      clearTimeout(id);
      if (focused === el) focused = null;
    };
    // Once per session: the caret is where the press was.
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // A textarea scrolls its content while it's briefly too small for it: the drawn words don't.
  useLayoutEffect(() => {
    const el = ref.current;
    if (el && (el.scrollLeft || el.scrollTop)) el.scrollLeft = el.scrollTop = 0;
  });

  // The field's box in the layer's frame: point text's lines around its origin, a paragraph's box.
  const pad = font.size;
  const width = box ? box.width : layout.width;
  const left = box ? origin.x : align === "center" ? origin.x - width / 2 : align === "right" ? origin.x - width : origin.x;
  const top = origin.y + layout.top;
  const height = box ? box.height : Math.max(layout.lineHeight, layout.lines.length * layout.lineHeight);
  const field = compose(m, [scale.x, 0, 0, scale.y, left - (box ? 0 : pad), top]);

  const frame = [apply(m, 0, 0), apply(m, layer.size.width, 0), apply(m, layer.size.width, layer.size.height), apply(m, 0, layer.size.height)];
  const boxCorner = (u: number, v: number) => apply(m, origin.x + u * (box?.width ?? 0), origin.y + v * (box?.height ?? 0));

  const dragHandle = (e: React.PointerEvent, [u, v]: [number, number]) => {
    if (!box || e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    const from = layer;
    const toFrame = invert(layerMatrix(from.transform, from.size));
    const start = { x0: from.origin.x, y0: from.origin.y, x1: from.origin.x + box.width, y1: from.origin.y + box.height };
    startPointerDrag(e, {
      threshold: 0,
      cursor: "crosshair",
      onMove: (ev) => {
        const p = docPoint(ev.clientX, ev.clientY);
        const f = apply(toFrame, p.x, p.y);
        const rect = { ...start };
        if (u === 0) rect.x0 = Math.min(f.x, start.x1 - 1);
        if (u === 1) rect.x1 = Math.max(f.x, start.x0 + 1);
        if (v === 0) rect.y0 = Math.min(f.y, start.y1 - 1);
        if (v === 1) rect.y1 = Math.max(f.y, start.y0 + 1);
        resizeBox(from, rect);
      },
      onEnd: () => ref.current?.focus({ preventScroll: true }),
      onCancel: () => ref.current?.focus({ preventScroll: true }),
    });
  };

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" data-type-editor={layer.id}>
      <svg className="absolute inset-0 size-full overflow-visible">
        <polygon points={frame.map((p) => `${p.x},${p.y}`).join(" ")} fill="none" stroke="var(--brand)" strokeOpacity={0.7} strokeDasharray="3 3" strokeWidth={1} data-type-frame />
        {box &&
          HANDLES.map(([u, v]) => {
            const p = boxCorner(u, v);
            return (
              <rect
                key={`${u},${v}`}
                x={p.x - 4}
                y={p.y - 4}
                width={8}
                height={8}
                fill="white"
                stroke="var(--brand)"
                className="pointer-events-auto cursor-crosshair"
                onPointerDown={(e) => dragHandle(e, [u, v])}
                data-box-handle={`${u},${v}`}
              />
            );
          })}
      </svg>
      <textarea
        ref={ref}
        aria-label="Text on canvas"
        value={text}
        spellCheck={false}
        wrap={box ? "soft" : "off"}
        onChange={(e) => typeText(e.target.value)}
        onPointerDown={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          // Escape, ⌘Enter (Ctrl+Enter) and the keypad's Enter commit (Photoshop's).
          if (e.key === "Escape" || (e.key === "Enter" && (e.metaKey || e.ctrlKey || e.nativeEvent.location === 3))) {
            e.preventDefault();
            e.stopPropagation();
            commitText();
          }
        }}
        className="pointer-events-auto absolute top-0 left-0 m-0 origin-top-left resize-none overflow-hidden border-0 bg-transparent p-0 text-transparent outline-none selection:bg-brand/40"
        style={{
          // The longhands, as the canvas's `font` says them (the shorthand would reset the line height on a change).
          fontFamily: `"${font.family.replace(/["\\]/g, "\\$&")}", sans-serif`,
          fontWeight: font.weight,
          fontStyle: font.italic ? "italic" : "normal",
          fontSize: `${font.size}px`,
          fontStretch: font.stretch ?? "normal",
          fontKerning: layer.kerning === "none" ? "none" : "normal",
          fontVariantCaps: layer.caps === "small" ? "small-caps" : "normal",
          textTransform: layer.caps === "all" ? "uppercase" : "none",
          lineHeight: `${layout.lineHeight / scale.y}px`,
          letterSpacing: `${letterSpacingOf(layer)}px`,
          textAlign: align === "justify" ? (box ? "justify" : "left") : align,
          textAlignLast: align === "justify" ? "left" : undefined,
          whiteSpace: box ? "pre-wrap" : "pre",
          overflowWrap: "break-word",
          width: (width + (box ? 0 : 2 * pad)) / scale.x,
          height: height / scale.y,
          paddingLeft: box ? 0 : pad / scale.x,
          paddingRight: box ? 0 : pad / scale.x,
          transform: css(field),
          caretColor: layer.colour,
        }}
        data-type-field
      />
    </div>
  );
}

