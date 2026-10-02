import { useEffect, useRef, useState } from "react";
import { controlAt, controlOf, isAutomated, automationsOf, targetKey } from "@shared/music/automation";
import type { AutomationTarget } from "@shared/music/types";
import { ContextMenuItem, ContextMenuSeparator } from "@/components/ui/context-menu";
import { positionNow } from "../playhead";
import { useMusic } from "../store";
import { useTransport } from "../transport";
import { createAutomationClip, openAutomationWindow } from "./actions";
import { useAutomationUi } from "./store";

/**
 * A control that can be automated (a knob, a fader), as it shows (`docs/fl-studio/automation.md`): in song
 * mode, an automated one follows its curve where the song is (playing or not), unless the hand holds it;
 * elsewhere, and in pattern mode, it's its own value. `hold` and `release` go round a drag, so the engine
 * leaves its automation out while it's held. A control that turns by its automation's fraction (`scale`
 * "fraction": a tapered knob, as OTT's Time or EchoBoy's cuts) is followed in that rather than its own units.
 */
export function useAutomatedControl(target: AutomationTarget | undefined, own: number, scale: "control" | "fraction" = "control") {
  const key = target ? targetKey(target) : null;
  const targetRef = useRef(target);
  targetRef.current = target;
  const automated = useMusic((s) => !!target && !!s.history && isAutomated(s.history.doc, target));
  const songMode = useTransport((s) => s.mode === "song");
  const held = useAutomationUi((s) => !!key && s.held.has(key));
  const following = automated && songMode && !held;
  const [shown, setShown] = useState<number | null>(null);

  useEffect(() => {
    if (!following) return setShown(null);
    let frame = 0;
    let last: number | null = null;
    const update = () => {
      const song = useMusic.getState().history?.doc;
      const control = targetRef.current;
      if (song && control) {
        const at = positionNow() ?? useTransport.getState().songStartTick;
        const fraction = controlAt(song, control, at);
        const value = fraction === null ? null : scale === "fraction" ? fraction : controlOf(song, control).toControl(fraction);
        if (value !== last) setShown((last = value));
      }
      frame = requestAnimationFrame(update);
    };
    update();
    return () => cancelAnimationFrame(frame);
  }, [following, key, scale]);

  return {
    value: following && shown !== null ? shown : own,
    automated,
    hold: () => {
      if (!key || !targetRef.current) return;
      useAutomationUi.getState().hold(key);
      useAutomationUi.getState().touch(targetRef.current);
    },
    release: () => key && useAutomationUi.getState().release(key),
  };
}

/** A control's menu items for automation: Create automation clip (FL's), and the clips already driving it. */
export function AutomationMenuItems({ target }: { target: AutomationTarget }) {
  // The list itself (the same until it changes), filtered here: a selector making a new list would render for ever.
  const automations = useMusic((s) => s.history?.doc.automations);
  const existing = automations ? automationsOf({ automations } as Parameters<typeof automationsOf>[0], target) : [];
  return (
    <>
      <ContextMenuSeparator />
      <ContextMenuItem onSelect={() => createAutomationClip(target)}>Create automation clip</ContextMenuItem>
      {existing.slice(0, 4).map((a) => (
        <ContextMenuItem key={a.id} onSelect={() => openAutomationWindow(a.id)}>
          Edit {a.name}…
        </ContextMenuItem>
      ))}
    </>
  );
}
