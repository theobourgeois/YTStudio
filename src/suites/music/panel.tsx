import type { ReactNode } from "react";

/**
 * A panel of the music editor (the channel rack; later the piano roll, the mixer, the playlist), as a
 * window with a title bar. Panels are docked for now; they're framed this way so that one day they
 * can float and be arranged like FL Studio's windows, without their contents changing.
 */
export function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="w-fit max-w-full rounded-xl border bg-card shadow-sm" aria-label={title}>
      <h2 className="border-b px-3 py-1.5 text-xs font-medium text-muted-foreground">{title}</h2>
      <div className="p-3">{children}</div>
    </section>
  );
}
