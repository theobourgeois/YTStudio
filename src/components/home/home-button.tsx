import { PiHouse } from "react-icons/pi";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useProjects } from "@/stores/projects";
import { HOME_KEYS } from "./project-search-dialog";
import { useTabsShown } from "./project-tabs";

/**
 * Back to the Home screen, from any suite. One button for the whole window, pinned to its top-left corner
 * (beside a Mac's window buttons in the desktop app, `.home-button` in index.css), over whichever suite's
 * header is below it; headers leave it room. The tab strip, when it shows, has a Home button of its own.
 */
export function HomeButton() {
  const open = useProjects((s) => s.openId !== null);
  const tabs = useTabsShown();
  if (!open || tabs) return null;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Home"
          className="home-button fixed top-3 z-40 text-muted-foreground hover:text-foreground [&_svg:not([class*='size-'])]:size-4.5"
          onClick={() => void useProjects.getState().goHome()}
        >
          <PiHouse />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        Home: all your projects
        <kbd className="ml-2 rounded border bg-muted px-1 font-sans text-[10px] leading-4 text-muted-foreground">{HOME_KEYS}</kbd>
      </TooltipContent>
    </Tooltip>
  );
}
