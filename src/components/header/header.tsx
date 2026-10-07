import { HeaderActions } from "@/components/header/header-actions";
import { useEditor } from "@/stores/editor";
import { useOpenVideoWindows } from "@/stores/video-windows";
import { ProjectName } from "./project-name";
import { VideoSettingsButton } from "./settings-dialog";

export function Header() {
  const canUndo = useEditor((s) => s.past.length > 0 && !s.gestureBase);
  const canRedo = useEditor((s) => s.future.length > 0 && !s.gestureBase);
  // The whole video is exported (its main sequence), whichever sequence the timeline shows.
  const empty = useEditor((s) => s.document.clips.length === 0);

  return (
    <header data-titlebar="header" className="flex h-13 shrink-0 items-center gap-2 border-b border-line bg-surface-1 px-3">
      <VideoName />
      <VideoSettingsButton />
      <HeaderActions
        canUndo={canUndo}
        canRedo={canRedo}
        onUndo={() => useEditor.getState().undo()}
        onRedo={() => useEditor.getState().redo()}
        exportAction={{
          onClick: () => useOpenVideoWindows.getState().show("export"),
          disabled: empty && "Add clips to the timeline to export",
        }}
      />
    </header>
  );
}

function VideoName() {
  const name = useEditor((s) => s.project.name);
  return <ProjectName name={name} onRename={(next) => useEditor.getState().renameProject(next)} />;
}
