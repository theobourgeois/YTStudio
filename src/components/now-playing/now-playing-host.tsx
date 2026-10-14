import { Suspense, useMemo } from "react";
import { useNowPlaying } from "@/stores/now-playing";
import { nowPlayingView } from "@/suites";

/** Where the visualizer opens (over everything, the whole window): the suite that draws it fills it. */
export function NowPlayingHost() {
  const open = useNowPlaying((s) => s.visualizer);
  const View = useMemo(nowPlayingView, []);
  if (!open || !View) return null;
  return (
    <Suspense fallback={<div className="fixed inset-0 z-[70] bg-black" />}>
      <View />
    </Suspense>
  );
}
