import { PiChartLine } from "react-icons/pi";
import { controlOf } from "@shared/music/automation";
import type { AutomationTarget } from "@shared/music/types";
import { useMusic } from "../store";
import { createAutomationClip } from "./actions";
import { useAutomationUi } from "./store";

/** The effect a control belongs to, if it's one of a mixer effect's (its slot's mix, or one of ours' controls). */
export const effectOfTarget = (target: AutomationTarget): string | null => ("effect" in target ? target.effect : target.kind === "plugin" && target.owner === "effect" ? target.id : null);

/**
 * **Automate "…"** in a built-in effect's title bar (Gross Beat, EchoBoy, Auto-Tune, Pro-Q, OTT), as a
 * plugin's window has it (`docs/fl-studio/automation.md`): once one of its controls has been touched, a
 * click makes an automation clip of it.
 */
export function AutomateTouched({ effectId }: { effectId: string }) {
  const target = useAutomationUi((s) => (s.touchedControl && effectOfTarget(s.touchedControl) === effectId ? s.touchedControl : null));
  const name = useMusic((s) => (target && s.history ? controlOf(s.history.doc, target).name : null));
  if (!target || !name) return null;
  return (
    <button
      type="button"
      className="flex h-5 max-w-48 items-center gap-1 rounded-sm px-1.5 text-[11px] raised text-muted-foreground hover:raised-hover hover:text-foreground"
      title={`Make an automation clip of ${name} (the control last touched here)`}
      data-testid="automate-touched"
      onPointerDown={(e) => e.stopPropagation()}
      onClick={() => createAutomationClip(target)}
    >
      <PiChartLine className="size-3 shrink-0" />
      <span className="truncate">Automate “{name}”</span>
    </button>
  );
}
