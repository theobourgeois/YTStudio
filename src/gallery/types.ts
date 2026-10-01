import type { ReactNode } from "react";

/**
 * A part of the component gallery (`/gallery`): a few controls shown in every state worth looking at.
 * `scripts/ui-sheet.ts` screenshots each one in every theme; `shots` are the extra pictures it takes
 * after doing something on the page (opening a menu or a dialog), each named `<section>-<name>`.
 */
export interface GallerySection {
  id: string;
  title: string;
  /** Where it's from, as a hint for whoever changes it (`components/ui/button.tsx`). */
  source: string;
  render: () => ReactNode;
  shots?: GalleryShot[];
}

/** An extra screenshot: press a button (by its accessible name), or right-click an element, then shoot. */
export interface GalleryShot {
  name: string;
  click?: string;
  rightClick?: string;
  /** Shoot the whole window (dialogs, toasts) rather than the section. */
  page?: boolean;
}
