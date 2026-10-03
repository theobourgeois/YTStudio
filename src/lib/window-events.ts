/**
 * The page can be in more than one window: in the desktop app the music editor's windows are windows of the
 * system (`components/windows/native/`), opened by the page and drawn by it, so one script serves several
 * documents. `window` and `document` are always the main one's; anything that listens to the keyboard or the
 * pointer, or asks where the focus is, has to say which window it means. These are how.
 */

const extra = new Set<Window>();
const changed = new Set<() => void>();

interface Registered {
  type: string;
  handler: EventListenerOrEventListenerObject;
  options?: boolean | AddEventListenerOptions;
}
const registered = new Set<Registered>();

/** The window a node is drawn in (the main one for `null`, a detached node and anything that isn't a node). */
export function ownerWindow(node?: EventTarget | null): Window {
  const owned = (node as Node | null | undefined)?.ownerDocument?.defaultView;
  if (owned) return owned;
  // A document, or a window itself.
  const own = (node as Document | null | undefined)?.defaultView;
  if (own) return own;
  if (node && "document" in node) return node as Window;
  return window;
}

/** The document a node is in (the main one for `null`). */
export const ownerDocument = (node?: EventTarget | null): Document => ownerWindow(node).document;

/** The main window and the windows opened for panels, now. */
export const allWindows = (): Window[] => [window, ...extra];

/**
 * Listen on the main window and on every window opened for a panel, those opened later too: for what the
 * editor wants wherever the user is (its shortcuts, a drag's end). Returns how to stop. Handlers see events
 * from each window as they are (`clientX` is the window's own), so use `ownerWindow(event.target)` for any
 * measuring.
 */
export function addWindowListener<K extends keyof WindowEventMap>(type: K, handler: (event: WindowEventMap[K]) => void, options?: boolean | AddEventListenerOptions): () => void;
export function addWindowListener(type: string, handler: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions): () => void;
export function addWindowListener(type: string, handler: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions): () => void {
  const entry: Registered = { type, handler, options };
  registered.add(entry);
  for (const win of allWindows()) win.addEventListener(type, handler, options);
  return () => {
    registered.delete(entry);
    for (const win of allWindows()) win.removeEventListener(type, handler, options);
  };
}

/** A window opened for a panel joins the ones `addWindowListener` reaches. Returns how to take it out again. */
export function registerWindow(win: Window): () => void {
  if (extra.has(win)) return () => {};
  extra.add(win);
  for (const { type, handler, options } of registered) win.addEventListener(type, handler, options);
  for (const listener of changed) listener();
  return () => {
    if (!extra.delete(win)) return;
    // The window may be gone already; removing from it then throws nothing, it only does nothing.
    for (const { type, handler, options } of registered) {
      try {
        win.removeEventListener(type, handler, options);
      } catch {
        // closed
      }
    }
    for (const listener of changed) listener();
  };
}

/** Called when a panel's window opens or closes. */
export function onWindowsChanged(listener: () => void): () => void {
  changed.add(listener);
  return () => void changed.delete(listener);
}

/** The first element matching `selector` in any of the page's windows. */
export function queryAnywhere<T extends Element = HTMLElement>(selector: string): T | null {
  for (const win of allWindows()) {
    try {
      const found = win.document.querySelector<T>(selector);
      if (found) return found;
    } catch {
      // a window that closed
    }
  }
  return null;
}

/** Whether the element has the keyboard in its own window (the focus is in a window that has it). */
export function isFocusedElement(element: Element | null | undefined): boolean {
  return !!element && element.ownerDocument.activeElement === element && element.ownerDocument.hasFocus();
}

/**
 * Whether something is an element, wherever it was made: `instanceof Element` is false for an element of
 * another window, which has its own `Element`. (And `instanceof HTMLElement` for an HTML one.)
 */
export function isElement(value: unknown): value is Element {
  return typeof value === "object" && value !== null && (value as Node).nodeType === 1;
}

/** An element of HTML (not SVG), wherever it was made. */
export function isHtmlElement(value: unknown): value is HTMLElement {
  return isElement(value) && (value as HTMLElement).namespaceURI === "http://www.w3.org/1999/xhtml";
}

/** Run `handler` once, when the pointer is let go (or cancelled), wherever it is: in any of the editor's windows. */
export function whenPointerReleased(handler: () => void): void {
  const stops: Array<() => void> = [];
  const release = () => {
    for (const stop of stops) stop();
    handler();
  };
  stops.push(addWindowListener("pointerup", release, true), addWindowListener("pointercancel", release, true));
}
