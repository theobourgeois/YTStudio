import { useMemo } from "react";
import { PiBooks, PiFolderSimple } from "react-icons/pi";
import { flattenFolders, folderSubtree } from "@shared/library";
import type { MenuKit } from "@/components/menu-kit";
import { useLibrary } from "@/stores/library";

/**
 * Menu items for picking a Library folder ("Add to Library", "Move to"): the
 * top level, then every folder indented under its parent.
 */
export function FolderMenuItems({
  kit: { Item },
  onSelect,
  current,
  moving,
}: {
  kit: MenuKit;
  onSelect: (folderId: string | null) => void;
  /** Where the thing already is (shown disabled). */
  current?: string | null;
  /** A folder being moved: it and its subfolders aren't listed. */
  moving?: string;
}) {
  const folders = useLibrary((s) => s.folders);
  const flat = useMemo(() => {
    const hidden = moving ? folderSubtree(folders, moving) : new Set<string>();
    return flattenFolders(folders).filter(({ folder }) => !hidden.has(folder.id));
  }, [folders, moving]);
  return (
    <>
      <Item disabled={current === null} onSelect={() => onSelect(null)}>
        <PiBooks />
        Library
      </Item>
      {flat.map(({ folder, depth }) => (
        <Item
          key={folder.id}
          disabled={current === folder.id}
          style={{ paddingLeft: 8 + (depth + 1) * 12 }}
          onSelect={() => onSelect(folder.id)}
        >
          <PiFolderSimple />
          <span className="truncate">{folder.name}</span>
        </Item>
      ))}
    </>
  );
}
