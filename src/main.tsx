import { StrictMode, Suspense, lazy } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";
import { exposeDesktopHooks } from "./lib/desktop";

exposeDesktopHooks();

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
