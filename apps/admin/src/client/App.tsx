import { useEffect, useState } from "react";
import { BrowserRouter, Navigate, NavLink, Route, Routes } from "react-router-dom";
import type { AdminSessionResponse } from "../shared/session.js";
import { logout, readSession } from "./api.js";
import { AuditPage } from "./AuditPage.js";
import { CatalogPage } from "./CatalogPage.js";
import { OverviewPage } from "./OverviewPage.js";
import { PublishPage } from "./PublishPage.js";
import { formatUpdatedAt, useControlStatus } from "./useControlStatus.js";

type SessionState =
  | { state: "loading" }
  | { state: "guest" }
  | { state: "failed" }
  | { state: "authenticated"; session: AdminSessionResponse };

const routes = [
  { path: "/", label: "Overview", detail: "Runtime state" },
  { path: "/catalog", label: "Catalog", detail: "Series controls" },
  { path: "/publish", label: "Publish", detail: "Tournament switch" },
  { path: "/audit", label: "Audit", detail: "Operator history" },
] as const;

function SignIn() {
  return (
    <main className="signin">
      <section className="signin__panel" aria-labelledby="signin-title">
        <div className="brand-lockup">
          <span className="brand-lockup__mark">SABG</span>
          <span className="brand-lockup__division">Operations</span>
        </div>
        <div className="signin__body">
          <p className="signin__context">Private operator console</p>
          <h1 id="signin-title">Control the event, not the infrastructure.</h1>
          <p>Sign in with an approved GitHub account to manage CS2 tournament operations.</p>
          <a className="primary-action" href="/auth/github">Continue with GitHub</a>
        </div>
        <div className="signin__foot">Authorized operators only</div>
      </section>
    </main>
  );
}

function LoadingScreen() {
  return (
    <main className="loading-screen" aria-live="polite">
      <span className="loading-screen__mark">SABG</span>
      <span>Opening operations console</span>
    </main>
  );
}

function ErrorScreen({ retry }: { retry: () => void }) {
  return (
    <main className="error-screen">
      <div>
        <span className="error-screen__code">Connection unavailable</span>
        <h1>The console could not verify your session.</h1>
        <p>Check the admin service and try again.</p>
        <button className="secondary-action" type="button" onClick={retry}>Try again</button>
      </div>
    </main>
  );
}

function Shell({ session, onSignedOut }: { session: AdminSessionResponse; onSignedOut: () => void }) {
  const [signingOut, setSigningOut] = useState(false);
  const [logoutFailed, setLogoutFailed] = useState(false);
  const control = useControlStatus(onSignedOut);

  const handleLogout = async () => {
    setSigningOut(true);
    setLogoutFailed(false);
    try {
      await logout(session);
      onSignedOut();
    } catch {
      setLogoutFailed(true);
      setSigningOut(false);
    }
  };

  return (
    <BrowserRouter>
      <div className="app-shell">
        <aside className="sidebar">
          <div className="brand-lockup brand-lockup--sidebar">
            <span className="brand-lockup__mark">SABG</span>
            <span className="brand-lockup__division">Operations</span>
          </div>
          <nav className="sidebar__nav" aria-label="Primary navigation">
            {routes.map((route) => (
              <NavLink key={route.path} to={route.path} end={route.path === "/"}>
                <span>{route.label}</span>
                <small>{route.detail}</small>
              </NavLink>
            ))}
          </nav>
          <div className="sidebar__foot">
            <span className="sidebar__status"><i /> Private console</span>
            <span>Live CS2 operations</span>
          </div>
        </aside>
        <div className="shell-main">
          <header className="operator-bar">
            <div className="runtime-strip">
              <span className="operator-bar__environment">{control.status?.appHealth === "healthy" ? "Control online" : "Control pending"}</span>
              <span><small>Tournament</small><strong>{control.status?.activeTournamentId ?? "—"}</strong></span>
              <span><small>Autopilot</small><strong>{control.status === undefined ? "—" : control.status.autopilotEnabled ? "On" : "Off"}</strong></span>
              <span><small>Running Series</small><strong>{control.status === undefined ? "—" : control.status.runningSeriesIds.length === 0 ? "None" : control.status.runningSeriesIds.length === 1 ? control.status.runningSeriesIds[0] : `${control.status.runningSeriesIds[0]} +${control.status.runningSeriesIds.length - 1}`}</strong></span>
              <span><small>Unfinished Arenas</small><strong>{control.status?.unfinishedArenaCount ?? "—"}</strong></span>
              <span className={control.stale ? "runtime-strip__freshness runtime-strip__freshness--stale" : "runtime-strip__freshness"}><small>State</small><strong>{control.status === undefined ? "Connecting" : formatUpdatedAt(control.generatedAt, control.now)}</strong></span>
            </div>
            <div className="operator-bar__identity">
              <span>Signed in as <strong>@{session.operator.login}</strong></span>
              <button type="button" onClick={handleLogout} disabled={signingOut}>
                {signingOut ? "Signing out" : "Sign out"}
              </button>
            </div>
            {logoutFailed && <span className="operator-bar__error">Could not sign out</span>}
          </header>
          <main className="shell-content">
            <Routes>
              <Route path="/" element={<OverviewPage session={session} onSessionExpired={onSignedOut} control={control} />} />
              <Route path="/catalog" element={<CatalogPage session={session} onSessionExpired={onSignedOut} control={control} />} />
              <Route path="/publish" element={<PublishPage session={session} onSessionExpired={onSignedOut} control={control} />} />
              <Route path="/audit" element={<AuditPage onSessionExpired={onSignedOut} />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </main>
        </div>
      </div>
    </BrowserRouter>
  );
}

export function App() {
  const [session, setSession] = useState<SessionState>({ state: "loading" });

  const loadSession = () => {
    setSession({ state: "loading" });
    void readSession()
      .then((value) => setSession(value === undefined ? { state: "guest" } : { state: "authenticated", session: value }))
      .catch(() => setSession({ state: "failed" }));
  };

  useEffect(loadSession, []);

  if (session.state === "loading") return <LoadingScreen />;
  if (session.state === "failed") return <ErrorScreen retry={loadSession} />;
  if (session.state === "guest") return <SignIn />;
  return <Shell session={session.session} onSignedOut={() => setSession({ state: "guest" })} />;
}
