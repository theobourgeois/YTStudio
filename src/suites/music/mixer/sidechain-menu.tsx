/**
 * Choosing an effect's key (`docs/sidechain.md`): the tracks it can hear, by number and name (a track whose
 * sound already reaches this one is greyed: a loop), where its sound is taken, and No key. The same items
 * in an effect slot's menus (its arrow's and its right-click's) and in Pro-C's External source.
 */
import { useMemo } from "react";
import { PiCheck } from "react-icons/pi";
import { createId } from "@shared/ids";
import { duckWithProC } from "@shared/music/pro-c";
import { DEFAULT_TAP, SIDECHAIN_TAP_NAMES, canKey, keyChoices, setSidechain, setSidechainTap, takesKey } from "@shared/music/sidechain";
import { SIDECHAIN_TAPS, type Sidechain } from "@shared/music/types";
import {
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuRadioGroup,
  ContextMenuRadioItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
} from "@/components/ui/context-menu";
import {
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@/components/ui/dropdown-menu";
import { openProC } from "../pro-c/actions";
import { useMusic, useSong } from "../store";
import { useTransport } from "../transport";

/** The parts a menu is made of: a dropdown's or a context menu's. */
export const DROPDOWN_PARTS = {
  Item: DropdownMenuItem,
  Label: DropdownMenuLabel,
  Separator: DropdownMenuSeparator,
  RadioGroup: DropdownMenuRadioGroup,
  RadioItem: DropdownMenuRadioItem,
  Sub: DropdownMenuSub,
  SubTrigger: DropdownMenuSubTrigger,
  SubContent: DropdownMenuSubContent,
};
export const CONTEXT_PARTS = {
  Item: ContextMenuItem,
  Label: ContextMenuLabel,
  Separator: ContextMenuSeparator,
  RadioGroup: ContextMenuRadioGroup,
  RadioItem: ContextMenuRadioItem,
  Sub: ContextMenuSub,
  SubTrigger: ContextMenuSubTrigger,
  SubContent: ContextMenuSubContent,
};
export type MenuParts = typeof DROPDOWN_PARTS | typeof CONTEXT_PARTS;

/** "2 Kick (after its effects)": what an effect's key is, said briefly. */
export function keyText(song: { mixer: { tracks: { id: string; name: string | null }[] } }, key: Sidechain | undefined): string | null {
  if (!key) return null;
  const number = song.mixer.tracks.findIndex((t) => t.id === key.track);
  if (number < 0) return null;
  const name = song.mixer.tracks[number].name ?? `Insert ${number}`;
  return `${number === 0 ? "" : `${number} `}${name === `Insert ${number}` ? "" : name}`.trim() + ` (${SIDECHAIN_TAP_NAMES[key.tap].toLowerCase()})`;
}

/** The menu items choosing an effect's key: its sources, its tap, No key. `onPick` follows a source chosen. */
export function SidechainMenuItems({ menu, effectId, onPick }: { menu: MenuParts; effectId: string; onPick?: (source: string | null) => void }) {
  const { Item, Label, Separator, RadioGroup, RadioItem } = menu;
  const mixer = useSong((s) => s.mixer);
  const choices = useMemo(() => keyChoices({ mixer }, effectId), [mixer, effectId]);
  const key = useMemo(() => mixer.tracks.flatMap((t) => t.effects).find((e) => e?.id === effectId)?.sidechain, [mixer, effectId]);
  const commit = useMusic.getState().commit;
  const pick = (source: string | null) => {
    commit((s) => setSidechain(s, effectId, source));
    onPick?.(source);
  };
  return (
    <>
      <Label className="text-[11px]">Key from</Label>
      {choices.length === 0 && <Item disabled>No other tracks</Item>}
      {choices.map((c) => (
        <Item key={c.id} disabled={!c.possible} title={c.possible ? undefined : "Its sound already reaches this track: keying from it would make a loop"} onSelect={() => pick(c.id)} data-testid={`key-source-${c.number}`}>
          <span className="w-4 shrink-0">{key?.track === c.id && <PiCheck className="size-3" />}</span>
          <span className="w-6 shrink-0 text-muted-foreground tabular-nums">{c.number}</span>
          {c.color && <span className="size-2 shrink-0 rounded-full" style={{ background: c.color }} aria-hidden />}
          <span className="truncate">{c.name}</span>
        </Item>
      ))}
      <Separator />
      <Label className="text-[11px]">Taken</Label>
      <RadioGroup value={key?.tap ?? DEFAULT_TAP} onValueChange={(tap) => commit((s) => setSidechainTap(s, effectId, tap as Sidechain["tap"]))}>
        {SIDECHAIN_TAPS.map((tap) => (
          <RadioItem key={tap} value={tap} disabled={!key}>
            {SIDECHAIN_TAP_NAMES[tap]}
          </RadioItem>
        ))}
      </RadioGroup>
      {key && (
        <>
          <Separator />
          <Item onSelect={() => pick(null)}>No key</Item>
        </>
      )}
    </>
  );
}

/**
 * A track's *Sidechain to ▸* (its strip's menu, `docs/sidechain.md` "From the kick"): every other track,
 * each with the effects there that can hear a key (a check on those this track keys already) and *Duck with
 * a new Pro-C*, the quickest duck. A track whose sound already reaches this one is greyed (a loop).
 */
export function SidechainToItems({ menu, source }: { menu: MenuParts; source: string }) {
  const { Item, Separator, Sub, SubTrigger, SubContent, Label } = menu;
  const tracks = useSong((s) => s.mixer.tracks);
  const loaded = useTransport((s) => s.effects.loaded);
  const targets = useMemo(() => {
    const song = { mixer: { tracks, groups: [] } };
    return tracks.flatMap((track, number) =>
      track.id === source
        ? []
        : [
            {
              track,
              number,
              name: track.name ?? (number === 0 ? "Master" : `Insert ${number}`),
              possible: canKey(song, source, track.id),
              effects: track.effects.flatMap((effect) => {
                if (!effect || !takesKey(effect, loaded.find((l) => l.effect === effect.id)?.sidechain)) return [];
                return [{ effect, keyed: effect.sidechain?.track === source, possible: canKey(song, source, track.id, effect.id) }];
              }),
            },
          ],
    );
  }, [tracks, loaded, source]);
  return (
    <>
      <Label className="text-[11px]">This track's sound is the key of…</Label>
      {targets.map(({ track, number, name, possible, effects }) => (
        <Sub key={track.id}>
          <SubTrigger disabled={!possible && !effects.some((e) => e.keyed)} data-testid={`sidechain-to-${number}`}>
            <span className="w-6 shrink-0 text-muted-foreground tabular-nums">{number || "M"}</span>
            {track.color && <span className="mr-1 size-2 shrink-0 rounded-full" style={{ background: track.color }} aria-hidden />}
            <span className="truncate">{name}</span>
          </SubTrigger>
          <SubContent className="min-w-52">
            {effects.length > 0 && <Label className="text-[11px]">Its effects that hear a key</Label>}
            {effects.map(({ effect, keyed, possible: can }) => (
              <Item key={effect.id} disabled={!can && !keyed} onSelect={() => keyEffectFrom(source, effect.id, keyed)}>
                <span className="w-4 shrink-0">{keyed && <PiCheck className="size-3" />}</span>
                {effect.plugin.name}
              </Item>
            ))}
            {effects.length > 0 && <Separator />}
            <Item disabled={!possible || track.effects.every(Boolean)} onSelect={() => duckFrom(source, track.id)} data-testid="duck-with-pro-c">
              Duck with a new YT-C
            </Item>
          </SubContent>
        </Sub>
      ))}
    </>
  );
}

/** Key an effect from a track (or, keyed already, take the key off). */
function keyEffectFrom(source: string, effectId: string, keyed: boolean) {
  useMusic.getState().commit((s) => setSidechain(s, effectId, keyed ? null : source));
}

/** A Pro-C ducking `trackId` to `source`, in one undo step, its window opened. */
export function duckFrom(source: string, trackId: string) {
  const id = createId("fx");
  let made = false;
  useMusic.getState().commit((s) => {
    const next = duckWithProC(s, source, trackId, id);
    made = next !== null;
    return next ?? s;
  });
  if (made) openProC(id);
}
