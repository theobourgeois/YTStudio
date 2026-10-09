import { useMemo } from "react";
import { useTheme } from "@/stores/theme";
import { readPalette } from "../piano/draw";
import type { ClipLook } from "./draw";

/**
 * The theme's clip look (`clipColours`) for clips drawn outside the Playlist's canvas (the Picker, the
 * overview, an automation clip's window, a song's Home card), read again whenever the theme changes.
 */
export function useClipLook(): ClipLook {
  const theme = useTheme((s) => s.theme);
  // The theme's classes on <html> are what's read: `theme` only says when to read them again.
  return useMemo(() => readPalette(document.documentElement), [theme]);
}
