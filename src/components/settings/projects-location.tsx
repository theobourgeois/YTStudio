import { useState } from "react";
import { PiFolderOpen } from "react-icons/pi";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { chooseFolder } from "@/lib/desktop";
import { FILE_MANAGER } from "@/lib/key-labels";
import { useProjects } from "@/stores/projects";
import { SUITES } from "@shared/suites";
import { appSuites } from "@/lib/app";
import { SettingsGroup, SettingsRow } from "./settings-ui";

/** Where new projects are saved (each a file of its own, `Name.ytvid`, `.ytsng`, `.ytimg`): the desktop app's folder picker, else a path. */
export function ProjectsLocation() {
  const location = useProjects((s) => s.location);
  const [editing, setEditing] = useState<string | null>(null);
  if (!location) return null;
  const isDefault = location.path === location.default;

  const change = async () => {
    const picking = chooseFolder(location.path);
    if (!picking) return setEditing(location.path);
    const folder = await picking;
    if (folder) await useProjects.getState().setLocation(folder);
  };
  const save = async () => {
    if (editing === null) return;
    if (!editing.trim() || editing.trim() === location.path || (await useProjects.getState().setLocation(editing.trim()))) setEditing(null);
  };

  return (
    <SettingsGroup title="Projects" description={`Each project is a file of its own (${packageKinds()}): move, copy or back it up in ${FILE_MANAGER} like any other.`}>
      <SettingsRow title="Save new projects in" description={isDefault ? "Where they go unless you pick another folder." : `By default, ${location.default}.`}>
        {editing === null ? (
          <div className="flex min-w-0 items-center gap-2">
            <span className="sunken max-w-72 truncate rounded-sm px-2 py-1 font-mono text-[11px]" title={location.path}>
              {location.path}
            </span>
            <Button variant="outline" size="sm" onClick={() => void change()}>
              <PiFolderOpen />
              Change…
            </Button>
            {!isDefault && (
              <Button variant="ghost" size="sm" onClick={() => void useProjects.getState().setLocation(location.default)}>
                Reset
              </Button>
            )}
          </div>
        ) : (
          <form
            className="flex items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            <Input autoFocus value={editing} onChange={(e) => setEditing(e.target.value)} aria-label="Folder for new projects" className="h-7 w-72 font-mono text-[11px]" />
            <Button type="submit" size="sm">
              Save
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(null)}>
              Cancel
            </Button>
          </form>
        )}
      </SettingsRow>
    </SettingsGroup>
  );
}

/** "a .ytvid package", or "a .ytvid, .ytsng or .ytimg package" where the app opens several suites. */
function packageKinds() {
  const exts = appSuites().map((s) => SUITES[s].extension);
  return `a ${exts.length > 1 ? `${exts.slice(0, -1).join(", ")} or ${exts.at(-1)}` : exts[0]} package`;
}
