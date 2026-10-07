import { useEffect, useState } from "react";
import { SettingsGroup, SettingsRow } from "@/components/settings/settings-ui";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { SHORTCUT_KEYS } from "@/hooks/shortcuts";
import { useEditor } from "@/stores/editor";
import { PREVIEW_RESOLUTIONS, PREVIEW_RESOLUTION_LABELS, useLayout } from "@/stores/layout";
import { MAX_LAYER_DURATION, useVideoPreferences, validLayerDuration } from "@/stores/video-preferences";

/**
 * The video editor's section of Settings: how it previews, how the timeline behaves, and how long new
 * text and layers are. The video's own format (aspect ratio, frame rate) is the video's, in its header.
 */
export function VideoSettings() {
  return (
    <>
      <SettingsGroup title="Playback">
        <PreviewResolutionRow />
        <AdaptiveResolutionRow />
      </SettingsGroup>
      <SettingsGroup title="Timeline">
        <SnappingRow />
        <AutoRippleRow />
      </SettingsGroup>
      <SettingsGroup title="New clips">
        <LayerDurationRow />
      </SettingsGroup>
    </>
  );
}

function PreviewResolutionRow() {
  const resolution = useLayout((s) => s.previewResolution);
  return (
    <SettingsRow title="Preview resolution" description="Drawing the Program monitor at fewer pixels keeps heavy edits playing smoothly. Exports are always full.">
      <Select value={String(resolution)} onValueChange={(v) => useLayout.getState().setPreviewResolution(Number(v))}>
        <SelectTrigger size="sm" className="w-28" aria-label="Preview resolution">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {PREVIEW_RESOLUTIONS.map((r) => (
            <SelectItem key={r} value={String(r)}>
              {PREVIEW_RESOLUTION_LABELS[r]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </SettingsRow>
  );
}

function AdaptiveResolutionRow() {
  const on = useLayout((s) => s.adaptiveResolution);
  return (
    <SettingsRow
      title="Adaptive resolution"
      description="While the picture moves, frames too heavy to keep up are drawn at fewer pixels, then in full once it stops (the lightning icon under the monitor lights up). Off: every frame in full, however slowly."
    >
      <Switch checked={on} onCheckedChange={(v) => useLayout.getState().setAdaptiveResolution(v)} aria-label="Adaptive resolution" />
    </SettingsRow>
  );
}

function SnappingRow() {
  const snapping = useEditor((s) => s.snapping);
  return (
    <SettingsRow title="Snapping" description={`Dragged clips, edges and the playhead stick to cuts, the playhead and markers. ${SHORTCUT_KEYS.toggleSnapping} turns it on and off as you work.`}>
      <Switch checked={snapping} onCheckedChange={() => useEditor.getState().toggleSnapping()} aria-label="Snapping" />
    </SettingsRow>
  );
}

function AutoRippleRow() {
  const autoRipple = useEditor((s) => s.autoRipple);
  return (
    <SettingsRow title="Auto ripple" description="Deleting closes the gap, and trims and dropped media move the rest of the track along. Moving clips stays free.">
      <Switch checked={autoRipple} onCheckedChange={() => useEditor.getState().toggleAutoRipple()} aria-label="Auto ripple" />
    </SettingsRow>
  );
}

function LayerDurationRow() {
  const duration = useVideoPreferences((s) => s.layerDuration);
  const [draft, setDraft] = useState(String(duration));
  useEffect(() => setDraft(String(duration)), [duration]);

  const commit = () => {
    const seconds = validLayerDuration(draft);
    if (seconds === null) setDraft(String(duration));
    else useVideoPreferences.getState().setLayerDuration(seconds);
  };
  return (
    <SettingsRow title="Length of new text and layers" description="Text, shapes, solids and adjustment layers start this long (an adjustment layer over selected clips takes their span).">
      <div className="flex items-center gap-1.5">
        <Input
          type="number"
          inputMode="decimal"
          min={0.1}
          max={MAX_LAYER_DURATION}
          step={0.5}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
            if (e.key === "Escape" && draft !== String(duration)) {
              e.preventDefault();
              setDraft(String(duration));
            }
          }}
          aria-label="Length of new text and layers, in seconds"
          className="h-7 w-20 text-right tabular-nums"
        />
        <span className="text-xs text-muted-foreground">seconds</span>
      </div>
    </SettingsRow>
  );
}
