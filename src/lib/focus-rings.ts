/**
 * Whether the keyboard is moving the focus, for focus rings (the `focus-visible` variant in `index.css`): Tab
 * turns them on (`html[data-keyboard-nav]`), any press of the pointer turns them off again. A clicked control
 * then never shows a ring, even when a key (Space to play) is pressed after it, while Tabbing through still does.
 */
export function trackKeyboardNavigation() {
  const root = document.documentElement;
  window.addEventListener("keydown", (e) => e.key === "Tab" && root.setAttribute("data-keyboard-nav", ""), true);
  window.addEventListener("pointerdown", () => root.removeAttribute("data-keyboard-nav"), true);
}
