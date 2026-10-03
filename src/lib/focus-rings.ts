import { addWindowListener } from "./window-events";

/**
 * Whether the keyboard is moving the focus, for focus rings (the `focus-visible` variant in `index.css`): Tab
 * turns them on (`html[data-keyboard-nav]`), any press of the pointer turns them off again. A clicked control
 * then never shows a ring, even when a key (Space to play) is pressed after it, while Tabbing through still does.
 */
export function trackKeyboardNavigation() {
  const root = document.documentElement;
  // (A native window's <html> wears the page's attributes, so one flag serves them all: `components/windows/native/styles.ts`.)
  addWindowListener("keydown", (e) => e.key === "Tab" && root.setAttribute("data-keyboard-nav", ""), true);
  addWindowListener("pointerdown", () => root.removeAttribute("data-keyboard-nav"), true);
}
