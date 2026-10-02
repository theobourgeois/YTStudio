/**
 * Timeline tabs (Premiere's sequence tabs): the main sequence, then each nested sequence
 * opened (double-click a nested clip). Shown only once one is open, in the Timeline panel's tab
 * strip (its dock `header`), or its title bar while it floats. Double-click a nested
 * sequence's tab to rename it; its × closes the tab (the sequence stays in the video).
 */
import { type KeyboardEvent, useState } from "react";
import { PiFilmStrip, PiStack, PiX } from "react-icons/pi";
import { useShallow } from "zustand/react/shallow";
import { getSequence } from "@shared/sequences";
import { cn } from "cn";
import { useEditor } from "@/stores/editor";

export function SequenceTabs() {
  const ids = useEditor((s) => s.openSequences);
  const names = useEditor(useShallow((s) => s.openSequences.map((id) => getSequence(s.document, id)?.name ?? "")));
  const active = useEditor((s) => s.sequenceId);
  if (ids.length === 0) return null;
  const open = ids.map((id, i) => ({ id, name: names[i] }));
  return (
    <div
      role="tablist"
      aria-label="Sequences"
      className="ml-1 flex min-w-0 items-center gap-0.5 overflow-x-auto border-l border-line pl-1.5 [scrollbar-width:none]"
    >
      <Tab active={active === null} label="Main" icon={<PiFilmStrip className="size-3.5 shrink-0" />} onSelect={() => useEditor.getState().openSequence(null)} />
      {open.map((seq) => (
        <Tab
          key={seq.id}
          active={active === seq.id}
          label={seq.name}
          icon={<PiStack className="size-3.5 shrink-0" />}
          onSelect={() => useEditor.getState().openSequence(seq.id)}
          onRename={(name) => useEditor.getState().renameSequence(seq.id, name)}
          onClose={() => useEditor.getState().closeSequence(seq.id)}
        />
      ))}
    </div>
  );
}

function Tab({
  active,
  label,
  icon,
  onSelect,
  onRename,
  onClose,
}: {
  active: boolean;
  label: string;
  icon: React.ReactNode;
  onSelect: () => void;
  onRename?: (name: string) => void;
  onClose?: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const finish = (value: string | null) => {
    setEditing(false);
    if (value !== null && value.trim()) onRename?.(value);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    e.stopPropagation();
    if (e.key === "Enter") finish(e.currentTarget.value);
    if (e.key === "Escape") finish(null);
  };
  return (
    <div
      role="tab"
      aria-selected={active}
      data-sequence-tab={label}
      className={cn(
        "group/tab flex h-6 max-w-52 min-w-0 shrink-0 cursor-pointer items-center gap-1.5 rounded-md border px-2 text-xs whitespace-nowrap transition-colors select-none",
        active ? "border-line bg-background text-foreground" : "border-transparent text-muted-foreground hover:bg-accent/60 hover:text-foreground",
      )}
      onClick={onSelect}
      onDoubleClick={() => onRename && setEditing(true)}
    >
      {icon}
      {editing ? (
        <input
          autoFocus
          defaultValue={label}
          aria-label="Sequence name"
          className="w-32 min-w-0 rounded bg-muted px-1 outline-none"
          onKeyDown={onKeyDown}
          onBlur={(e) => finish(e.currentTarget.value)}
          onClick={(e) => e.stopPropagation()}
        />
      ) : (
        <span className="truncate">{label}</span>
      )}
      {onClose && (
        <button
          type="button"
          aria-label={`Close ${label}`}
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
          className="grid size-4 shrink-0 cursor-pointer place-items-center rounded opacity-60 hover:bg-accent hover:opacity-100"
        >
          <PiX className="size-3" />
        </button>
      )}
    </div>
  );
}
