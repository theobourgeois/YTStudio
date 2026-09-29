import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { SHORTCUT_GROUPS } from "@/hooks/shortcuts";
import { useLayout } from "@/stores/layout";

/** Cheat sheet of every keyboard shortcut (opened with `?` or the timeline toolbar). */
export function ShortcutsDialog() {
  const open = useLayout((s) => s.shortcutsOpen);
  return (
    <Dialog open={open} onOpenChange={(o) => useLayout.getState().setShortcutsOpen(o)}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl [scrollbar-width:thin]">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>Right-click clips, tracks and empty timeline space for more.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-x-8 gap-y-5 sm:grid-cols-2">
          {SHORTCUT_GROUPS.map((group) => (
            <section key={group.title} className="space-y-1.5">
              <h3 className="text-xs font-medium text-muted-foreground">{group.title}</h3>
              <dl className="space-y-1">
                {group.items.map((item) => (
                  <div key={item.label} className="flex items-center justify-between gap-3 text-sm">
                    <dt className="min-w-0">{item.label}</dt>
                    <dd className="flex shrink-0 flex-wrap justify-end gap-1">
                      {item.keys.map((k) => (
                        <kbd
                          key={k}
                          className="rounded border bg-muted px-1.5 font-sans text-[11px] leading-5 text-muted-foreground"
                        >
                          {k}
                        </kbd>
                      ))}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
