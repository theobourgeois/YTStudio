import { useEffect } from "react";
import { Loader2 } from "lucide-react";
import { Header } from "@/components/header/header";
import { Inspector } from "@/components/inspector/inspector";
import { MediaBin } from "@/components/media/media-bin";
import { Preview } from "@/components/preview/preview";
import { Timeline } from "@/components/timeline/timeline";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { usePreventFileNavigation } from "@/hooks/use-prevent-file-navigation";
import { useShortcuts } from "@/hooks/use-shortcuts";
import { useEditor } from "@/stores/editor";

export default function App() {
  const loaded = useEditor((s) => s.loaded);
  const loadError = useEditor((s) => s.loadError);

  useEffect(() => {
    void useEditor.getState().init();
  }, []);
  useShortcuts();
  usePreventFileNavigation();

  return (
    <TooltipProvider delayDuration={400}>
      {loaded ? (
        <div className="flex h-full flex-col">
          <Header />
          <div className="flex min-h-0 flex-1">
            <MediaBin />
            <Preview />
            <Inspector />
          </div>
          <Timeline />
        </div>
      ) : (
        <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
          {loadError ? (
            <p>Couldn't reach the editor server: {loadError}. Is `pnpm dev` running?</p>
          ) : (
            <Loader2 className="size-5 animate-spin" />
          )}
        </div>
      )}
      <Toaster position="bottom-right" />
    </TooltipProvider>
  );
}
