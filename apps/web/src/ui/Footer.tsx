const STEPS = ["Buy in", "Answer Yes / No", "Survive", "Take the pool"];

// Devnet program (mirrors @arena/contracts/onchain ARENA_PROGRAM_ID; hardcoded to keep the IDL out
// of the eager bundle). Linked to Solana Explorer so the on-chain claim is verifiable.
const PROGRAM_ID = "84o7QQ3vkGkm3D6wfaqEHxFN93p3Q2b6SFtfazzxZuxH";
const EXPLORER = `https://explorer.solana.com/address/${PROGRAM_ID}?cluster=devnet`;
const SHORT_ID = `${PROGRAM_ID.slice(0, 4)}…${PROGRAM_ID.slice(-4)}`;

/** Real page footer: brand, the game loop (muted), and the verifiable on-chain program. */
export function Footer() {
  return (
    <footer className="nb-footer">
      <div className="nb-footer__cols">
        <div className="nb-footer__brand">
          <span className="nb-footer__logo">SABG</span>
          <p className="nb-footer__tag">Read the game. Survive the match.</p>
          {/* placeholder handles — wire real profiles later */}
          <div className="nb-footer__social">
            <a href="#" aria-label="SABG on X">X</a>
            <a href="#" aria-label="SABG on Discord">Discord</a>
            <a href="#" aria-label="SABG on GitHub">GitHub</a>
          </div>
        </div>

        <div className="nb-footer__col">
          <span className="nb-footer__head">How it works</span>
          <ol className="nb-footer__steps">
            {STEPS.map((s, i) => (
              <li key={s}>
                <span className="nb-footer__num">{i + 1}</span>
                {s}
              </li>
            ))}
          </ol>
        </div>

        <div className="nb-footer__col">
          <span className="nb-footer__head">On-chain</span>
          <a className="nb-footer__link" href={EXPLORER} target="_blank" rel="noreferrer">
            Program {SHORT_ID} ↗
          </a>
          <div className="nb-footer__badges">
            <span className="nb-footer__badge nb-footer__badge--solana">Solana</span>
            <span className="nb-footer__badge">Devnet</span>
          </div>
        </div>
      </div>

      <div className="nb-footer__bar">
        <span>© 2026 SABG · Fan Battle Royale</span>
        <span>Read the game. Survive the match.</span>
      </div>
    </footer>
  );
}
