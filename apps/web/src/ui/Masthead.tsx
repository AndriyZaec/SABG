import { Link } from "react-router-dom";
import { SignInPanel } from "../auth/SignInPanel.js";

/** Sticky top bar framing every screen: wordmark + tagline + wallet sign-in. */
export function Masthead() {
  return (
    <header className="nb-masthead">
      <Link to="/" className="nb-brand">
        <span className="nb-brand__logo">SABG</span>
        <span className="nb-brand__tag">Read the game · Survive the match</span>
      </Link>
      <SignInPanel />
    </header>
  );
}
