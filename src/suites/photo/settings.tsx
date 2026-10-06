/**
 * The photo editor's section of Settings: how the Move tool picks and snaps, where its images live on the GPU, and
 * the size new photos start at.
 */
import { CANVAS_PRESETS } from "@shared/photo/types";
import { SettingsGroup, SettingsRow } from "@/components/settings/settings-ui";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { BUDGETS_MB, usePhotoPreferences } from "./preferences";

export default function PhotoSettings() {
  const budgetMB = usePhotoPreferences((s) => s.budgetMB);
  const presetId = usePhotoPreferences((s) => s.presetId);
  const autoSelect = usePhotoPreferences((s) => s.autoSelect);
  const snap = usePhotoPreferences((s) => s.snap);
  return (
    <>
      <SettingsGroup title="Move tool">
        <SettingsRow title="Auto-select" description="Clicking the canvas picks the layer under the pointer, and the one a click would pick is outlined (Photoshop's Auto-Select). Hold ⌘ to do the opposite for one click.">
          <Switch checked={autoSelect} onCheckedChange={(on) => usePhotoPreferences.getState().setAutoSelect(on)} aria-label="Auto-select" />
        </SettingsRow>
        <SettingsRow title="Snap" description="Moving and resizing snap to the canvas's edges and centre and to other layers' edges and centres, with a guide where they line up (⇧⌘;, or the magnet over the canvas). Hold Control while dragging to not snap.">
          <Switch checked={snap} onCheckedChange={(on) => usePhotoPreferences.getState().setSnap(on)} aria-label="Snap" />
        </SettingsRow>
      </SettingsGroup>
      <SettingsGroup title="New photos">
        <SettingsRow title="Canvas size" description="The size a new photo starts at (opening an image makes the canvas its size).">
          <Select value={presetId} onValueChange={(id) => usePhotoPreferences.getState().setPresetId(id)}>
            <SelectTrigger className="w-56" aria-label="New photo size">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CANVAS_PRESETS.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.label} · {p.width} × {p.height}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </SettingsRow>
      </SettingsGroup>
      <SettingsGroup title="Graphics">
        <SettingsRow title="GPU memory for images" description="How much the photo editor keeps on the GPU. Big photos still open with less: parts out of view are fetched again when needed. Takes effect when a photo opens.">
          <Select value={String(budgetMB)} onValueChange={(v) => usePhotoPreferences.getState().setBudgetMB(Number(v))}>
            <SelectTrigger className="w-32" aria-label="GPU memory">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {BUDGETS_MB.map((mb) => (
                <SelectItem key={mb} value={String(mb)}>
                  {mb / 1024} GB
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </SettingsRow>
      </SettingsGroup>
    </>
  );
}
