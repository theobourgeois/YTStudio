import { useSyncExternalStore } from "react";
import { PiCornersIn, PiCornersOut, PiMinus, PiX } from "react-icons/pi";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { type WindowAction, ownWindowButtons, windowAction } from "@/lib/desktop";
import { useWindowChrome } from "@/stores/window-chrome";

/** Whether the page draws the window's buttons: a Mac's desktop app without the tab strip (Settings › General). */
export function useOwnWindowButtons(): boolean {
  return ownWindowButtons(useWindowChrome((s) => s.tabsHidden));
}

/** The desktop app marks <html> `fullscreen` (electron/main.ts) as the window enters and leaves full screen. */
function subscribeFullScreen(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  return () => observer.disconnect();
}
const isFullScreen = () => document.documentElement.classList.contains("fullscreen");

/**
 * The window's minimise, full screen and close, at the right end of the bar that starts the window, in place of a
 * Mac's red, yellow and green ones (hidden while the tab strip is: `useWindowChrome`). Windows draws its own there
 * already: this keeps them room where the bar isn't a title bar that does (the music toolbar; src/index.css). A
 * browser tab has its browser's.
 */
export function WindowButtons({ className }: { className?: string }) {
  const own = useOwnWindowButtons();
  const tabsHidden = useWindowChrome((s) => s.tabsHidden);
  const fullScreen = useSyncExternalStore(subscribeFullScreen, isFullScreen);
  // (The Electron app's: the music app's window has a title bar of its own, with them in it.)
  if (tabsHidden && window.editorDesktopInfo?.platform === "win32" && window.editorDesktopInfo.titleBar) return <div aria-hidden data-window-controls-space />;
  if (!own) return null;
  return (
    <div className={cn("flex shrink-0 items-center gap-0.5", className)} data-window-buttons>
      {/* A window in full screen can't be minimised (the system's yellow button goes too). */}
      {!fullScreen && <WindowButton action="minimize" label="Minimise" icon={<PiMinus />} />}
      <WindowButton action="fullscreen" label={fullScreen ? "Exit full screen" : "Full screen"} icon={fullScreen ? <PiCornersIn /> : <PiCornersOut />} />
      <WindowButton action="close" label="Close window" icon={<PiX />} className="hover:bg-destructive-solid hover:text-white" />
    </div>
  );
}

function WindowButton({ action, label, icon, className }: { action: WindowAction; label: string; icon: React.ReactNode; className?: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={label}
          className={cn("text-muted-foreground hover:text-foreground", className)}
          onClick={() => windowAction(action)}
        >
          {icon}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  );
}
