import { lazy, StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import "./styles/tokens.css";
import "./styles/app.css";

// Two pages from one build. Each is its own chunk, so opening the Gallery
// never downloads the room (Three.js, the physics, the crumple model or the
// fire), and opening the space never downloads the Gallery.
const isGallery = /^\/gallery\/?$/.test(window.location.pathname);
const Page = isGallery
  ? lazy(() => import("./GalleryApp.tsx").then((m) => ({ default: m.GalleryApp })))
  : lazy(() => import("./App.tsx").then((m) => ({ default: m.App })));

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Suspense fallback={null}>
      <Page />
    </Suspense>
  </StrictMode>,
);
