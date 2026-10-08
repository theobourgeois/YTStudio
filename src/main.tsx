import { StrictMode, Suspense, lazy } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";
import { exposeDesktopHooks } from "./lib/desktop";
import { trackKeyboardNavigation } from "./lib/focus-rings";
import { watchPageErrors } from "./lib/log";
import { useAppIcon } from "./stores/app-icon";

watchPageErrors();
exposeDesktopHooks();
trackKeyboardNavigation();
void useAppIcon.getState().init();

// The component gallery (src/gallery/), in development only: every control in every state, per theme.
const Gallery = import.meta.env.DEV && location.pathname === "/gallery" ? lazy(() => import("./gallery/gallery")) : null;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {Gallery ? (
      <Suspense>
        <Gallery />
      </Suspense>
    ) : (
      <App />
    )}
  </StrictMode>,
);
