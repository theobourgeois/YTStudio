import { toast } from "sonner";
import { mediaFiles } from "@/lib/dnd";
import { useEditor } from "@/stores/editor";

export const ACCEPTED_FILE_TYPES =
  "video/*,audio/*,.mkv,.mov,.m4a,.mp3,.wav,.flac,.ogg,.opus";

/** Keep only audio/video files, telling the user about anything skipped. */
export function acceptMediaFiles(files: File[]): File[] {
  const accepted = mediaFiles(files);
  const skipped = files.filter((f) => !accepted.includes(f));
  if (skipped.length > 0) {
    toast.warning(
      skipped.length === 1
        ? `Skipped “${skipped[0].name}”`
        : `Skipped ${skipped.length} unsupported files`,
      { description: "Only video and audio files can be imported." },
    );
  }
  return accepted;
}

/** Import OS files into the open project's media, skipping (and reporting) non-media files. */
export function importMedia(files: File[]) {
  const accepted = acceptMediaFiles(files);
  if (accepted.length > 0) void useEditor.getState().importFiles(accepted);
}
