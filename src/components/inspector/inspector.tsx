import { PiArrowLineLeft, PiStack, PiTrash } from "react-icons/pi";
import { Button } from "@/components/ui/button";
import { useEditor } from "@/stores/editor";
import { ClipInspector } from "./clip-inspector";
import { PanelHeader, Section } from "./layout";
import { ProjectInspector } from "./project-inspector";

/** Right column: the selected clip's properties, a multi-selection summary, or project settings. */
export function Inspector() {
  const selectedClipIds = useEditor((s) => s.selectedClipIds);
  const [only] = selectedClipIds;
  return (
    <aside
      aria-label="Inspector"
      className="flex w-72 shrink-0 flex-col overflow-y-auto border-l bg-card [scrollbar-width:thin]"
    >
      {selectedClipIds.length > 1 ? (
        <SelectionInspector count={selectedClipIds.length} />
      ) : only ? (
        <ClipInspector key={only} clipId={only} />
      ) : (
        <ProjectInspector />
      )}
    </aside>
  );
}

function SelectionInspector({ count }: { count: number }) {
  return (
    <>
      <PanelHeader
        icon={
          <div className="flex size-10 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
            <PiStack className="size-4" />
          </div>
        }
        title={`${count} clips selected`}
        subtitle="Drag, nudge, copy or delete them together"
      />
      <Section>
        <div className="grid gap-2">
          <Button
            variant="outline"
            size="sm"
            className="w-full"
            onClick={() => useEditor.getState().deleteSelected(true)}
          >
            <PiArrowLineLeft />
            Ripple delete
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="w-full border-destructive/30 text-destructive hover:bg-destructive/10 hover:text-destructive dark:border-destructive/30 dark:hover:bg-destructive/15"
            onClick={() => useEditor.getState().deleteSelected()}
          >
            <PiTrash />
            Delete {count} clips
          </Button>
        </div>
      </Section>
    </>
  );
}
