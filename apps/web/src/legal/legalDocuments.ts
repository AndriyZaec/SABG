export const LEGAL_VERSION = "1.0";
export const LEGAL_EFFECTIVE_DATE = "October 7, 2026";

export interface LegalSection {
  id: string;
  title: string;
  paragraphs: string[];
  bullets?: string[];
}

export interface LegalDocument {
  path: "/terms" | "/privacy" | "/cookies";
  navLabel: string;
  title: string;
  summary: string;
  noticeLabel: string;
  notice: string;
  sections: LegalSection[];
}

const terms: LegalDocument = {
  path: "/terms",
  navLabel: "Terms",
  title: "Terms of Use",
  summary:
    "These Terms govern access to SABG, including Arena entry, live predictions, settlement, refunds, and use of a self-custodial Solana wallet.",
  noticeLabel: "Risk notice",
  notice:
    "SABG is experimental software involving digital assets and irreversible blockchain transactions. You may lose your entire Arena entry. Use SABG only if you understand the risks and its use is lawful where you are located.",
  sections: [
    {
      id: "agreement",
      title: "1. Agreement and operator",
      paragraphs: [
        "These Terms of Use form an agreement between you and the SABG development team (SABG, we, us, or our). They apply to the SABG website, game interface, smart-contract interactions, APIs, and related services collectively referred to as the Service.",
        "By accepting these Terms before entering an Arena or by otherwise using a paid-entry feature, you confirm that you have read and agree to these Terms. If you do not agree, do not enter an Arena or use a paid feature.",
      ],
    },
    {
      id: "eligibility",
      title: "2. Eligibility and lawful use",
      paragraphs: [
        "You may use SABG only if you are at least 18 years old, have legal capacity to accept these Terms, and are permitted to use the Service under every law that applies to you.",
        "You must not use SABG if you are subject to applicable economic or trade sanctions, are acting for a sanctioned person, or if your use would violate any law, regulation, court order, or contractual duty. SABG does not represent that the Service is lawful or available in every jurisdiction. You are responsible for making that determination and for any tax obligations arising from your activity.",
      ],
    },
    {
      id: "service",
      title: "3. The Service and beta status",
      paragraphs: [
        "SABG is a beta live-event survival game. Participants answer time-limited yes-or-no questions about an event. Incorrect or missed answers may eliminate a participant. The participants who remain active when an Arena finishes share the distributable prize pool according to the Arena rules shown in the interface.",
        "SABG may change, pause, restrict, or discontinue features while the Service is developed. Features may contain errors or become unavailable. Nothing in the Service is investment, legal, financial, or tax advice, and SABG does not act as your broker, adviser, fiduciary, wallet custodian, or agent.",
      ],
    },
    {
      id: "wallet",
      title: "4. Wallets and account security",
      paragraphs: [
        "You interact with SABG through a compatible self-custodial Solana wallet. SABG does not receive or control your private keys or seed phrase and cannot recover, freeze, or restore your wallet. You are responsible for securing your wallet, reviewing every signature request, and confirming that the displayed network, amount, and destination are correct.",
        "A signed wallet message may be used to authenticate you. Signing an authentication message does not itself transfer assets. You are responsible for activity authenticated by your wallet unless applicable law provides otherwise. Contact support promptly if you believe your SABG session or wallet has been compromised.",
      ],
    },
    {
      id: "entry",
      title: "5. Arena entry",
      paragraphs: [
        "Each Arena displays its entry amount before you approve the transaction. Entry requires a compatible wallet, sufficient SOL for the entry and network costs, and successful confirmation on the selected Solana network. An entry is associated with the wallet that submits it and cannot be transferred through SABG.",
        "SABG may reject or fail to record an entry that is late, duplicated, malformed, submitted to the wrong network or address, not finalized, inconsistent with the Arena configuration, or connected to prohibited conduct. Do not treat an unconfirmed wallet prompt as a completed entry.",
      ],
    },
    {
      id: "gameplay",
      title: "6. Questions, event data, and results",
      paragraphs: [
        "Questions and settlement conditions are generated and evaluated off-chain using event data supplied by third parties. SABG applies the condition displayed for each question to the event data it receives. Delayed, corrected, incomplete, or unavailable event data may delay a question, void a round, cancel an Arena, or require operational review.",
        "If an Arena cannot safely resume after an interruption, open or locked rounds may be voided and the participants who were still active may be treated as winners. If no safe settlement is possible, SABG may cancel the Arena instead.",
        "The game result is determined off-chain. The Solana program handles entry funds, Arena state, refunds, and final payout execution; it does not independently determine the real-world event outcome or select winners.",
      ],
    },
    {
      id: "fees-payouts",
      title: "7. Platform fee and payouts",
      paragraphs: [
        "At settlement, SABG deducts a platform fee equal to 10% of the total Arena prize pool. The remaining 90% is the distributable prize pool and is divided among the winning wallets under the Arena rules. Where an exact equal division is not possible in lamports, a small integer remainder may be assigned as part of the settlement calculation.",
        "Payout depends on a valid result, resolvable winner wallets, Solana availability, and successful on-chain execution. Processing may be delayed by technical or network conditions. SABG does not guarantee an immediate payout or the fiat value of SOL. An executed on-chain payout is final and cannot be reversed by SABG.",
      ],
    },
    {
      id: "cancellation-refunds",
      title: "8. Cancellation and refunds",
      paragraphs: [
        "SABG may cancel an Arena when the underlying event does not proceed as expected, cannot be verified, is forfeited, becomes irrelevant to the scheduled Arena, is affected by a material technical failure, or cannot be settled fairly.",
        "For a cancelled on-chain Arena, the recorded entry amount is returned to the wallet that made the entry. The original Solana transaction fee, account rent, and any other network or wallet-provider cost are not part of the refund. Refund execution may take time and may require retrying while the network is unavailable.",
      ],
    },
    {
      id: "blockchain-risks",
      title: "9. Blockchain and technical risks",
      paragraphs: [
        "By using SABG, you accept risks including smart-contract defects, software errors, wallet compromise, phishing, incorrect signatures, front-end attacks, RPC failure, network congestion, transaction failure, protocol changes, loss of access, regulatory change, and volatility in SOL or other digital assets.",
        "Solana transactions and records are public and generally irreversible. SABG cannot delete public blockchain records or reverse a finalized entry, refund, or payout. Never provide a private key or seed phrase to SABG or to anyone claiming to represent SABG.",
      ],
    },
    {
      id: "conduct",
      title: "10. Prohibited conduct",
      paragraphs: [
        "You must use the Service fairly and lawfully. SABG may restrict access, reject activity, preserve evidence, or report conduct where reasonably necessary to protect users, the Service, or comply with law.",
      ],
      bullets: [
        "Do not manipulate an event, question, result, entry, payout, or another participant's access.",
        "Do not use inside information obtained through a duty of confidence when doing so is unlawful or unfairly compromises an Arena.",
        "Do not access another person's wallet or session, evade access controls, or impersonate another person.",
        "Do not introduce malware, disrupt the Service, exploit vulnerabilities, or probe systems without written authorization.",
        "Do not use bots, scraping, or automated play in a way that burdens the Service or creates an unfair advantage.",
        "Do not use SABG for fraud, money laundering, sanctions evasion, or any other unlawful purpose.",
      ],
    },
    {
      id: "third-parties",
      title: "11. Third-party services",
      paragraphs: [
        "SABG relies on services we do not control, including Solana and RPC infrastructure, wallet software, live-event data providers, browser push services, and optional video-stream providers. Those services may have their own terms, fees, availability, and privacy practices. SABG is not responsible for their independent acts, omissions, or availability.",
        "Links and embedded content do not imply sponsorship or endorsement. Event names, team names, logos, streams, and related material may belong to their respective owners.",
      ],
    },
    {
      id: "intellectual-property",
      title: "12. Intellectual property",
      paragraphs: [
        "SABG and its licensors retain their rights in the Service, software, interface, branding, and original content. Subject to these Terms, you receive a limited, personal, revocable, non-exclusive right to use the Service for its intended purpose. You may not copy, sell, sublicense, or commercially exploit SABG materials except as permitted by law or written permission.",
        "If you send feedback, you permit SABG to use it without restriction or payment, but you retain ownership of any rights you already hold in that feedback.",
      ],
    },
    {
      id: "disclaimers",
      title: "13. Disclaimers and liability",
      paragraphs: [
        "To the fullest extent permitted by applicable law, the Service is provided as is and as available. SABG disclaims implied warranties, including merchantability, fitness for a particular purpose, non-infringement, availability, security, and accuracy. We do not guarantee that event data, questions, results, interfaces, smart contracts, or third-party services will be uninterrupted or error-free.",
        "To the fullest extent permitted by applicable law, SABG and its contributors will not be liable for indirect, incidental, special, consequential, exemplary, or punitive loss, or for loss of profits, opportunity, data, goodwill, or digital assets arising from the Service. Nothing in these Terms excludes liability that cannot lawfully be excluded or limits rights that cannot lawfully be waived.",
      ],
    },
    {
      id: "support",
      title: "14. Settlement complaints and support",
      paragraphs: [
        "If you believe an Arena was settled incorrectly, email support@sabg.fun within seven calendar days after settlement. Include the Arena identifier, your wallet address, the outcome you dispute, and supporting information. SABG may review event data and operational records and correct off-chain records where appropriate.",
        "A support review is not a technical dispute window and does not suspend or reverse an on-chain transaction. Once payout has executed on Solana, SABG cannot recall or redistribute it through the existing transaction. General product support is also available at support@sabg.fun; legal notices may be sent to legal@sabg.fun.",
      ],
    },
    {
      id: "changes",
      title: "15. Changes and general terms",
      paragraphs: [
        "SABG may update these Terms as the Service, risks, or legal requirements change. The current version and effective date appear at the top of this page. A material change will require acceptance of the new version before a later paid entry; continued browsing alone does not replace that acceptance.",
        "If any provision is unenforceable, it will be limited to the minimum extent necessary and the remaining provisions will continue to apply. Failure to enforce a provision is not a waiver. These Terms and the policies linked here form the agreement about your use of the Service. No governing law, court forum, or arbitration procedure is designated in this version.",
      ],
    },
  ],
};

const privacy: LegalDocument = {
  path: "/privacy",
  navLabel: "Privacy",
  title: "Privacy Policy",
  summary:
    "This Policy explains what the SABG development team processes when you browse the app, connect a wallet, play an Arena, request notifications, or contact us.",
  noticeLabel: "Key point",
  notice:
    "A wallet address is pseudonymous, not anonymous. Your wallet and transaction activity may be permanently visible on Solana and can be linked with gameplay records.",
  sections: [
    {
      id: "scope",
      title: "1. Scope and responsibility",
      paragraphs: [
        "This Privacy Policy applies to the consumer-facing SABG Service operated by the SABG development team. It should be read with the Terms of Use and Cookie Policy. It does not govern independent wallet providers, Solana infrastructure, streaming platforms, or other third-party services.",
        "For privacy questions or requests, contact legal@sabg.fun. Depending on where you live, terms such as personal data or personal information may have specific legal meanings and you may have additional rights.",
      ],
    },
    {
      id: "information",
      title: "2. Information we process",
      paragraphs: [
        "SABG does not ask for your legal name, postal address, phone number, date of birth, payment-card details, private key, or seed phrase as part of ordinary gameplay. We process the information needed to authenticate wallets, run Arenas, execute transactions, provide notifications, secure the Service, and answer support requests.",
      ],
      bullets: [
        "Wallet and profile data: wallet address, an internal user identifier, generated public alias, and any optional profile fields offered by the Service.",
        "Authentication data: a nonce, the message you sign, its signature during verification, and a time-limited session token. The nonce is short-lived; the browser stores the resulting session locally.",
        "Gameplay data: Arenas joined, predictions, answer and receipt times, correctness, score, elimination status, rankings, winners, follows, and notification preferences.",
        "Transaction data: entry amount, Arena and escrow identifiers, transaction signatures, payment or refund status, payout amount and status, and related public blockchain records.",
        "Notification data: browser push endpoint and the cryptographic subscription values needed to deliver a requested notification.",
        "Technical and security data: IP address used for short-lived invite rate limiting, request and error details, browser or device information made available to our infrastructure, and operational logs.",
        "Communications: the email address, wallet address, transaction details, and other information you choose to include when contacting support or legal.",
      ],
    },
    {
      id: "sources",
      title: "3. Where information comes from",
      paragraphs: [
        "We receive information directly from you and your browser, from your connected wallet, from public Solana records, and from your interactions with the Service. We also receive event data from live-data providers and transaction status from Solana or RPC services.",
        "Wallet software may share the selected public address and signatures you approve. SABG does not receive your wallet private keys. Public blockchain data may also be indexed or enriched by unrelated third parties outside SABG's control.",
      ],
    },
    {
      id: "uses",
      title: "4. How we use information",
      paragraphs: [
        "We use information to provide and secure SABG, authenticate wallets, process Arena entry, record predictions, calculate game state, determine results, execute or reconcile payouts and refunds, show leaderboards, send requested notifications, diagnose failures, prevent abuse, answer support requests, enforce our Terms, and comply with legal obligations.",
        "Where applicable law requires a legal basis, processing may be necessary to provide the Service you request, for our legitimate interests in operating and protecting SABG, to comply with law, or based on your consent. You may withdraw consent where processing depends on it, without affecting earlier processing.",
      ],
    },
    {
      id: "visibility",
      title: "5. Public and participant-visible data",
      paragraphs: [
        "Solana is a public blockchain. Wallet addresses, transaction signatures, amounts, program accounts, entry records, refunds, and payouts recorded on-chain can be viewed, copied, and linked by anyone. SABG cannot modify or delete those records.",
        "Within the Service, other event participants may see generated aliases, rankings, scores, status, winners, join times, and settled gameplay information. Aggregate prediction percentages may be shown while an Arena is running. Do not use a wallet or alias that you expect to remain unlinked from your activity.",
      ],
    },
    {
      id: "sharing",
      title: "6. When information is disclosed",
      paragraphs: [
        "We do not sell personal information. Information may be disclosed to service providers and infrastructure operators only as needed to operate SABG, to professional advisers, during a reorganization of the Service, when you direct us to share it, or when reasonably necessary to comply with law, protect rights and safety, investigate abuse, or enforce the Terms.",
      ],
      bullets: [
        "Solana validators, RPC providers, and block explorers process public wallet and transaction data.",
        "Phantom, Solflare, or another wallet you choose processes wallet interactions under its own policy.",
        "GRID and TxOdds provide event data used by SABG; SABG does not provide them your wallet private key.",
        "Browser push services operated by Apple, Google, Microsoft, Mozilla, or another browser provider deliver notifications you request.",
        "Twitch, Kick, or YouTube may receive device, IP, request, and viewing data when an embedded stream loads.",
        "Google receives request information when the browser loads hosted fonts used by the interface.",
        "Hosting, database, security, email, and support providers may process information needed to supply those services.",
      ],
    },
    {
      id: "storage",
      title: "7. Cookies and browser storage",
      paragraphs: [
        "SABG uses an essential invite-access cookie and browser local storage for the wallet session, stream layout, and sound preference. The app also registers a service worker used for requested push notifications. These technologies and their current duration are described in the Cookie Policy.",
        "SABG does not currently run first-party advertising pixels, session replay, Google Analytics, or PostHog. Third-party wallets, streams, fonts, and browser services may process data under their own policies.",
      ],
    },
    {
      id: "retention",
      title: "8. Retention",
      paragraphs: [
        "We retain information for as long as reasonably necessary to operate and secure the Service, maintain transaction and game integrity, resolve disputes, enforce agreements, and meet legal obligations. Retention varies by record type. SABG does not currently promise a fixed deletion schedule for user, entry, gameplay, payout, support, or operational records.",
        "A browser session remains in local storage until sign-out, wallet mismatch, browser clearing, or browser eviction, although its server authorization expires earlier. A push subscription may remain after you stop following a series until it is invalidated or deleted. Public blockchain records are permanent and outside SABG's ability to erase.",
      ],
    },
    {
      id: "security",
      title: "9. Security",
      paragraphs: [
        "We use technical and organizational measures intended to protect information, including signed wallet authentication, limited-lifetime sessions, access controls, transaction verification, and secret redaction in application logs. No internet transmission, wallet, blockchain, or storage system is completely secure, and we cannot guarantee absolute security.",
        "Protect your wallet and browser, review signature prompts, and never send anyone your private key or seed phrase. Contact support@sabg.fun if you believe your SABG session or gameplay record has been compromised.",
      ],
    },
    {
      id: "rights",
      title: "10. Your choices and rights",
      paragraphs: [
        "You can disconnect your wallet, sign out of the SABG session, clear browser storage, decline or remove browser notification permission, and manage cookies through browser settings. Some choices may prevent parts of the Service from working.",
        "Depending on applicable law, you may request access, correction, deletion, restriction, portability, or objection regarding personal information we control, or complain to a relevant data-protection authority. Email legal@sabg.fun. We may need to verify that you control the relevant wallet and may retain information where required for security, transaction integrity, disputes, or law. Rights do not extend to data that SABG cannot alter, including public blockchain records.",
      ],
    },
    {
      id: "international",
      title: "11. International processing and age",
      paragraphs: [
        "SABG and its providers may process information in countries other than your own. Those locations may have different data-protection laws. Where required, transfers will be handled using an available lawful mechanism.",
        "The Service is not intended for anyone under 18, and we do not knowingly collect personal information from children. If you believe a person under 18 has provided information to SABG, contact legal@sabg.fun.",
      ],
    },
    {
      id: "changes-contact",
      title: "12. Changes and contact",
      paragraphs: [
        "We may update this Policy when the Service or our data practices change. The version and effective date at the top identify the current notice. Material changes will be presented as required by applicable law.",
        "For privacy questions and rights requests, contact legal@sabg.fun. For gameplay, payout, refund, or account support, contact support@sabg.fun.",
      ],
    },
  ],
};

const cookies: LegalDocument = {
  path: "/cookies",
  navLabel: "Cookies",
  title: "Cookie Policy",
  summary:
    "This Policy describes the cookie, local storage, service worker, and third-party browser technologies currently used by the SABG consumer app.",
  noticeLabel: "Current status",
  notice:
    "SABG currently uses necessary storage and preference storage. SABG does not currently load Google Analytics, PostHog, advertising pixels, or session-replay software.",
  sections: [
    {
      id: "technologies",
      title: "1. Cookies and similar technologies",
      paragraphs: [
        "Cookies are small values a website stores through your browser. Local storage keeps values in the browser without sending them automatically with every request. Service workers support background browser functions such as requested push notifications. This Policy refers to these together as browser technologies.",
        "Some browser technologies are necessary for requested functionality or security. Others remember your choices. Third-party content may use its own technologies under the provider's policy.",
      ],
    },
    {
      id: "cookie",
      title: "2. Essential invite-access cookie",
      paragraphs: [
        "sabg_event_access is a first-party, HttpOnly cookie that records a signed invite-access expiry. It does not contain your wallet address or SABG user identifier. It is necessary to keep the private event open after a valid invite code and to protect related API and WebSocket access.",
        "The cookie lasts up to seven days, uses SameSite=Strict, applies across the app path, and is marked Secure in production. You can remove it through your browser's site-data controls. Blocking it prevents access to the gated game experience but does not prevent access to these legal pages.",
      ],
    },
    {
      id: "local-storage",
      title: "3. Local storage",
      paragraphs: [
        "SABG currently stores the following first-party values in browser local storage. Local storage normally remains until the app removes it, you clear it, the browser evicts it, or the storage context is reset.",
      ],
      bullets: [
        "arena.session stores the wallet session token, wallet address, and SABG user profile so a page reload does not require another signature. SABG removes it on wallet sign-out or when a different connected wallet invalidates the restored session.",
        "cs2.streamPip stores the position, size, and collapsed state of the optional stream player.",
        "cs2.roundSoundMuted stores whether CS2 round sounds are muted.",
      ],
    },
    {
      id: "push",
      title: "4. Service worker and push notifications",
      paragraphs: [
        "The game app registers a service worker. If you choose Notify me and grant browser permission, the browser creates a push subscription and SABG stores its endpoint and cryptographic delivery values. The service worker displays the requested Arena notification and opens the related page when selected.",
        "Your browser and push provider may retain the subscription until it is unsubscribed, invalidated, or removed through browser settings. Stopping a series follow prevents that follow from triggering future messages but may not immediately remove the browser push subscription record.",
      ],
    },
    {
      id: "third-parties",
      title: "5. Third-party technologies",
      paragraphs: [
        "The interface loads fonts from Google Fonts. When an operator-provided stream is available, the app may embed Twitch, Kick, or YouTube content. Wallet extensions, Solana RPC providers, stream platforms, font hosting, and browser push providers may receive IP address, device, request, wallet, or viewing information and may use their own cookies or storage.",
        "YouTube embeds use youtube-nocookie.com, but this does not mean that YouTube processes no information. SABG does not control third-party retention or browser technologies. Review the provider's privacy and cookie information before using its service.",
      ],
    },
    {
      id: "analytics",
      title: "6. Analytics and advertising",
      paragraphs: [
        "SABG does not currently initialize Google Analytics, PostHog, advertising pixels, retargeting, or session replay in the consumer app. If optional analytics is introduced later, this Policy will be updated and analytics will remain disabled unless the required choice or consent has been obtained.",
        "Package names present in application dependencies do not by themselves mean SABG uses an analytics service. Third-party wallets and embedded providers may perform their own measurement independently of SABG.",
      ],
    },
    {
      id: "controls",
      title: "7. Your controls",
      paragraphs: [
        "You can remove or block cookies and local storage through browser settings, sign out to remove the stored SABG wallet session, and manage notification or service-worker permissions through browser or device settings. Wallet extensions provide their own connection and storage controls.",
        "Blocking necessary storage may cause invite access, wallet sessions, saved preferences, streams, or notifications to stop working. Clearing browser data does not remove server records or public Solana transactions.",
      ],
    },
    {
      id: "changes-contact",
      title: "8. Changes and contact",
      paragraphs: [
        "We may update this Policy when storage purposes, providers, or the Service change. The version and effective date at the top identify the current notice.",
        "For questions about browser technologies or privacy, contact legal@sabg.fun. For product support, contact support@sabg.fun.",
      ],
    },
  ],
};

export const legalDocuments: LegalDocument[] = [terms, privacy, cookies];
