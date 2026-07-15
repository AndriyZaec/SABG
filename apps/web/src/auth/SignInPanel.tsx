import { useEffect, useRef, useState } from "react";
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
    <div className="nb-row" style={{ gap: 10 }}>
      <WalletMultiButton />

      {connected && (
        <div className="nb-menu" ref={ref}>
          <button
            type="button"
            className={`nb-btn ${user ? "nb-btn--survive" : "nb-btn--plain"} nb-menu__trigger`}
            aria-haspopup="menu"
            aria-expanded={open}
            onClick={() => setOpen((o) => !o)}
          >
            {user ? user.username : "Account"}
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
