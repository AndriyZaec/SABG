import { Link } from "react-router-dom";
import { SignInPanel } from "../auth/SignInPanel.js";

/** Sticky top bar framing every screen: brand lockup + wallet sign-in. */
export function Masthead() {
  return (
    <header className="nb-masthead">
      <Link to="/" className="nb-brand" aria-label="SABG — Sports Arena Battle Ground">
        <span className="nb-brand__logo">SABG</span>
      </Link>
      <SignInPanel />
    </header>
  );
}
