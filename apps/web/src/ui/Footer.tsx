import { Link } from "react-router-dom";
import { analyticsEnabled, openConsentSettings } from "../analytics/analytics.js";

// Devnet program (mirrors @arena/contracts/onchain ARENA_PROGRAM_ID; hardcoded to keep the IDL out
// of the eager bundle). Linked to Solana Explorer so the on-chain claim is verifiable.
const PROGRAM_ID = "84o7QQ3vkGkm3D6wfaqEHxFN93p3Q2b6SFtfazzxZuxH";
const EXPLORER = `https://explorer.solana.com/address/${PROGRAM_ID}?cluster=devnet`;
const SHORT_ID = `${PROGRAM_ID.slice(0, 4)}…${PROGRAM_ID.slice(-4)}`;

export function Footer() {
  return (
    <footer className="nb-footer">
      <div className="nb-footer__cols">
        <div className="nb-footer__brand">
          <span className="nb-footer__logo">SABG</span>
          <p className="nb-footer__tag">Live esports survival games built around match predictions.</p>
          <div className="nb-footer__social">
            <a
              href="https://x.com/sabg_sol"
              target="_blank"
              rel="noreferrer"
              aria-label="SABG on X"
            >
              <span className="nb-footer__social-icon nb-footer__social-icon--x" aria-hidden="true" />
            </a>
            <a
              href="https://www.instagram.com/sabg_sol"
              target="_blank"
              rel="noreferrer"
              aria-label="SABG on Instagram"
            >
              <span
                className="nb-footer__social-icon nb-footer__social-icon--instagram"
                aria-hidden="true"
              />
            </a>
          </div>
        </div>

        <nav className="nb-footer__col" aria-label="Product">
          <span className="nb-footer__head">Product</span>
          <Link className="nb-footer__link" to="/">Arenas</Link>
          <a className="nb-footer__link" href={EXPLORER} target="_blank" rel="noreferrer">
            Program {SHORT_ID}
          </a>
          <span className="nb-footer__muted">Solana Devnet</span>
        </nav>

        <nav className="nb-footer__col" aria-label="Legal and support">
          <span className="nb-footer__head">Legal</span>
          <a className="nb-footer__link" href="/terms" target="_blank" rel="noreferrer">Terms</a>
          <a className="nb-footer__link" href="/privacy" target="_blank" rel="noreferrer">Privacy</a>
          <span className="nb-footer__pair">
            <a className="nb-footer__link" href="/cookies" target="_blank" rel="noreferrer">Cookies</a>
            {analyticsEnabled && (
              <>
                <span aria-hidden="true">/</span>
                <button type="button" className="nb-footer__link" onClick={openConsentSettings}>
                  Cookie settings
                </button>
              </>
            )}
          </span>
          <a className="nb-footer__link" href="mailto:support@sabg.fun">Support</a>
        </nav>
      </div>

    </footer>
  );
}
