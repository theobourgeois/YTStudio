import { useEditor } from "@/stores/editor";
import { ClipInspector } from "./clip-inspector";
import { ProjectInspector } from "./project-inspector";

/** Right column: the selected clip's properties, or project settings. */
export function Inspector() {
  const selectedClipId = useEditor((s) => s.selectedClipId);
  return (
    <aside
      aria-label="Inspector"
      className="flex w-72 shrink-0 flex-col overflow-y-auto border-l bg-card [scrollbar-width:thin]"
    >
      {selectedClipId ? <ClipInspector key={selectedClipId} clipId={selectedClipId} /> : <ProjectInspector />}
    </aside>
  );
}
