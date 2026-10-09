import type { ReactNode } from "react";

/** A section of the sound's column: its title, anything beside it (a count, a button), and what it holds under it. */
export function SerumSection({ title, aside, children, label, testId }: { title: string; aside?: ReactNode; children: ReactNode; label: string; testId?: string }) {
  return (
    <section className="px-3 pt-4" aria-label={label} data-testid={testId}>
      <div className="mb-2 flex h-5 items-center gap-2">
        <h3 className="text-[12px] font-medium text-[var(--serum-text)]">{title}</h3>
        <div className="ml-auto flex items-center gap-2">{aside}</div>
      </div>
      {children}
    </section>
  );
}
