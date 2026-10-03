import { createContext, useContext } from "react";

/**
 * Where a tooltip or a dialog opened from a control is drawn. The page's own document by default; inside a
 * native panel (`components/windows/native/`) it's that panel's, since it has to be in the window the control
 * is in. Radix's portals take it as their `container` (`undefined` is the document body).
 */
const PortalContainerContext = createContext<HTMLElement | undefined>(undefined);
/**
 * Where a menu, a select or a popover is drawn. In a native panel that's the window the panels share for
 * what pops up (`native/popups.ts`), which isn't limited to the panel's size; elsewhere it's the same as above.
 */
const PopupContainerContext = createContext<HTMLElement | undefined>(undefined);

export const PortalContainerProvider = PortalContainerContext.Provider;
export const PopupContainerProvider = PopupContainerContext.Provider;

export function usePortalContainer(): HTMLElement | undefined {
  return useContext(PortalContainerContext);
}

export function usePopupContainer(): HTMLElement | undefined {
  const popups = useContext(PopupContainerContext);
  const portal = useContext(PortalContainerContext);
  return popups ?? portal;
}

/** Whether menus are drawn in the shared popup window (a native panel's), so they may extend past the panel. */
export function useInPopupWindow(): boolean {
  return useContext(PopupContainerContext) !== undefined;
}
