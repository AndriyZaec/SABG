import { SignInPanel } from "../auth/SignInPanel.js";

export function LobbyScreen() {
  return (
    <main style={{ padding: 24 }}>
      <h1>SABG — Lobby</h1>
      <SignInPanel />
      <p>Match list, buy entry pass (Solana devnet).</p>
    </main>
  );
}
