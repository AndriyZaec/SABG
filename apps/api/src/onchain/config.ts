// Config for backend-side on-chain arena provisioning. Default OFF so the off-chain demo/replay
// path is unchanged; enable only where a funded authority keypair is configured.

import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const schema = z.object({
  /** When "true", upsertForMatch provisions a real on-chain arena instead of a placeholder escrow. */
  ONCHAIN_ARENAS_ENABLED: z.enum(["true", "false"]).default("false"),
  ARENA_RPC_URL: z.string().default("https://api.devnet.solana.com"),
  /** Service keypair (base58 or JSON array) that is arena `authority` + `payout_authority`. */
  ARENA_AUTHORITY_SECRET: z.string().optional(),
});

const env = schema.parse(process.env);

export const onchainConfig = {
  enabled: env.ONCHAIN_ARENAS_ENABLED === "true",
  rpcUrl: env.ARENA_RPC_URL,
  authoritySecret: env.ARENA_AUTHORITY_SECRET,
};
