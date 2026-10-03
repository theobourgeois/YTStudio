/**
 * A control's Modulate ▸ (every automatable control's right-click menu, beside Create automation clip:
 * `docs/sidechain.md`): follow a track's level or a channel's notes (a duck, −60%, by default), link it to a
 * modulator the song has, or, modulated, edit or remove its modulation.
 */
import { PiCheck } from "react-icons/pi";
import { targetKey } from "@shared/music/automation";
import { amountText, canModulate, modulationIndex, modulatorName } from "@shared/music/modulation";
import type { AutomationTarget, MusicProject } from "@shared/music/types";
import { ContextMenuItem, ContextMenuLabel, ContextMenuSeparator, ContextMenuSub, ContextMenuSubContent, ContextMenuSubTrigger } from "@/components/ui/context-menu";
import { useMusic } from "../store";
import { linkTo, modulateWith, unlink } from "./actions";
import { useModulationUi } from "./store";

const EMPTY: MusicProject["modulators"] = [];

export function ModulationMenuItems({ target }: { target: AutomationTarget }) {
  const key = targetKey(target);
  const entry = useMusic((s) => (s.history ? (modulationIndex(s.history.doc).get(key) ?? null) : null));
  const tracks = useMusic((s) => s.history?.doc.mixer.tracks);
  const channels = useMusic((s) => s.history?.doc.channels);
  const modulators = useMusic((s) => s.history?.doc.modulators ?? EMPTY);
  if (!canModulate(target) || !tracks || !channels) return null;
  const song = { mixer: { tracks, groups: [] }, channels };
  return (
    <ContextMenuSub>
      <ContextMenuSubTrigger data-testid="modulate">{entry ? `Modulated by ${modulatorName(song, entry.modulator)}` : "Modulate"}</ContextMenuSubTrigger>
      <ContextMenuSubContent className="min-w-52">
        {entry && (
          <>
            <ContextMenuItem onSelect={() => useModulationUi.getState().show(entry.modulator.id)}>
              Edit {modulatorName(song, entry.modulator)} ({amountText(entry.link.amount)})…
            </ContextMenuItem>
            <ContextMenuItem onSelect={() => unlink(target)} data-testid="remove-modulation">
              Remove modulation
            </ContextMenuItem>
            <ContextMenuSeparator />
          </>
        )}
        <ContextMenuSub>
          <ContextMenuSubTrigger data-testid="follow-track">Follow track</ContextMenuSubTrigger>
          <ContextMenuSubContent className="max-h-[70vh] min-w-48 overflow-y-auto">
            <ContextMenuLabel className="text-[11px]">Its level, after its effects</ContextMenuLabel>
            {tracks.map((track, number) => (
              <ContextMenuItem key={track.id} onSelect={() => modulateWith(target, { kind: "track", track: track.id, tap: "postFx" })} data-testid={`follow-track-${number}`}>
                <span className="w-6 shrink-0 text-muted-foreground tabular-nums">{number || "M"}</span>
                {track.color && <span className="mr-1 size-2 shrink-0 rounded-full" style={{ background: track.color }} aria-hidden />}
                <span className="truncate">{track.name ?? (number === 0 ? "Master" : `Insert ${number}`)}</span>
              </ContextMenuItem>
            ))}
          </ContextMenuSubContent>
        </ContextMenuSub>
        <ContextMenuSub>
          <ContextMenuSubTrigger data-testid="follow-notes">Follow notes of</ContextMenuSubTrigger>
          <ContextMenuSubContent className="max-h-[70vh] min-w-48 overflow-y-auto">
            <ContextMenuLabel className="text-[11px]">A channel's notes (muted, it still drives)</ContextMenuLabel>
            {channels.map((channel) => (
              <ContextMenuItem key={channel.id} onSelect={() => modulateWith(target, { kind: "notes", channel: channel.id })} data-testid={`follow-notes-${channel.id}`}>
                {channel.color && <span className="mr-1 size-2 shrink-0 rounded-full" style={{ background: channel.color }} aria-hidden />}
                <span className="truncate">{channel.name}</span>
              </ContextMenuItem>
            ))}
          </ContextMenuSubContent>
        </ContextMenuSub>
        {modulators.length > 0 && (
          <ContextMenuSub>
            <ContextMenuSubTrigger>Link to</ContextMenuSubTrigger>
            <ContextMenuSubContent className="min-w-48">
              {modulators.map((m) => (
                <ContextMenuItem key={m.id} onSelect={() => linkTo(m.id, target)}>
                  <span className="w-4 shrink-0">{entry?.modulator.id === m.id && <PiCheck className="size-3" />}</span>
                  {modulatorName(song, m)}
                </ContextMenuItem>
              ))}
            </ContextMenuSubContent>
          </ContextMenuSub>
        )}
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={() => useModulationUi.getState().show()}>Modulators…</ContextMenuItem>
      </ContextMenuSubContent>
    </ContextMenuSub>
  );
}
