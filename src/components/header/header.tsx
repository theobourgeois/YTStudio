import { HeaderActions } from "@/components/header/header-actions";
import { MenuRow } from "@/components/header/menu-row";
import { useEditor } from "@/stores/editor";
import { useOpenVideoWindows } from "@/stores/video-windows";
import { ProjectName } from "./project-name";
import { VideoSettingsButton } from "./settings-dialog";

/** The video editor's menu row (`MenuRow`): its name and format, Premiere's menus, then the actions every suite has. */
export function Header() {
  const canUndo = useEditor((s) => s.past.length > 0 && !s.gestureBase);
  const canRedo = useEditor((s) => s.future.length > 0 && !s.gestureBase);
  // The whole video is exported (its main sequence), whichever sequence the timeline shows.
  const empty = useEditor((s) => s.document.clips.length === 0);

  return (
    <MenuRow
      name={
        <>
          <VideoName />
          <VideoSettingsButton />
        </>
      }
      actions={
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
      }
    />
  );
}

function VideoName() {
  const name = useEditor((s) => s.project.name);
  return <ProjectName name={name} onRename={(next) => useEditor.getState().renameProject(next)} />;
}
