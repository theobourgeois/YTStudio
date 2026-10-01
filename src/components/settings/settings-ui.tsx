import type { ReactNode } from "react";
import { cn } from "cn";

/**
 * What every section of Settings is made of, so the app's and each suite's read alike: groups with a
 * heading, and in each a card of rows, a label and what it does on the left and its control on the right.
 */
export function SettingsGroup({
  title,
  description,
  bare,
  children,
  className,
  ...props
}: {
  title: string;
  description?: ReactNode;
  /** Its children as they are, not in a card of rows (a panel that has cards of its own). */
  bare?: boolean;
  children: ReactNode;
  className?: string;
} & React.ComponentProps<"section">) {
  return (
    <section aria-label={title} className={cn("flex flex-col gap-2", className)} {...props}>
      <div className="px-1">
        <h2 className="text-[13px] font-semibold">{title}</h2>
        {description && <p className="text-xs leading-5 text-muted-foreground">{description}</p>}
      </div>
      {bare ? children : <div className="flex flex-col divide-y divide-line rounded-md border border-line bg-card">{children}</div>}
    </section>
  );
}

/** One setting: its name and a line on what it does, and its control. */
export function SettingsRow({ title, description, children, className }: { title: ReactNode; description?: ReactNode; children?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex min-h-14 items-center gap-6 px-4 py-3", className)}>
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-medium">{title}</div>
        {description && <div className="mt-0.5 text-xs leading-5 text-muted-foreground">{description}</div>}
      </div>
      {children && <div className="flex shrink-0 items-center gap-2">{children}</div>}
    </div>
  );
}

/** Room in a group for something wider than a row's control (the theme picker, a plugin bench). */
export function SettingsBlock({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("px-4 py-4", className)}>{children}</div>;
}
