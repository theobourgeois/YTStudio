import { PiGearSix } from "react-icons/pi";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { projectSuite, useProjects } from "@/stores/projects";
import { useSettings } from "@/stores/settings";
import { SETTINGS_KEYS } from "./settings-page";

/** Opens Settings on the open project's suite (General when none is), as ⌘, does. In every suite's header. */
export function SettingsButton() {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          className="text-muted-foreground hover:text-foreground"
          aria-label="Settings"
          onClick={() => useSettings.getState().show(projectSuite(useProjects.getState().openId) ?? "general")}
        >
          <PiGearSix />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        Settings
        <kbd className="ml-2 rounded border bg-muted px-1 font-sans text-[10px] leading-4 text-muted-foreground">{SETTINGS_KEYS}</kbd>
      </TooltipContent>
    </Tooltip>
  );
}
