import { createContext, useContext } from "react";

/**
 * Where a menu, a tooltip or a popover opened from a control is drawn. The page's own document by default;
 * inside a native panel (`components/windows/native/`) it's that panel's, since the menu has to be in the
 * window the control is in. Radix's portals take it as their `container` (`undefined` is the document body).
 */
const PortalContainerContext = createContext<HTMLElement | undefined>(undefined);

export const PortalContainerProvider = PortalContainerContext.Provider;

export function usePortalContainer(): HTMLElement | undefined {
  return useContext(PortalContainerContext);
}
