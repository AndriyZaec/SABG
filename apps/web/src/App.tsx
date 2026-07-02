import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { LobbyScreen } from "./screens/LobbyScreen.js";
import { ArenaScreen } from "./screens/ArenaScreen.js";
import { LeaderboardScreen } from "./screens/LeaderboardScreen.js";
import { SpectatorScreen } from "./screens/SpectatorScreen.js";
import { SummaryScreen } from "./screens/SummaryScreen.js";
import { PayoutScreen } from "./screens/PayoutScreen.js";

// Screen map -> build plan frontend tracks:
//   F1 app shell + wallet connect (Андрій)      -> this shell
//   F2 Match Lobby + Entry Pass purchase (Андрій)-> LobbyScreen
//   F3 Live Arena + Prediction Card (Viktor)     -> ArenaScreen
//   F4 Leaderboard + Spectator + Summary (Viktor)-> Leaderboard/Spectator/Summary
//   F5 Winner / Payout (Андрій)                  -> PayoutScreen
export function App() {
  return (
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
  );
}
