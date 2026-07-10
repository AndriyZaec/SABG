import { Link } from "react-router-dom";
import { SignInPanel } from "../auth/SignInPanel.js";
import { EntryCard } from "../arena/EntryCard.js";

export function LobbyScreen() {
  return (
    <main style={{ padding: 24, display: "grid", gap: 20 }}>
      <h1>SABG — Lobby</h1>
      <SignInPanel />
      <EntryCard />
      <Link to="/arena/demo/payout">Winner / Payout →</Link>
    </main>
  );
}
