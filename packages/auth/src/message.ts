// Canonical sign-in message + nonce. Isomorphic (Web Crypto, no Node built-ins).

export interface SignInMessageParams {
  /** App domain requesting the sign-in, e.g. "sabg.app". */
  domain: string;
  /** Wallet address (base58) that will sign. */
  address: string;
  /** Server-issued nonce; verify it back to prevent replay. */
  nonce: string;
  /** ISO timestamp; defaults to now. */
  issuedAt?: string;
  statement?: string;
}

/** Random hex nonce. The backend issues it, stores it, and checks it on verify. */
export function generateNonce(byteLength = 16): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Human-readable message the wallet signs. The exact string must be reproduced to verify. */
export function buildSignInMessage(params: SignInMessageParams): string {
  const issuedAt = params.issuedAt ?? new Date().toISOString();
  const statement = params.statement ?? "Sign in to SABG.";
  return [
    `${params.domain} wants you to sign in with your Solana account:`,
    params.address,
    "",
    statement,
    "",
    `Nonce: ${params.nonce}`,
    `Issued At: ${issuedAt}`,
  ].join("\n");
}
