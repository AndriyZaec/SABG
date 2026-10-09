import { Link, useLocation } from "react-router-dom";
import { SignInPanel } from "../auth/SignInPanel.js";

/** Sticky top bar framing every screen: brand lockup + wallet sign-in. */
export function Masthead() {
  const { pathname } = useLocation();
  const isMatchScreen = pathname.startsWith("/arena/") ||
    pathname.startsWith("/cs2/arena/") || pathname.startsWith("/cs2/series/");

  return (
    <header className={`nb-masthead${isMatchScreen ? " nb-masthead--match" : ""}`}>
      <Link to="/" className="nb-brand" aria-label="SABG — Sports Arena Battle Ground">
        <span className="nb-brand__logo">SABG</span>
      </Link>
      <SignInPanel />
    </header>
  );
}
