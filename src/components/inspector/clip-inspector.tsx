import { PiArrowsIn, PiArrowsOut, PiFilmStrip, PiMusicNotes, PiTrash } from "react-icons/pi";
import type { FitMode } from "@shared/types";
import { formatTime } from "@shared/format";
import { clipDuration, getClip, getTrack, updateClip } from "@shared/timeline";
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
  const track = useEditor((s) => {
    const trackId = getClip(s.project, clipId)?.trackId;
    return trackId ? getTrack(s.project, trackId) : undefined;
  });
  if (!clip) return null;

  const onVideo = track?.kind === "video";
  const subtitle = onVideo
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
        icon={<ClipThumb kind={onVideo ? "video" : "audio"} poster={onVideo ? asset?.poster : null} />}
        title={asset?.name ?? "Missing media"}
        subtitle={subtitle}
      />

      <Section title="Clip">
        <dl className="space-y-2">
          <InfoRow label="Track">{track?.name ?? "—"}</InfoRow>
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

      {onVideo && (
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
              <PiArrowsIn /> Fit
            </ToggleGroupItem>
            <ToggleGroupItem value="cover" className={segmentItemClass}>
              <PiArrowsOut /> Fill
            </ToggleGroupItem>
          </ToggleGroup>
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            {clip.fit === "contain"
              ? "Shows the whole frame, with the tracks below (or the background) around it."
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
          <PiTrash />
          Delete clip
        </Button>
      </Section>
    </>
  );
}

function ClipThumb({ kind, poster }: { kind: "video" | "audio"; poster?: string | null }) {
  const Icon = kind === "video" ? PiFilmStrip : PiMusicNotes;
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
