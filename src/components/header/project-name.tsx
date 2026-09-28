import { useRef, useState } from "react";
import { useEditor } from "@/stores/editor";

/** The project name; click to rename (Enter/blur saves, Escape cancels). */
export function ProjectName() {
  const name = useEditor((s) => s.project.name);
  const [draft, setDraft] = useState<string | null>(null);
  // Escape unmounts the input, which can still fire a blur; this makes finishing idempotent.
  const finished = useRef(false);

  const startEditing = () => {
    finished.current = false;
    setDraft(name);
  };

  const finish = (save: boolean) => {
    if (finished.current || draft === null) return;
    finished.current = true;
    const next = draft.trim();
    if (save && next && next !== name) {
      useEditor.getState().renameProject(next);
    }
    setDraft(null);
  };

  if (draft !== null) {
    return (
      <input
        autoFocus
        aria-label="Project name"
        value={draft}
        maxLength={100}
        spellCheck={false}
        onChange={(e) => setDraft(e.target.value)}
        onFocus={(e) => e.target.select()}
        onBlur={() => finish(true)}
        onKeyDown={(e) => {
          if (e.key === "Enter") finish(true);
          else if (e.key === "Escape") finish(false);
        }}
        className="h-7 w-56 rounded-md border border-input bg-background px-2 text-sm font-medium outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30"
      />
    );
  }

  return (
    <button
      type="button"
      title="Rename project"
      onClick={startEditing}
      className="h-7 max-w-64 truncate rounded-md border border-transparent px-2 text-sm font-medium transition-colors outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50"
    >
      {name}
    </button>
  );
}
