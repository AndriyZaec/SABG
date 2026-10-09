import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { useAuth } from "./AuthContext.js";

/** Wallet connect + an account dropdown for the app session (sign-in / retry / out). */
export function SignInPanel() {
  const { connected, user, status, signIn, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onEsc);
    };
  }, [open]);

  return (
    <div className="nb-row nb-masthead__actions">
      <Link to="/guide" className="nb-masthead__guide" aria-label="Devnet guide" title="Devnet guide">
        <span className="nb-masthead__guide-label">Devnet guide</span>
        <svg className="nb-masthead__guide-icon" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 5v16M12 5C9 3 5 3 2 4v16c3-1 7-1 10 1M12 5c3-2 7-2 10-1v16c-3-1-7-1-10 1" />
        </svg>
      </Link>
      <WalletMultiButton />

      {connected && (
        <div className="nb-menu" ref={ref}>
          <button
            type="button"
            className={`nb-btn ${user ? "nb-btn--survive" : "nb-btn--plain"} nb-menu__trigger`}
            aria-label={user ? `Account: ${user.username}` : "Account"}
            title={user ? `Account: ${user.username}` : "Account"}
            aria-haspopup="menu"
            aria-expanded={open}
            onClick={() => setOpen((o) => !o)}
          >
            <span className="nb-menu__label">{user ? user.username : "Account"}</span>
            <svg className="nb-menu__icon" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="12" cy="8" r="4" />
              <path d="M4 21v-2a8 8 0 0 1 16 0v2" />
            </svg>
            <span className="nb-menu__caret">▾</span>
          </button>

          {open && (
            <div className="nb-menu__panel" role="menu">
              {!user && (
                <button
                  type="button"
                  role="menuitem"
                  className="nb-menu__item"
                  onClick={() => {
                    setOpen(false);
                    void signIn();
                  }}
                >
                  {status === "error" ? "Retry sign-in" : "Sign in"}
                </button>
              )}
              {user && (
                <button
                  type="button"
                  role="menuitem"
                  className="nb-menu__item"
                  onClick={() => {
                    setOpen(false);
                    signOut();
                  }}
                >
                  Sign out
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
