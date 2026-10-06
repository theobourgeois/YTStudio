/**
 * A section of Properties that folds (Develop, Effects): its header a triangle, its title, what it does now in a few
 * words while it's folded, and its buttons. Whether it's open is this computer's, by section, the same for every
 * layer; until it's been folded or opened by hand, it's open when it does something.
 */
import { useState } from "react";
import { PiCaretDown, PiCaretRight } from "react-icons/pi";

const KEY = "photo.properties.folds";

function savedFolds(): Record<string, boolean> {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? "{}") as unknown;
    return saved && typeof saved === "object" ? (saved as Record<string, boolean>) : {};
  } catch {
    return {};
  }
}

export function FoldSection({
  id,
  title,
  summary,
  active,
  actions,
  children,
}: {
  id: string;
  title: string;
  /** Shown beside the title while folded. */
  summary?: string | null;
  /** Whether it does something now: open by default. */
  active: boolean;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  const [folds, setFolds] = useState(savedFolds);
  const open = folds[id] ?? active;
  const toggle = () => {
    const next = { ...savedFolds(), [id]: !open };
    localStorage.setItem(KEY, JSON.stringify(next));
    setFolds(next);
  };
  return (
    <section className="flex flex-col gap-2" data-fold-section={id} data-open={open}>
      <header className="flex h-6 items-center gap-1">
        <button type="button" className="flex h-full min-w-0 flex-1 items-center gap-1 text-left" aria-expanded={open} onClick={toggle}>
          {open ? <PiCaretDown className="size-3 shrink-0 text-muted-foreground" /> : <PiCaretRight className="size-3 shrink-0 text-muted-foreground" />}
          <h3 className="shrink-0 text-xs font-medium tracking-wide text-muted-foreground uppercase">{title}</h3>
          {!open && summary && <span className="truncate pl-1 text-xs text-muted-foreground/70">{summary}</span>}
        </button>
        {actions}
      </header>
      {open && children}
    </section>
  );
}
