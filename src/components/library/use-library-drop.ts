import { useEffect, useRef, useState, type DragEvent } from "react";
import { canMoveFolder } from "@shared/library";
import { dragKind, getAssetDragData, getLibraryDragData } from "@/lib/dnd";
import { useLibrary } from "@/stores/library";

/**
 * Makes a folder row or breadcrumb (`folderId` null = the top level) a drop
 * target: Library items and folders move into it, the project's media is added
 * to it. OS files are only highlighted: the left panel imports them, into the
 * folder under the pointer (`data-library-folder`).
 */
export function useLibraryDrop(folderId: string | null) {
  const depth = useRef(0);
  const [active, setActive] = useState(false);

  useEffect(() => {
    const reset = () => {
      depth.current = 0;
      setActive(false);
    };
    window.addEventListener("dragend", reset);
    window.addEventListener("drop", reset);
    return () => {
      window.removeEventListener("dragend", reset);
      window.removeEventListener("drop", reset);
    };
  }, []);

  const accepts = (e: DragEvent) => {
    const kind = dragKind(e.dataTransfer);
    return kind === "library" || kind === "assets" || kind === "files";
  };

  const handlers = {
    "data-library-folder": folderId ?? "",
    onDragEnter(e: DragEvent) {
      if (!accepts(e)) return;
      e.preventDefault();
      depth.current++;
      setActive(true);
    },
    onDragOver(e: DragEvent) {
      if (!accepts(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = dragKind(e.dataTransfer) === "library" ? "move" : "copy";
    },
    onDragLeave(e: DragEvent) {
      if (!accepts(e)) return;
      depth.current = Math.max(0, depth.current - 1);
      if (depth.current === 0) setActive(false);
    },
    onDrop(e: DragEvent) {
      const kind = dragKind(e.dataTransfer);
      depth.current = 0;
      setActive(false);
      if (kind !== "library" && kind !== "assets") return; // files: the panel imports them
      e.preventDefault();
      const library = useLibrary.getState();
      if (kind === "assets") {
        for (const assetId of getAssetDragData(e.dataTransfer)?.assetIds ?? []) void library.addAsset(assetId, folderId);
        return;
      }
      const id = getLibraryDragData(e.dataTransfer);
      if (!id) return;
      if (library.folders.some((f) => f.id === id)) {
        if (canMoveFolder(library.folders, id, folderId)) void library.moveFolder(id, folderId);
      } else if (library.items.find((i) => i.id === id)?.folderId !== folderId) {
        void library.updateItem(id, { folderId });
      }
    },
  };

  return { active, handlers };
}
