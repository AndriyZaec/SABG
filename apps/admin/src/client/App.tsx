import { useEffect, useState } from "react";
import { BrowserRouter, Navigate, NavLink, Route, Routes } from "react-router-dom";
import type { AdminSessionResponse } from "../shared/session.js";
import { logout, readSession } from "./api.js";
import { OverviewPage } from "./OverviewPage.js";

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

const pageCopy = {
  overview: {
    title: "Overview",
    description: "Monitor the active tournament, application state, and autopilot from one control surface.",
  },
  catalog: {
    title: "Series catalog",
    description: "Review active Series and make deliberate changes to priority and stream configuration.",
  },
  publish: {
    title: "Publish tournament",
    description: "Inspect GRID candidates and switch the active tournament through the guarded publication flow.",
  },
  audit: {
    title: "Operator audit",
    description: "Trace state-changing commands, their actor, target, and final result.",
  },
} as const;

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

function PlaceholderPage({ page }: { page: keyof typeof pageCopy }) {
  const copy = pageCopy[page];
  return (
    <section className="page">
      <header className="page__header">
        <div>
          <h1>{copy.title}</h1>
          <p>{copy.description}</p>
        </div>
        <span className="page__phase">Controls arrive in Phase 5</span>
      </header>
      <div className="workspace-placeholder">
        <div className="workspace-placeholder__rule" />
        <div>
          <h2>Workspace ready</h2>
          <p>The secure route and application shell are in place. Operational data will be connected next.</p>
        </div>
      </div>
    </section>
  );
}

function Shell({ session, onSignedOut }: { session: AdminSessionResponse; onSignedOut: () => void }) {
  const [signingOut, setSigningOut] = useState(false);
  const [logoutFailed, setLogoutFailed] = useState(false);

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
            <span>CS2 event operations</span>
          </div>
        </aside>
        <div className="shell-main">
          <header className="operator-bar">
            <span className="operator-bar__environment">Internal tool</span>
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
              <Route path="/" element={<OverviewPage session={session} onSessionExpired={onSignedOut} />} />
              <Route path="/catalog" element={<PlaceholderPage page="catalog" />} />
              <Route path="/publish" element={<PlaceholderPage page="publish" />} />
              <Route path="/audit" element={<PlaceholderPage page="audit" />} />
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
