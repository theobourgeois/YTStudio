import { useEffect, useRef, useState } from "react";
import { PiFolderOpen, PiPlus, PiWarning } from "react-icons/pi";
import { errorMessage } from "@shared/errors";
import type { SerumLibraryFolder, SerumLibraryFolders } from "@shared/music/serum-presets";
import { SettingsGroup, SettingsRow } from "@/components/settings/settings-ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { chooseFolder } from "@/lib/desktop";
import { IS_MAC } from "@/lib/key-labels";
import { musicApi } from "../api";
import { useMusicPreferences } from "../preferences";
import { useSerumUi } from "./store";

const SOURCE_TITLES: Record<SerumLibraryFolder["source"], string> = {
  serum2: "Serum 2's presets",
  serum1: "Serum 1's presets",
  added: "Added",
};

/** Whether Serum 2 channels open in the player or in Serum's own window. Turned off, the open players close. */
function SerumPlayerRow() {
  const on = useMusicPreferences((s) => s.serumPlayer);
  const set = (next: boolean) => {
    useMusicPreferences.getState().setSerumPlayer(next);
    if (!next) for (const id of useSerumUi.getState().openIds) useSerumUi.getState().close(id);
  };
  return (
    <SettingsRow title="Open Serum 2 in the player" description="A Serum 2 channel opens in YTStudio's Serum player. Off, it opens Serum's own window, as any other plugin does.">
      <Switch checked={on} onCheckedChange={set} aria-label="Open Serum 2 in the player" />
    </SettingsRow>
  );
}

const presetCount = (n: number) => `${n} preset${n === 1 ? "" : "s"}`;

/**
 * The Serum player's library (`docs/serum/player.md` §3.2): Serum's own preset folders, and folders added to list with
 * them (Serum 1's library in iCloud Drive, which Serum 2 doesn't see; a pack kept elsewhere). Folders of Serum presets
 * found on this computer and not listed yet are offered with a click.
 */
export function SerumLibrarySettings() {
  const [folders, setFolders] = useState<SerumLibraryFolders | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [typing, setTyping] = useState<string | null>(null);
  const group = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let live = true;
    musicApi.serumFolders().then(
      (f) => live && setFolders(f),
      (err) => live && setError(errorMessage(err)),
    );
    return () => {
      live = false;
    };
  }, []);

  const change = async (run: () => Promise<SerumLibraryFolders>): Promise<boolean> => {
    setError(null);
    try {
      setFolders(await run());
      // The button pressed went with its row: the focus stays in Settings (its keys, Escape, are its own).
      group.current?.focus({ preventScroll: true });
      // An open player lists them at once.
      if (useSerumUi.getState().presets) void useSerumUi.getState().loadLibrary();
      return true;
    } catch (err) {
      setError(errorMessage(err));
      return false;
    }
  };
  const add = (path: string) => change(() => musicApi.addSerumFolder(path));
  const pick = async () => {
    const picking = chooseFolder();
    if (!picking) return setTyping("");
    const folder = await picking;
    if (folder) await add(folder);
  };

  return (
    <div ref={group} tabIndex={-1} className="outline-none">
      <SettingsGroup title="Serum player" description="Where a Serum 2 channel's player finds presets: Serum's own folders, and any you add. Each preset is listed once, wherever it is.">
        <SerumPlayerRow />
        {!folders && <SettingsRow title="Folders" description={error ? <span className="text-destructive">{error}</span> : "Reading Serum's folders…"} />}
        {folders?.folders.map((folder) => (
          <SettingsRow
            key={folder.path}
            title={SOURCE_TITLES[folder.source]}
            description={
              <span className="flex min-w-0 items-center gap-1.5" data-testid="serum-library-folder">
                {folder.missing && <PiWarning className="size-3 shrink-0 text-destructive" />}
                <span className="truncate font-mono text-[11px]" title={folder.path}>
                  {folder.path}
                </span>
                <span className="shrink-0">· {folder.missing ? "not there now" : presetCount(folder.presets)}</span>
              </span>
            }
          >
            {folder.source === "added" ? (
              <Button variant="ghost" size="sm" onClick={() => void change(() => musicApi.removeSerumFolder(folder.path))}>
                Remove
              </Button>
            ) : (
              <span className="text-[11px] text-muted-foreground">Serum's</span>
            )}
          </SettingsRow>
        ))}
        {folders && !folders.folders.length && <SettingsRow title="No folders" description="Serum 2's preset folder isn't on this computer. Add a folder of presets to list them." />}
        {folders?.suggested.map((suggestion) => (
          <SettingsRow
            key={suggestion.path}
            title={suggestion.label}
            description={
              <span className="block truncate font-mono text-[11px]" title={suggestion.path}>
                Found at {suggestion.path}. Serum 2 doesn't look there.
              </span>
            }
          >
            <Button variant="outline" size="sm" onClick={() => void add(suggestion.path)}>
              <PiPlus />
              Add
            </Button>
          </SettingsRow>
        ))}
        {folders && (
          <SettingsRow title="Add a folder" description={error ? <span className="text-destructive">{error}</span> : "Presets in it and its folders (.SerumPreset and Serum 1's .fxp) are listed with Serum's."}>
            {typing === null ? (
              <Button variant="outline" size="sm" onClick={() => void pick()}>
                <PiFolderOpen />
                Add a folder…
              </Button>
            ) : (
              <form
                className="flex items-center gap-2"
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (typing.trim() && (await add(typing.trim()))) setTyping(null);
                }}
              >
                <Input
                  autoFocus
                  value={typing}
                  onChange={(e) => setTyping(e.target.value)}
                  placeholder={IS_MAC ? "~/Music/Serum Presets" : "C:\\Users\\you\\Music\\Serum Presets"}
                  aria-label="Folder of Serum presets"
                  className="h-7 w-64 font-mono text-[11px]"
                />
                <Button type="submit" size="sm" disabled={!typing.trim()}>
                  Add
                </Button>
                <Button type="button" variant="ghost" size="sm" onClick={() => setTyping(null)}>
                  Cancel
                </Button>
              </form>
            )}
          </SettingsRow>
        )}
      </SettingsGroup>
    </div>
  );
}
