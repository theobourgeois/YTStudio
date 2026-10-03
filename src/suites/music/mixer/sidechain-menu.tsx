/**
 * Choosing an effect's key (`docs/sidechain.md`): the tracks it can hear, by number and name (a track whose
 * sound already reaches this one is greyed: a loop), where its sound is taken, and No key. The same items
 * in an effect slot's menus (its arrow's and its right-click's) and in Pro-C's External source.
 */
import { useMemo } from "react";
import { PiCheck } from "react-icons/pi";
import { DEFAULT_TAP, SIDECHAIN_TAP_NAMES, keyChoices, setSidechain, setSidechainTap } from "@shared/music/sidechain";
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
import { useMusic, useSong } from "../store";

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
