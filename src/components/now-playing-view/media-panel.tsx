import { useRef } from "react";
import { PiFilmStrip, PiImage, PiPlus, PiShuffle, PiX } from "react-icons/pi";
import { cn } from "cn";
import { MEDIA_FOLDER, useVisualizerMedia } from "./media-library";
import { useVisualizerPrefs } from "./prefs";

/**
 * The user's clips and pictures for the visualizer (docs/now-playing.md, "Your media"): what's in the Library's
 * Visualizer folder, the one melting into the feedback now marked; added from here or dropped on the visualizer, taken
 * out, turned on or off, another one asked for.
 */
export function MediaPanel() {
  const media = useVisualizerMedia((s) => s.media);
  const feeding = useVisualizerMedia((s) => s.feeding);
  const adding = useVisualizerMedia((s) => s.adding);
  const on = useVisualizerPrefs((s) => s.media);
  const input = useRef<HTMLInputElement>(null);
  return (
    <div
      data-media-panel
      className="pointer-events-auto absolute top-16 right-4 bottom-36 flex w-80 flex-col rounded-lg bg-black/75 px-5 py-4 ring-1 ring-white/10 backdrop-blur-md"
    >
      <h3 className="mb-2 flex items-center gap-3 text-[11px] tracking-[0.18em] text-white/70 uppercase">
        Your media
        <span className="h-px flex-1 bg-white/15" />
      </h3>
      <p className="mb-3 text-[11px] leading-4 text-white/55">
        Clips and pictures that melt into MilkDrop's looks: painted into the feedback, a little more on each kick, and carried off by the preset's own motion. Drop
        them anywhere on the visualizer. They're kept in the Library's {MEDIA_FOLDER} folder.
      </p>
      <div className="mb-3 grid grid-cols-2 gap-1">
        <Choice on={on} onClick={() => useVisualizerPrefs.getState().setMedia(true)}>
          In the feedback
        </Choice>
        <Choice on={!on} onClick={() => useVisualizerPrefs.getState().setMedia(false)}>
          Off (⇧N)
        </Choice>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {media.length ? (
          <div className="grid grid-cols-3 gap-1.5">
            {media.map(({ itemId, asset }) => (
              <div
                key={itemId}
                data-media={asset.id}
                data-feeding={asset.id === feeding || undefined}
                title={asset.name}
                className={cn("group relative aspect-video overflow-hidden rounded bg-white/5 ring-1", asset.id === feeding ? "ring-white" : "ring-white/10")}
              >
                {(asset.poster ?? (asset.kind === "image" ? asset.src : null)) && (
                  <img src={asset.poster ?? asset.src} alt="" draggable={false} className="size-full object-cover" />
                )}
                <span className="absolute bottom-0.5 left-1 text-white/80 drop-shadow [&_svg]:size-3">{asset.kind === "video" ? <PiFilmStrip /> : <PiImage />}</span>
                <button
                  type="button"
                  aria-label={`Take ${asset.name} out`}
                  title="Take it out (it's deleted from the Library)"
                  onClick={() => void useVisualizerMedia.getState().remove(itemId)}
                  className="absolute top-0.5 right-0.5 hidden size-5 place-items-center rounded bg-black/70 text-white/85 group-hover:grid hover:bg-black [&_svg]:size-3"
                >
                  <PiX />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className="rounded-md bg-white/5 px-3 py-4 text-center text-[12px] text-white/60 ring-1 ring-white/10">Nothing yet: add a few clips or pictures.</p>
        )}
      </div>
      {adding > 0 && <p className="mt-2 text-[11px] text-white/60">Adding {adding}…</p>}
      <div className="mt-3 grid grid-cols-2 gap-1">
        <button
          type="button"
          onClick={() => input.current?.click()}
          className="flex h-8 items-center justify-center gap-1.5 rounded-md bg-white/10 text-[12px] text-white/85 ring-1 ring-white/15 hover:bg-white/15 [&_svg]:size-3.5"
        >
          <PiPlus />
          Add
        </button>
        <button
          type="button"
          disabled={!media.length || !on}
          onClick={() => useVisualizerPrefs.getState().requestNextMedia()}
          className="flex h-8 items-center justify-center gap-1.5 rounded-md bg-white/10 text-[12px] text-white/85 ring-1 ring-white/15 hover:bg-white/15 disabled:opacity-40 [&_svg]:size-3.5"
        >
          <PiShuffle />
          Another (N)
        </button>
      </div>
      <input
        ref={input}
        type="file"
        multiple
        accept="video/*,image/*"
        aria-label="Add clips or pictures"
        className="hidden"
        onChange={(e) => {
          const files = [...(e.target.files ?? [])];
          e.target.value = "";
          void useVisualizerMedia.getState().add(files);
        }}
      />
    </div>
  );
}

function Choice({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn("h-7 rounded text-[11px] ring-1 ring-white/15", on ? "bg-white text-black" : "bg-white/5 text-white/75 hover:bg-white/10")}
    >
      {children}
    </button>
  );
}
