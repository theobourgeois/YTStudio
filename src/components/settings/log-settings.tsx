import { useState } from "react";
import { PiFolderOpen } from "react-icons/pi";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { errorMessage } from "@shared/errors";
import { FILE_MANAGER } from "@/lib/key-labels";
import { SettingsGroup, SettingsRow } from "./settings-ui";

/** Where the app's log is (server/log.ts), to look in or send along when something went wrong. */
export function LogSettings() {
  const [error, setError] = useState<string | null>(null);
  const reveal = () => {
    setError(null);
    api.revealLog().catch((err: unknown) => setError(errorMessage(err)));
  };
  return (
    <SettingsGroup title="Logs" description="What the app did and what went wrong, kept on this computer. Send them along when you report a problem.">
      <SettingsRow title="Log files" description={error ?? "The latest few megabytes; older lines are let go of."}>
        <Button variant="outline" size="sm" onClick={reveal}>
          <PiFolderOpen />
          Show in {FILE_MANAGER}
        </Button>
      </SettingsRow>
    </SettingsGroup>
  );
}
