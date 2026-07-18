import { createContext, type FormEvent, type ReactNode, useContext, useEffect, useState } from "react";
import {
  EVENT_ACCESS_REQUIRED_EVENT,
  fetchEventAccessSession,
  signInToEvent,
  signOutOfEvent,
} from "../api/client.js";

type AccessState =
  | { status: "loading" }
  | { status: "locked"; error?: "invalid" | "rate_limited" | "unavailable" }
  | { status: "open"; required: boolean };

interface EventAccessContextValue {
  required: boolean;
  signOut: () => Promise<void>;
}

const EventAccessContext = createContext<EventAccessContextValue | null>(null);

export function useEventAccess(): EventAccessContextValue {
  const value = useContext(EventAccessContext);
  if (value === null) throw new Error("useEventAccess must be used inside EventAccessGate");
  return value;
}

export function EventAccessGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AccessState>({ status: "loading" });

  const checkSession = () => {
    setState({ status: "loading" });
    void fetchEventAccessSession()
      .then((session) => {
        switch (session.status) {
          case "not_required":
            setState({ status: "open", required: false });
            break;
          case "authenticated":
            setState({ status: "open", required: true });
            break;
          case "unauthenticated":
            setState({ status: "locked" });
            break;
        }
      })
      .catch(() => setState({ status: "locked", error: "unavailable" }));
  };

  useEffect(() => {
    checkSession();
    const requireAccess = () => setState({ status: "locked" });
    window.addEventListener(EVENT_ACCESS_REQUIRED_EVENT, requireAccess);
    return () => window.removeEventListener(EVENT_ACCESS_REQUIRED_EVENT, requireAccess);
  }, []);

  if (state.status === "loading") return <AccessLoading />;
  if (state.status === "locked") {
    return <AccessScreen initialError={state.error} onAccess={() => setState({ status: "open", required: true })} onRetry={checkSession} />;
  }

  const signOut = async () => {
    try {
      await signOutOfEvent();
      setState({ status: "locked" });
    } catch {
      // Keep the current session visible if the server could not clear it.
    }
  };

  return (
    <EventAccessContext.Provider value={{ required: state.required, signOut }}>
      {children}
    </EventAccessContext.Provider>
  );
}

function AccessLoading() {
  return (
    <main className="nb-access">
      <div className="nb-access__loading" role="status">
        <span className="nb-access__mark">SABG</span>
        <span>Checking your pass...</span>
      </div>
    </main>
  );
}

function AccessScreen({
  initialError,
  onAccess,
  onRetry,
}: {
  initialError?: "invalid" | "rate_limited" | "unavailable";
  onAccess: () => void;
  onRetry: () => void;
}) {
  const [code, setCode] = useState("");
  const [error, setError] = useState(initialError);
  const [submitting, setSubmitting] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (code.length === 0 || submitting) return;
    setSubmitting(true);
    setError(undefined);
    try {
      const result = await signInToEvent(code);
      if (result.ok) {
        onAccess();
        return;
      }
      setError(result.reason);
      setCode("");
    } catch {
      setError("unavailable");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="nb-access">
      <div className="nb-access__court" aria-hidden="true" />
      <section className="nb-access__ticket" aria-labelledby="access-title">
        <header className="nb-access__ticket-head">
          <span className="nb-access__mark">SABG</span>
          <span className="nb-access__admit">Private event</span>
        </header>
        <div className="nb-access__ticket-body">
          <p className="nb-access__eyebrow">Matchday access</p>
          <h1 id="access-title">Enter the arena</h1>
          <p className="nb-access__intro">Use the event code from your invite. Your wallet stays separate and connects inside.</p>

          {error === "unavailable" ? (
            <div className="nb-access__error" role="alert">
              The entrance is temporarily unavailable.
              <button className="nb-access__text-button" type="button" onClick={onRetry}>Try again</button>
            </div>
          ) : (
            <form className="nb-access__form" onSubmit={submit}>
              <label htmlFor="event-code">Event code</label>
              <input
                id="event-code"
                name="event-code"
                type="password"
                autoComplete="current-password"
                autoFocus
                value={code}
                onChange={(event) => setCode(event.target.value)}
                aria-describedby={error ? "event-code-error" : undefined}
              />
              {error && (
                <p className="nb-access__error" id="event-code-error" role="alert">
                  {error === "rate_limited" ? "Too many attempts. Try again in 15 minutes." : "That code does not match. Check your invite and try again."}
                </p>
              )}
              <button className="nb-btn nb-btn--primary nb-btn--lg nb-btn--block" type="submit" disabled={code.length === 0 || submitting}>
                {submitting ? "Checking..." : "Enter event"}
              </button>
            </form>
          )}
        </div>
        <footer className="nb-access__ticket-foot">
          <span>One code</span><span>Seven-day pass</span><span>Devnet event</span>
        </footer>
      </section>
    </main>
  );
}
