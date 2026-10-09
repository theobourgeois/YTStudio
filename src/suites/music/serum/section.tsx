import type { ReactNode } from "react";

/**
 * A section of the sound's column: its title, anything beside it (a count, a button), and what it holds under it. In a
 * tab, whose name already says what it is, it has no title: only what's beside it, if anything.
 */
export function SerumSection({ title, aside, children, label, testId }: { title?: string; aside?: ReactNode; children: ReactNode; label: string; testId?: string }) {
  return (
    <section className={title ? "px-3 pt-4" : "px-3 pt-3"} aria-label={label} data-testid={testId}>
      {(title || aside) && (
        <div className="mb-2 flex h-5 items-center gap-2">
          {title && <h3 className="text-[12px] font-medium text-[var(--serum-text)]">{title}</h3>}
          <div className="flex flex-1 items-center justify-end gap-2">{aside}</div>
        </div>
      )}
      {children}
    </section>
  );
}
