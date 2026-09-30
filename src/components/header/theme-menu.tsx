import type { IconType } from "react-icons";
import { PiDesktop, PiMoon, PiSun } from "react-icons/pi";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { THEMES, useTheme, type Appearance, type ThemeId } from "@/stores/theme";

const APPEARANCES: { value: Appearance; label: string; icon: IconType }[] = [
  { value: "light", label: "Light", icon: PiSun },
  { value: "dark", label: "Dark", icon: PiMoon },
  { value: "system", label: "System", icon: PiDesktop },
];

export function ThemeMenu() {
  const theme = useTheme((s) => s.theme);
  const appearance = useTheme((s) => s.appearance);
  const setTheme = useTheme((s) => s.setTheme);
  const setAppearance = useTheme((s) => s.setAppearance);
  const Icon = APPEARANCES.find((t) => t.value === appearance)?.icon ?? PiMoon;

  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" className="text-muted-foreground hover:text-foreground">
              <Icon />
              <span className="sr-only">Theme</span>
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom">Theme</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end" className="w-36">
        <DropdownMenuLabel>Theme</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={theme} onValueChange={(v) => setTheme(v as ThemeId)}>
          {THEMES.map(({ id, name }) => (
            <DropdownMenuRadioItem key={id} value={id}>
              {name}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup value={appearance} onValueChange={(v) => setAppearance(v as Appearance)}>
          {APPEARANCES.map(({ value, label, icon: ItemIcon }) => (
            <DropdownMenuRadioItem key={value} value={value}>
              <ItemIcon />
              {label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
