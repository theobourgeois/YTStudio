import { useEffect } from "react";
import { cn } from "cn";
import { ActivityPill } from "@/components/assistant/activity-pill";
import { useEditor } from "@/stores/editor";
import { useLibrary } from "@/stores/library";
import { useSourcePreview } from "@/stores/source-preview";
import { SourcePreview } from "./source-preview";
import { Stage } from "./stage";
import { Transport } from "./transport";

/**
 * Centre column: the letterboxed canvas and the transport bar, or a single
 * media or Library file being previewed on its own. The timeline preview stays mounted
 * (just hidden) meanwhile so switching back is instant.
 */
export function Preview() {
  const sourceId = useSourcePreview((s) => s.assetId);
  const projectSource = useEditor((s) => (sourceId ? s.assets.find((a) => a.id === sourceId) : undefined));
  const librarySource = useLibrary((s) => (sourceId ? s.assets.find((a) => a.id === sourceId) : undefined));
  const source = projectSource ?? librarySource;
  useEffect(() => () => useSourcePreview.getState().close(), []);

  return (
    <section className="relative flex min-w-0 flex-1 flex-col bg-stage" aria-label="Preview">
      <ActivityPill />
      <div className={cn("flex min-h-0 flex-1 flex-col", source && "hidden")}>
        <Stage />
        <Transport />
      </div>
      {source && <SourcePreview key={source.id} asset={source} />}
    </section>
  );
}
