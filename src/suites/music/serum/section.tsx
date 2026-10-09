import type { ReactNode } from "react";

/** A section of the sound's column: its title in small capitals, what it holds under it. */
export function SerumSection({ title, aside, children, label, testId }: { title: string; aside?: ReactNode; children: ReactNode; label: string; testId?: string }) {
  return (
    <section className="px-3 pt-3" aria-label={label} data-testid={testId}>
      <div className="mb-2 flex items-center gap-2">
        <h3 className="text-[10px] font-semibold tracking-[0.16em] text-[var(--serum-text-dim)]">{title}</h3>
        <span className="h-px flex-1 bg-gradient-to-r from-[var(--serum-edge)] to-transparent" />
        {aside}
      </div>
      {children}
    </section>
  );
}
