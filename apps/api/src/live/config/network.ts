// Ported from world-cup's config/network.ts, restricted to devnet only (CLAUDE.md: no
// mainnet keys or funds in this repo). RPC/API origins and the TxLine program/mint are the
// vendor's (TXODDS/TxLine) protocol constants, unrelated to SABG's own `programs/arena`.

import { PublicKey } from "@solana/web3.js";

export const RPC_URL = "https://api.devnet.solana.com";
export const API_ORIGIN = "https://txline-dev.txodds.com";
export const TXL_TOKEN_MINT = new PublicKey("4Zao8ocPhmMgq7PdsYWyxvqySMGx7xb9cMftPMkEokRG");
