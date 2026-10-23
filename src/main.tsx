import { StrictMode, Suspense, lazy } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";
import { loadApp } from "./lib/app";
import { exposeDesktopHooks } from "./lib/desktop";
import { trackKeyboardNavigation } from "./lib/focus-rings";
import { watchPageErrors } from "./lib/log";
import { useAppIcon } from "./stores/app-icon";

watchPageErrors();
exposeDesktopHooks();
trackKeyboardNavigation();

// The component gallery (src/gallery/), in development only: every control in every state, per theme.
const Gallery = import.meta.env.DEV && location.pathname === "/gallery" ? lazy(() => import("./gallery/gallery")) : null;

// Which app this is (Home, Settings and the menus show only its suites) is known before anything draws.
await loadApp();
void useAppIcon.getState().init(); // its own icon, in one of the apps

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
