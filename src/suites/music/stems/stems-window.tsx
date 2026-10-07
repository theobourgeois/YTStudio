import { useMemo, useState } from "react";
import { STEMS, STEM_NAMES, type Stem, stemSources } from "@shared/music/stems";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Toggle } from "@/components/ui/toggle";
import { WindowBody, WindowFooter } from "@/components/windows/floating-window";
import { modelMegabytes, targetIn, useModelStatus } from "../ml";
import { useSong } from "../store";
import { MusicWindow, centredOnDesktop } from "../window";
import { closeExtractStems, extractStemsWithToast, useStems } from "./actions";

const WIDTH = 340;

/**
 * Extract stems (an audio clip's menu, or an audio channel's in the rack; FL Studio's "Extract stems from
 * sample"): which parts to split the clip's file into, and whether the clip goes silent. Extract closes it and
 * the split goes on in the background (a toast says how it's going); its stems land under the clip.
 */
export function StemsWindow() {
  const target = useStems((s) => s.target);
  const chosen = useStems((s) => s.chosen);
  const mute = useStems((s) => s.mute);
  const channels = useSong((song) => song.channels);
  const playlist = useSong((song) => song.playlist);
  const found = useMemo(() => (target ? targetIn({ channels, playlist }, target) : null), [target, channels, playlist]);
  const model = useModelStatus("stems");
  const [initial] = useState(() => centredOnDesktop(WIDTH, 300));
  if (!target || !found) return null;
  const toggle = (stem: Stem, on: boolean) => useStems.setState((s) => ({ chosen: STEMS.filter((x) => (x === stem ? on : s.chosen.includes(x))) }));
  const groups = stemSources(chosen);
  const rest = groups.other && groups.other.length > 1 ? groups.other.filter((s) => s !== "other").map((s) => STEM_NAMES[s].toLowerCase()) : [];
  const listed = rest.length > 1 ? `${rest.slice(0, -1).join(", ")} and ${rest.at(-1)}` : rest[0];
  const ready = model?.status === "ready";
  const extract = () => {
    if ("error" in found || !chosen.length) return;
    closeExtractStems();
    void extractStemsWithToast(target, chosen, mute);
  };
  return (
    <MusicWindow id="stems" title="Extract stems" initial={initial} keepsKeys onClose={closeExtractStems}>
      <WindowBody className="gap-3 p-3" >
        <form
          className="flex flex-col gap-3"
          style={{ width: WIDTH - 24 }}
          data-testid="stems-window"
          onSubmit={(e) => {
            e.preventDefault();
            extract();
          }}
        >
          <p className="truncate text-[12px] text-muted-foreground" title={"error" in found ? found.error : found.channel.name}>
            {"error" in found ? found.error : found.clip ? `${found.channel.name}: this clip's file, split into` : `${found.channel.name}: its file, split into`}
          </p>
          <div className="grid grid-cols-3 gap-1.5" role="group" aria-label="Stems">
            {STEMS.map((stem) => (
              <Toggle key={stem} size="sm" variant="outline" className="text-xs" pressed={chosen.includes(stem)} onPressedChange={(on) => toggle(stem, on)} aria-label={STEM_NAMES[stem]}>
                {STEM_NAMES[stem]}
              </Toggle>
            ))}
          </div>
          <p className="min-h-4 text-[11px] text-muted-foreground">
            {!chosen.length ? "Choose at least one." : rest.length ? `Other holds the ${listed} too.` : groups.other ? "Other is what's left." : "What isn't chosen is left out."}
          </p>
          <label className="flex items-center justify-between gap-3 text-[13px]">
            {target.clipId === null ? "Mute its clips" : "Mute the original clip"}
            <Switch checked={mute} onCheckedChange={(on) => useStems.setState({ mute: on })} aria-label={target.clipId === null ? "Mute its clips" : "Mute the original clip"} />
          </label>
          {model && !ready && (
            <p className="rounded-sm bg-surface-1 px-2 py-1.5 text-[11px] text-muted-foreground" data-testid="stems-model-note">
              {model.status === "downloading"
                ? `Downloading the separation model… ${Math.round((model.progress ?? 0) * 100)}%`
                : `This downloads a separation model (HTDemucs, ${modelMegabytes("stems")}) once. It runs on this computer: your audio doesn't leave it.`}
            </p>
          )}
          <WindowFooter>
            <Button type="button" variant="outline" size="sm" onClick={closeExtractStems}>
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={"error" in found || !chosen.length || !model}>
              {ready || model?.standIn ? "Extract" : "Download and extract"}
            </Button>
          </WindowFooter>
        </form>
      </WindowBody>
    </MusicWindow>
  );
}
