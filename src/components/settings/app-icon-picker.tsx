import { PiCheckBold } from "react-icons/pi";
import { cn } from "cn";
import { appIconUrl, appIcons } from "@shared/app-icons";
import { currentApp } from "@/lib/app";
import { useAppIcon } from "@/stores/app-icon";
import { SettingsBlock, SettingsGroup } from "./settings-ui";

export function AppIconPicker() {
  const { choice, busy, error, setIcon } = useAppIcon();
  const app = currentApp().id;
  return (
    <SettingsGroup title="App icon" description="Choose a look for the Dock and browser tab.">
      <SettingsBlock>
        <fieldset aria-busy={busy} className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-3">
          <legend className="sr-only">App icon</legend>
          {appIcons(app).map((icon) => (
            <label key={icon.id} className="relative cursor-pointer">
              <input
                type="radio"
                name="app-icon"
                value={icon.id}
                checked={choice === icon.id}
                aria-disabled={busy}
                onClick={(event) => { if (busy) event.preventDefault(); }}
                onChange={() => void setIcon(icon.id)}
                className="peer sr-only"
              />
              <span className={cn(
                "flex h-full flex-col items-center rounded-md p-2 text-center peer-focus-visible:ring-2 peer-focus-visible:ring-ring/60",
                choice === icon.id ? "bg-brand/12 ring-2 ring-brand" : "hover:bg-accent/60",
                busy && "cursor-wait",
              )}>
                <img src={appIconUrl(icon.id, app)} alt="" className="size-24" />
                <span className="text-[13px] font-medium">{icon.name}</span>
                <span className="mt-0.5 text-xs text-muted-foreground">{icon.description}</span>
                {choice === icon.id && <PiCheckBold aria-hidden className="absolute top-2 right-2 size-3.5 text-brand" />}
              </span>
            </label>
          ))}
        </fieldset>
        {error && <p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}
      </SettingsBlock>
    </SettingsGroup>
  );
}
