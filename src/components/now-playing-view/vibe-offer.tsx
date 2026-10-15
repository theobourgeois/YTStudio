import { PiSparkle, PiX } from "react-icons/pi";
import { modelSize } from "@shared/models";
import { VIBE_MODEL_SPEC } from "@shared/signals/vibe";
import { useNowPlaying } from "@/stores/now-playing";
import { useVisualizerPrefs } from "./prefs";

/**
 * The vibe's model, offered (docs/now-playing.md, "The vibe"): while it isn't here, once, until the user downloads
 * it or says not now; its download's progress; a failed one, to try again.
 */
export function VibeOffer() {
  const listening = useNowPlaying((s) => s.listening === "on");
  const model = useNowPlaying((s) => s.vibeModel);
  const declined = useVisualizerPrefs((s) => s.vibeDeclined);
  if (!listening || !model || model.status === "ready") return null;
  const downloading = model.status === "downloading";
  if (declined && !downloading) return null;
  const megabytes = Math.round(modelSize(VIBE_MODEL_SPEC) / 1e6);
  return (
    <div data-vibe-offer={model.status} className="pointer-events-auto absolute bottom-28 left-6 w-80 rounded-lg bg-black/75 p-3.5 text-[12px] leading-5 text-white/80 ring-1 ring-white/10 backdrop-blur-md">
      <div className="mb-1 flex items-center gap-2 text-[13px] font-semibold text-white [&_svg]:size-4">
        <PiSparkle />
        Hear each song's vibe
        {!downloading && (
          <button type="button" aria-label="Not now" title="Not now" onClick={() => useVisualizerPrefs.getState().declineVibe()} className="ml-auto grid size-6 place-items-center rounded text-white/60 hover:bg-white/10 hover:text-white [&_svg]:size-3.5">
            <PiX />
          </button>
        )}
      </div>
      {downloading ? (
        <>
          <p>Downloading the vibe's model… {Math.round((model.progress ?? 0) * 100)}%</p>
          <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/15">
            <div className="h-full bg-white transition-[width]" style={{ width: `${(model.progress ?? 0) * 100}%` }} />
          </div>
        </>
      ) : (
        <>
          <p>
            {model.status === "error"
              ? `The download didn't finish: ${model.error ?? "try again"}.`
              : `A local AI model (CLAP, ${megabytes} MB, downloaded once) hears how intense, bright, aggressive and fast a song is, and its genre, so the looks suit it better.`}
          </p>
          <div className="mt-2.5 flex gap-2">
            <button type="button" onClick={() => void useNowPlaying.getState().downloadVibe()} className="rounded-md bg-white px-3 py-1 text-[12px] font-medium text-black hover:bg-white/90">
              {model.status === "error" ? "Try again" : `Download (${megabytes} MB)`}
            </button>
            <button type="button" onClick={() => useVisualizerPrefs.getState().declineVibe()} className="rounded-md px-3 py-1 text-[12px] text-white/70 hover:bg-white/10 hover:text-white">
              Not now
            </button>
          </div>
        </>
      )}
    </div>
  );
}
