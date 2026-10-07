import { useState } from "react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";

type WalletId = "phantom" | "solflare" | "backpack";

interface Shot {
  file: string;
  alt: string;
}

interface WalletGuide {
  name: string;
  downloadUrl: string;
  paths: readonly (readonly string[])[];
  shots: readonly Shot[];
}

const WALLETS: Record<WalletId, WalletGuide> = {
  phantom: {
    name: "Phantom",
    downloadUrl: "https://phantom.com/download",
    paths: [["Profile icon", "Settings", "Developer Settings", "Testnet Mode: On"]],
    shots: [
      { file: "phantom-profile-icon", alt: "Phantom profile icon in the top left corner" },
      { file: "phantom-settings", alt: "Phantom side panel with the settings gear at the bottom" },
      { file: "phantom-devnet-1", alt: "Developer Settings in the Phantom settings list" },
      { file: "phantom-devnet-2", alt: "Phantom Testnet Mode toggle" },
    ],
  },
  solflare: {
    name: "Solflare",
    downloadUrl: "https://solflare.com/download",
    paths: [["Settings icon", "General", "Network", "Devnet", "Continue"]],
    shots: [
      { file: "solflare-settings-icon", alt: "Solflare settings gear in the bottom right corner" },
      { file: "solflare-general", alt: "General in the Solflare settings" },
      { file: "solflare-general-network", alt: "Network inside the Solflare General settings" },
      { file: "solflare-network", alt: "Devnet in the Solflare network list" },
      { file: "solflare-devnet", alt: "Continue in the Switching to Devnet dialog" },
    ],
  },
  backpack: {
    name: "Backpack",
    downloadUrl: "https://backpack.app/downloads",
    paths: [
      ["Profile icon", "Settings", "Preferences", "Developer Mode: On"],
      ["Network button", "Add Network", "Solana Devnet", "Your wallet"],
    ],
    shots: [
      { file: "backpack-profile-icon", alt: "Backpack profile icon in the top left corner" },
      { file: "backpack-settings", alt: "Settings in the Backpack profile menu" },
      { file: "backpack-preferences", alt: "Preferences in the Backpack settings" },
      { file: "backpack-devnet-1", alt: "Backpack Developer Mode toggle" },
      { file: "backpack-network-button", alt: "Backpack network button next to the wallet name" },
      { file: "backpack-new-network", alt: "Add Network in the Backpack network menu" },
      { file: "backpack-select-network", alt: "Solana Devnet under For testing" },
      { file: "backpack-add-solana-devnet", alt: "Adding the existing wallet to Solana Devnet" },
    ],
  },
};

const WALLET_IDS: readonly WalletId[] = ["phantom", "solflare", "backpack"];

const SIGN_IN_SHOTS: readonly (Shot & { caption: string })[] = [
  { file: "main-select-wallet", alt: "Select Wallet in the SABG header", caption: "SABG" },
  { file: "main-choose-wallet", alt: "Wallet list in the SABG connect dialog", caption: "SABG" },
  { file: "wallet-connect", alt: "Connect request in the wallet", caption: "Solflare extension" },
  { file: "main-sign-in", alt: "Account menu with Sign in in the SABG header", caption: "SABG" },
  { file: "wallet-sign-in", alt: "Sign-in message with Approve in the wallet", caption: "Solflare extension" },
];

const LOOP = [
  { title: "Buy in", text: "0.1 SOL into the pool" },
  { title: "Answer", text: "Yes / No on live rounds" },
  { title: "Survive", text: "Stay in as others drop" },
  { title: "Take the pool", text: "Survivors split it" },
];

const QUESTIONS = ["Will Team NAVI win this round?", "Will there be a kill with AWP this round?"];

function GuideShot({ file, alt, caption }: Shot & { caption: string }) {
  return (
    <figure className="guide-shot">
      <a className="guide-shot__frame" href={`/guide-shots/${file}.webp`} target="_blank" rel="noreferrer">
        <img src={`/guide-shots/${file}.webp`} alt={alt} loading="lazy" />
      </a>
      <figcaption>{caption}</figcaption>
    </figure>
  );
}

function GuidePath({ steps }: { steps: readonly string[] }) {
  return (
    <ol className="guide-path">
      {steps.map((step) => <li key={step}>{step}</li>)}
    </ol>
  );
}

function GuideStep({ num, title, accent, children }: { num: number; title: string; accent?: boolean; children: ReactNode }) {
  return (
    <li className={`nb-panel guide-step${accent ? " guide-step--accent" : ""}`}>
      <div className="guide-step__num">{num}</div>
      <div className="guide-step__body">
        <div className="guide-step__head"><h2>{title}</h2></div>
        {children}
      </div>
    </li>
  );
}

/** Static walkthrough for new players: wallet, devnet, faucet SOL, sign-in, game rules. */
export function GuideScreen() {
  const [walletId, setWalletId] = useState<WalletId>("phantom");
  const wallet = WALLETS[walletId];

  return (
    <div className="nb-container">
      <section className="guide-hero">
        <span className="nb-label">Devnet guide</span>
        <h1>Ready your wallet</h1>
        <p className="guide-hero__lede">SABG runs on Solana devnet with free test SOL.</p>
        <p className="guide-hero__asof">Guide as of October 2026. Wallet screens may look different after updates.</p>
        <div className="guide-hero__chips">
          <span className="nb-badge nb-badge--live">Devnet only</span>
          <span className="nb-badge nb-badge--survive">Free test SOL</span>
        </div>
      </section>

      <div className="guide-picker">
        <span className="nb-label">Your wallet</span>
        <div className="guide-tabs" role="tablist" aria-label="Wallet">
          {WALLET_IDS.map((id) => (
            <button
              key={id}
              type="button"
              role="tab"
              className="guide-tab"
              aria-selected={id === walletId}
              onClick={() => setWalletId(id)}
            >
              {WALLETS[id].name}
            </button>
          ))}
        </div>
      </div>

      <ol className="guide-steps">
        <GuideStep num={1} title="Install a wallet">
          <p>
            <a className="nb-btn nb-btn--plain" href={wallet.downloadUrl} target="_blank" rel="noreferrer">
              Download {wallet.name} ↗
            </a>
          </p>
          <p className="guide-warn">Never share your recovery phrase.</p>
        </GuideStep>

        <GuideStep num={2} title="Switch to devnet">
          {wallet.paths.map((path) => <GuidePath key={path.join()} steps={path} />)}
          <div className="guide-shots">
            {wallet.shots.map((shot) => (
              <GuideShot key={shot.file} {...shot} caption={`${wallet.name} extension`} />
            ))}
          </div>
        </GuideStep>

        <GuideStep num={3} title="Get devnet SOL">
          <GuidePath steps={["1 devnet", "2 Paste address", "3 1 SOL", "4 Confirm Airdrop"]} />
          <div className="guide-shots">
            <GuideShot file="faucet" alt="Solana faucet form with the four steps numbered" caption="faucet.solana.com" />
          </div>
          <div className="guide-amounts">
            <div><span className="nb-label">Arena entry</span><strong>0.1 SOL</strong></div>
            <div><span className="nb-label">Network fee</span><strong>&lt; 0.01</strong></div>
            <div><span className="nb-label">Request</span><strong>1 SOL</strong></div>
          </div>
          <p>
            <a className="nb-btn nb-btn--primary" href="https://faucet.solana.com" target="_blank" rel="noreferrer">
              Open faucet.solana.com ↗
            </a>
          </p>
        </GuideStep>

        <GuideStep num={4} title="Connect & sign in">
          <GuidePath steps={["Select Wallet", "Pick your wallet", "Connect"]} />
          <GuidePath steps={["Account", "Sign in", "Approve"]} />
          <div className="guide-shots">
            {SIGN_IN_SHOTS.map((shot) => <GuideShot key={shot.file} {...shot} />)}
          </div>
          <p className="guide-note">Free signature, not a payment.</p>
        </GuideStep>

        <GuideStep num={5} title="How the game works" accent>
          <div className="guide-loop">
            {LOOP.map((item) => (
              <div key={item.title}><b>{item.title}</b><span>{item.text}</span></div>
            ))}
          </div>
          <div className="guide-shots">
            <div className="guide-example">
              <span className="nb-label">Example questions</span>
              <ul className="guide-questions">
                {QUESTIONS.map((question) => (
                  <li key={question}>
                    {question}
                    <span><span className="nb-badge nb-badge--survive">Yes</span><span className="nb-badge">No</span></span>
                  </li>
                ))}
              </ul>
            </div>
            <GuideShot file="arena-question" alt="Live arena question with Yes and No buttons" caption="SABG" />
          </div>
        </GuideStep>
      </ol>

      <div className="guide-cta">
        <Link className="nb-btn nb-btn--primary nb-btn--lg" to="/">Go to the matchday →</Link>
      </div>
    </div>
  );
}
