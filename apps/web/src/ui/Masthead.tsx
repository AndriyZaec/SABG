import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { RuntimeConfigResponse } from "@arena/contracts";
import { SignInPanel } from "../auth/SignInPanel.js";
import { fetchRuntimeConfig } from "../api/client.js";
import { Badge } from "./Badge.js";
import { useEventAccess } from "../access/EventAccessGate.js";

/** Sticky top bar framing every screen: brand lockup + wallet sign-in. */
export function Masthead() {
  const eventAccess = useEventAccess();
  const [runtime, setRuntime] = useState<RuntimeConfigResponse | null>(null);

  useEffect(() => {
    let active = true;
    void fetchRuntimeConfig()
      .then((config) => {
        if (active) setRuntime(config);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  return (
    <header className="nb-masthead">
      <Link to="/" className="nb-brand" aria-label="SABG — Sports Arena Battle Ground">
        <span className="nb-brand__logo">SABG</span>
      </Link>
      {runtime !== null && (
        <Badge tone={runtime.gameSource === "live" ? "live" : "neutral"}>{runtime.sourceLabel}</Badge>
      )}
      {eventAccess.required && (
        <button className="nb-masthead__exit" type="button" onClick={() => void eventAccess.signOut()}>
          Leave event
        </button>
      )}
      <SignInPanel />
    </header>
  );
}
