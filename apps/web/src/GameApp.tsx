import { lazy, Suspense, useEffect } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { EventAccessGate } from "./access/EventAccessGate.js";
import { AuthProvider } from "./auth/AuthContext.js";
import { StyleScreen } from "./screens/StyleScreen.js";
import { SolanaProviders } from "./solana/WalletProvider.js";
import { Footer } from "./ui/Footer.js";
import { Loading } from "./ui/Loading.js";
import { Masthead } from "./ui/Masthead.js";

const ArenaScreen = lazy(() =>
  import("./screens/ArenaScreen.js").then((module) => ({ default: module.ArenaScreen })),
);
const LeaderboardScreen = lazy(() =>
  import("./screens/LeaderboardScreen.js").then((module) => ({ default: module.LeaderboardScreen })),
);
const SpectatorScreen = lazy(() =>
  import("./screens/SpectatorScreen.js").then((module) => ({ default: module.SpectatorScreen })),
);
const SummaryScreen = lazy(() =>
  import("./screens/SummaryScreen.js").then((module) => ({ default: module.SummaryScreen })),
);
const PayoutScreen = lazy(() =>
  import("./screens/PayoutScreen.js").then((module) => ({ default: module.PayoutScreen })),
);
const Cs2LobbyScreen = lazy(() =>
  import("./cs2/Cs2LobbyScreen.js").then((module) => ({ default: module.Cs2LobbyScreen })),
);
const Cs2ArenaScreen = lazy(() =>
  import("./cs2/Cs2ArenaScreen.js").then((module) => ({ default: module.Cs2ArenaScreen })),
);
const Cs2SeriesScreen = lazy(() =>
  import("./cs2/Cs2SeriesScreen.js").then((module) => ({ default: module.Cs2SeriesScreen })),
);

export function GameApp() {
  useEffect(() => {
    window.document.title = "SABG — Live esports prediction game";
  }, []);

  return (
    <EventAccessGate>
      <SolanaProviders>
        <AuthProvider>
          <div className="nb-shell">
            <Masthead />
            <main className="nb-main">
              <Suspense fallback={<Loading />}>
                <Routes>
                  <Route path="/" element={<Cs2LobbyScreen />} />
                  <Route path="/style" element={<StyleScreen />} />
                  <Route path="/arena/:arenaId" element={<ArenaScreen />} />
                  <Route path="/arena/:arenaId/leaderboard" element={<LeaderboardScreen />} />
                  <Route path="/arena/:arenaId/spectate" element={<SpectatorScreen />} />
                  <Route path="/arena/:arenaId/summary" element={<SummaryScreen />} />
                  <Route path="/arena/:arenaId/payout" element={<PayoutScreen />} />
                  <Route path="/cs2" element={<Cs2LobbyScreen />} />
                  <Route path="/cs2/series/:seriesId" element={<Cs2SeriesScreen />} />
                  <Route path="/cs2/arena/:arenaId" element={<Cs2ArenaScreen />} />
                  <Route path="*" element={<Navigate to="/" replace />} />
                </Routes>
              </Suspense>
            </main>
            <Footer />
          </div>
        </AuthProvider>
      </SolanaProviders>
    </EventAccessGate>
  );
}
