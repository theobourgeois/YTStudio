import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Shared building blocks so every inspector panel has the same rhythm. */

export function PanelHeader({ icon, title, subtitle }: { icon: ReactNode; title: string; subtitle: string }) {
  return (
    <header className="flex items-center gap-3 border-b px-4 py-3.5">
      {icon}
      <div className="min-w-0">
        <h2 className="truncate text-sm font-medium" title={title}>
          {title}
        </h2>
        <p className="truncate text-xs text-muted-foreground">{subtitle}</p>
      </div>
    </header>
  );
}

export function Section({
  title,
  aside,
  children,
  className,
}: {
  title?: string;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("space-y-3 border-b px-4 py-4 last:border-b-0", className)}>
      {title && (
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-medium text-muted-foreground">{title}</h3>
          {aside}
        </div>
      )}
      {children}
    </section>
  );
}

export function InfoRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="shrink-0 text-xs text-muted-foreground">{label}</dt>
      <dd className="min-w-0 truncate text-right text-sm tabular-nums">{children}</dd>
    </div>
  );
}

/** Pill-style option for a Radix ToggleGroup used as a segmented control. */
export const segmentItemClass =
  "h-7 flex-1 gap-1.5 rounded-[5px] px-2 text-xs text-muted-foreground hover:bg-transparent hover:text-foreground data-[state=on]:bg-background data-[state=on]:text-foreground data-[state=on]:shadow-sm dark:data-[state=on]:bg-accent [&_svg:not([class*='size-'])]:size-3.5";

export const segmentGroupClass = "w-full gap-0.5 rounded-md bg-muted p-0.5";
