import { Expand, Film, Music, Shrink, Trash2 } from "lucide-react";
import type { FitMode } from "@shared/types";
import { formatTime } from "@shared/format";
import { MAIN_TRACK_ID, clipDuration, getClip, getTrack, updateClip } from "@shared/timeline";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";
import { useEditor } from "@/stores/editor";
import { InfoRow, PanelHeader, Section, segmentGroupClass, segmentItemClass } from "./layout";
import { VolumeControl } from "./volume-control";

export function ClipInspector({ clipId }: { clipId: string }) {
  const clip = useEditor((s) => getClip(s.project, clipId));
  const asset = useEditor((s) => {
    const assetId = getClip(s.project, clipId)?.assetId;
    return s.assets.find((a) => a.id === assetId);
  });
  const trackName = useEditor((s) => {
    const trackId = getClip(s.project, clipId)?.trackId;
    return trackId ? getTrack(s.project, trackId)?.name : undefined;
  });
  if (!clip) return null;

  const onMain = clip.trackId === MAIN_TRACK_ID;
  const subtitle = onMain
    ? "Video clip"
    : asset?.kind === "video"
      ? "Audio from video"
      : "Audio clip";
  const setFit = (fit: string) => {
    if (fit) useEditor.getState().commit((p) => updateClip(p, clip.id, { fit: fit as FitMode }));
  };

  return (
    <>
      <PanelHeader
        icon={<ClipThumb kind={onMain ? "video" : "audio"} poster={onMain ? asset?.poster : null} />}
        title={asset?.name ?? "Missing media"}
        subtitle={subtitle}
      />

      <Section title="Clip">
        <dl className="space-y-2">
          <InfoRow label="Track">{trackName ?? "—"}</InfoRow>
          <InfoRow label="Start">{formatTime(clip.start)}</InfoRow>
          <InfoRow label="Duration">{formatTime(clipDuration(clip))}</InfoRow>
          <InfoRow label="Source">
            {formatTime(clip.in)}
            <span className="px-1 text-muted-foreground">→</span>
            {formatTime(clip.out)}
          </InfoRow>
        </dl>
      </Section>

      <Section title="Volume">
        <VolumeControl clipId={clip.id} volume={clip.volume} />
      </Section>

      {onMain && (
        <Section title="Framing">
          <ToggleGroup
            type="single"
            spacing={1}
            value={clip.fit}
            onValueChange={setFit}
            className={segmentGroupClass}
            aria-label="Framing"
          >
            <ToggleGroupItem value="contain" className={segmentItemClass}>
              <Shrink /> Fit
            </ToggleGroupItem>
            <ToggleGroupItem value="cover" className={segmentItemClass}>
              <Expand /> Fill
            </ToggleGroupItem>
          </ToggleGroup>
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            {clip.fit === "contain"
              ? "Shows the whole frame, with the background around it."
              : "Crops the frame to fill the canvas."}
          </p>
        </Section>
      )}

      <Section>
        <Button
          variant="outline"
          size="sm"
          className="w-full border-destructive/30 text-destructive hover:bg-destructive/10 hover:text-destructive dark:border-destructive/30 dark:hover:bg-destructive/15"
          onClick={() => useEditor.getState().deleteSelected()}
        >
          <Trash2 />
          Delete clip
        </Button>
      </Section>
    </>
  );
}

function ClipThumb({ kind, poster }: { kind: "video" | "audio"; poster?: string | null }) {
  const Icon = kind === "video" ? Film : Music;
  return (
    <div
      className={cn(
        "flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-md",
        kind === "video" ? "bg-clip-video/15 text-clip-video" : "bg-clip-audio/15 text-clip-audio",
      )}
    >
      {poster ? <img src={poster} alt="" className="size-full object-cover" /> : <Icon className="size-4" />}
    </div>
  );
}
