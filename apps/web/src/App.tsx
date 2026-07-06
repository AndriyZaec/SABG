import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { SolanaProviders } from "./solana/WalletProvider.js";
import { LobbyScreen } from "./screens/LobbyScreen.js";
import { ArenaScreen } from "./screens/ArenaScreen.js";
import { LeaderboardScreen } from "./screens/LeaderboardScreen.js";
import { SpectatorScreen } from "./screens/SpectatorScreen.js";
import { SummaryScreen } from "./screens/SummaryScreen.js";
import { PayoutScreen } from "./screens/PayoutScreen.js";

export function App() {
  return (
    <SolanaProviders>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<LobbyScreen />} />
          <Route path="/arena/:arenaId" element={<ArenaScreen />} />
          <Route path="/arena/:arenaId/leaderboard" element={<LeaderboardScreen />} />
          <Route path="/arena/:arenaId/spectate" element={<SpectatorScreen />} />
          <Route path="/arena/:arenaId/summary" element={<SummaryScreen />} />
          <Route path="/arena/:arenaId/payout" element={<PayoutScreen />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </SolanaProviders>
  );
}
