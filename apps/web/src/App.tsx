import { lazy, Suspense, useEffect } from "react";
import { BrowserRouter, Route, Routes, useLocation } from "react-router-dom";
import { trackPageView } from "./analytics/analytics.js";
import { ConsentBanner } from "./analytics/ConsentBanner.js";

const LegalRoute = lazy(() =>
  import("./legal/LegalRoute.js").then((module) => ({ default: module.LegalRoute })),
);
const GameApp = lazy(async () => {
  const { Buffer } = await import("buffer");
  globalThis.Buffer = globalThis.Buffer ?? Buffer;
  const module = await import("./GameApp.js");
  return { default: module.GameApp };
});

export function App() {
  return (
    <BrowserRouter>
      <PageViewTracker />
      <Suspense fallback={<AppLoading />}>
        <Routes>
          <Route path="/terms" element={<LegalRoute />} />
          <Route path="/privacy" element={<LegalRoute />} />
          <Route path="/cookies" element={<LegalRoute />} />
          <Route path="/*" element={<GameApp />} />
        </Routes>
      </Suspense>
      <ConsentBanner policyHref="/cookies" />
    </BrowserRouter>
  );
}

function PageViewTracker() {
  const { pathname, search } = useLocation();

  useEffect(() => {
    trackPageView(pathname, search);
  }, [pathname, search]);

  return null;
}

function AppLoading() {
  return (
    <main className="nb-access">
      <div className="nb-access__loading" role="status">
        <span className="nb-access__mark">SABG</span>
        <span>Loading SABG...</span>
      </div>
    </main>
  );
}
