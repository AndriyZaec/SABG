import { lazy, Suspense } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { SolanaProviders } from "./solana/WalletProvider.js";
import { AuthProvider } from "./auth/AuthContext.js";
import { LobbyScreen } from "./screens/LobbyScreen.js";
import { StyleScreen } from "./screens/StyleScreen.js";
import { Masthead } from "./ui/Masthead.js";
import { Footer } from "./ui/Footer.js";
import { Loading } from "./ui/Loading.js";

// Landing (Lobby) loads eagerly; heavier in-arena screens are split out.
const ArenaScreen = lazy(() =>
  import("./screens/ArenaScreen.js").then((m) => ({ default: m.ArenaScreen })),
);
const LeaderboardScreen = lazy(() =>
  import("./screens/LeaderboardScreen.js").then((m) => ({ default: m.LeaderboardScreen })),
);
const SpectatorScreen = lazy(() =>
  import("./screens/SpectatorScreen.js").then((m) => ({ default: m.SpectatorScreen })),
);
const SummaryScreen = lazy(() =>
  import("./screens/SummaryScreen.js").then((m) => ({ default: m.SummaryScreen })),
);
const PayoutScreen = lazy(() =>
  import("./screens/PayoutScreen.js").then((m) => ({ default: m.PayoutScreen })),
);

export function App() {
  return (
    <SolanaProviders>
      <AuthProvider>
        <BrowserRouter>
          <div className="nb-shell">
          <Masthead />
          <main className="nb-main">
            <Suspense fallback={<Loading />}>
              <Routes>
                <Route path="/" element={<LobbyScreen />} />
                <Route path="/style" element={<StyleScreen />} />
                <Route path="/arena/:arenaId" element={<ArenaScreen />} />
                <Route path="/arena/:arenaId/leaderboard" element={<LeaderboardScreen />} />
                <Route path="/arena/:arenaId/spectate" element={<SpectatorScreen />} />
                <Route path="/arena/:arenaId/summary" element={<SummaryScreen />} />
                <Route path="/arena/:arenaId/payout" element={<PayoutScreen />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </Suspense>
          </main>
          <Footer />
          </div>
        </BrowserRouter>
      </AuthProvider>
    </SolanaProviders>
  );
}
