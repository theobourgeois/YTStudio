import { useRef, useState } from "react";
import { cn } from "cn";

/** The project name; click to rename (Enter/blur saves, Escape cancels). */
/** `className` resizes it (a denser toolbar); both the button and the field take it. */
export function ProjectName({ name, onRename, className }: { name: string; onRename: (name: string) => void; className?: string }) {
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
      onRename(next);
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
        className={cn("sunken h-7 w-56 rounded-md px-2 text-sm font-medium outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40", className)}
      />
    );
  }

  return (
    <button
      type="button"
      title="Rename project"
      onClick={startEditing}
      className={cn("h-7 max-w-64 truncate rounded-md border border-transparent px-2 text-sm font-medium transition-colors outline-none hover:raised hover:raised-hover focus-visible:ring-2 focus-visible:ring-ring/60", className)}
    >
      {name}
    </button>
  );
}
