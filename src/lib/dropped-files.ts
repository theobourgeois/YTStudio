/**
 * Files and folders dropped from the OS, keeping the folders' structure (the
 * Library imports a dropped folder as a folder).
 */
export interface DroppedFolder {
  name: string;
  files: File[];
  folders: DroppedFolder[];
}

/**
 * Read what was dropped, folders included. Call it during the `drop` event
 * (the entries are only available then); the folders are read afterwards.
 * Hidden files (".DS_Store"...) are skipped.
 */
export function readDrop(dt: DataTransfer): Promise<DroppedFolder> {
  const entries = Array.from(dt.items)
    .filter((item) => item.kind === "file")
    .map((item) => item.webkitGetAsEntry?.())
    .filter((entry): entry is FileSystemEntry => !!entry);
  if (entries.length === 0) return Promise.resolve({ name: "", files: Array.from(dt.files), folders: [] });
  return readEntries("", entries);
}

async function readEntries(name: string, entries: FileSystemEntry[]): Promise<DroppedFolder> {
  const folder: DroppedFolder = { name, files: [], folders: [] };
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    if (entry.isFile) {
      folder.files.push(await new Promise<File>((resolve, reject) => (entry as FileSystemFileEntry).file(resolve, reject)));
    } else if (entry.isDirectory) {
      folder.folders.push(await readEntries(entry.name, await listDirectory(entry as FileSystemDirectoryEntry)));
    }
  }
  return folder;
}

/** Every entry of a directory (`readEntries` returns them in batches until an empty one). */
async function listDirectory(dir: FileSystemDirectoryEntry): Promise<FileSystemEntry[]> {
  const reader = dir.createReader();
  const all: FileSystemEntry[] = [];
  for (;;) {
    const batch = await new Promise<FileSystemEntry[]>((resolve, reject) => reader.readEntries(resolve, reject));
    if (batch.length === 0) return all;
    all.push(...batch);
  }
}

/** Every file in a dropped tree. */
export function droppedFiles(folder: DroppedFolder): File[] {
  return [...folder.files, ...folder.folders.flatMap(droppedFiles)];
}

/** The tree with only the files `keep` accepts, and without folders left empty. */
export function filterDrop(folder: DroppedFolder, keep: (file: File) => boolean): DroppedFolder {
  return {
    name: folder.name,
    files: folder.files.filter(keep),
    folders: folder.folders.map((f) => filterDrop(f, keep)).filter((f) => f.files.length > 0 || f.folders.length > 0),
  };
}
