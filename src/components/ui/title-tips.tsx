import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { addWindowListener, isElement, ownerWindow } from "@/lib/window-events";
import { placeTip } from "./title-tips-geometry";

/** How long the pointer rests on a control before its tip shows; within `SKIP` of the last one closing, at once. */
const DELAY = 400;
const SKIP = 300;

/**
 * Every `title` in the app shown as the app's own tooltip, not the browser's: whatever has one, in any
 * suite and in any of the editor's windows, gets the same tip as a `Tooltip`. While the pointer is on it,
 * its `title` is moved aside to `data-title` (so the browser's own tip never shows) and put back when the
 * pointer leaves; one that had no other name keeps its title as its name meanwhile (`aria-label`), or as
 * its description. Read a control's tip with `titleOf`, which finds it either way.
 */
export function TitleTips() {
  const [shown, setShown] = useState<{ el: Element; text: string } | null>(null);

  useEffect(() => {
    let current: Element | null = null;
    let observer: MutationObserver | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let visible = false;
    let lastHidden = -Infinity;

    const hide = () => {
      clearTimeout(timer);
      if (visible) lastHidden = performance.now();
      visible = false;
      setShown(null);
    };
    const release = () => {
      observer?.disconnect();
      observer = null;
      if (current) restore(current);
      current = null;
      hide();
    };
    const over = (e: PointerEvent) => {
      if (e.pointerType === "touch") return;
      const el = isElement(e.target) ? e.target.closest("[title], [data-title]") : null;
      if (el === current) return;
      release();
      if (!el || el.tagName === "IFRAME" || !take(el)) return;
      current = el;
      // Its title changed while it's under the pointer (Play becomes Pause): moved aside again, the tip follows.
      const watching = new MutationObserver(() => {
        if (!el.hasAttribute("title") || !take(el)) return;
        if (visible) setShown({ el, text: el.getAttribute("data-title") ?? "" });
      });
      watching.observe(el, { attributeFilter: ["title"] });
      observer = watching;
      timer = setTimeout(
        () => {
          if (current !== el || !el.isConnected) return;
          visible = true;
          setShown({ el, text: el.getAttribute("data-title") ?? "" });
        },
        performance.now() - lastHidden < SKIP ? 0 : DELAY,
      );
    };
    const out = (e: PointerEvent) => {
      if (current && !(isElement(e.relatedTarget) && current.contains(e.relatedTarget))) release();
    };
    const stops = [
      addWindowListener("pointerover", over),
      addWindowListener("pointerout", out),
      // Pressed, typed or scrolled: the tip goes (and comes back only when the pointer comes back).
      addWindowListener("pointerdown", hide, true),
      addWindowListener("keydown", hide, true),
      addWindowListener("wheel", hide, { capture: true, passive: true }),
      addWindowListener("blur", release),
    ];
    return () => {
      for (const stop of stops) stop();
      release();
    };
  }, []);

  return shown && shown.text ? <Tip el={shown.el} text={shown.text} /> : null;
}

function Tip({ el, text }: { el: Element; text: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    if (!ref.current) return;
    const win = ownerWindow(el);
    setPlace(placeTip(el.getBoundingClientRect(), ref.current.getBoundingClientRect(), { width: win.innerWidth, height: win.innerHeight }));
  }, [el, text]);
  return createPortal(
    <div
      ref={ref}
      role="tooltip"
      data-slot="title-tip"
      className="pointer-events-none fixed z-[2147483647] w-max max-w-80 animate-in floating rounded-sm px-2 py-1 text-xs whitespace-pre-line text-balance fade-in-0 zoom-in-95"
      style={{ left: place?.left ?? 0, top: place?.top ?? 0, visibility: place ? "visible" : "hidden" }}
    >
      {text}
    </div>,
    el.ownerDocument.body,
  );
}

/** A control's tip, whether or not it's under the pointer now (its `title`, moved aside while it is). */
export function titleOf(el: Element): string | null {
  return el.getAttribute("title") ?? el.getAttribute("data-title");
}

/** Move an element's title aside (see `TitleTips`); false if it has none to show. */
function take(el: Element): boolean {
  const title = el.getAttribute("title");
  if (title === null) return el.hasAttribute("data-title");
  // An empty title is there to say "no tip".
  if (!title.trim()) return false;
  el.removeAttribute("title");
  el.setAttribute("data-title", title);
  // What the title was to assistive technology, kept while it's aside: its name, or its description.
  if (el.hasAttribute("data-title-label")) el.setAttribute("aria-label", title);
  else if (el.hasAttribute("data-title-description")) el.setAttribute("aria-description", title);
  else if (!el.hasAttribute("aria-label") && !el.hasAttribute("aria-labelledby")) {
    const named = !!el.textContent?.trim();
    el.setAttribute(named ? "aria-description" : "aria-label", title);
    el.setAttribute(named ? "data-title-description" : "data-title-label", "");
  }
  return true;
}

/** Put an element's title back as it was. */
function restore(el: Element) {
  const title = el.getAttribute("data-title");
  el.removeAttribute("data-title");
  if (title !== null && !el.hasAttribute("title")) el.setAttribute("title", title);
  if (el.hasAttribute("data-title-label")) el.removeAttribute("aria-label");
  if (el.hasAttribute("data-title-description")) el.removeAttribute("aria-description");
  el.removeAttribute("data-title-label");
  el.removeAttribute("data-title-description");
}
