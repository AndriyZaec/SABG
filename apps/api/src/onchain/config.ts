// Config for backend-side on-chain arena provisioning. Default OFF so the off-chain demo/replay
// path is unchanged; enable only where a funded authority keypair is configured.

import dotenv from "dotenv";
import { z } from "zod";
import { ARENA_PLATFORM_FEE_BPS, ARENA_TREASURY_ADDRESS } from "@arena/contracts/onchain";

dotenv.config();

const schema = z.object({
  /** When "true", upsertForMatch provisions a real on-chain arena instead of a placeholder escrow. */
  ONCHAIN_ARENAS_ENABLED: z.enum(["true", "false"]).default("false"),
  ARENA_RPC_URL: z.string().default("https://api.devnet.solana.com"),
  ARENA_AUTHORITY_RESERVE_LAMPORTS: z.coerce.number().int().nonnegative().default(50_000_000),
  ARENA_PLATFORM_FEE_BPS: z.coerce
    .number()
    .int()
    .refine((value) => value === ARENA_PLATFORM_FEE_BPS, `must be ${ARENA_PLATFORM_FEE_BPS}`)
    .default(ARENA_PLATFORM_FEE_BPS),
  ARENA_TREASURY_ADDRESS: z.literal(ARENA_TREASURY_ADDRESS).default(ARENA_TREASURY_ADDRESS),
  /** Service keypair (base58 or JSON array) that is arena `authority` + `payout_authority`. */
  ARENA_AUTHORITY_SECRET: z.string().optional(),
});

const env = schema.parse(process.env);

if (
  env.ONCHAIN_ARENAS_ENABLED === "true" &&
  (!env.ARENA_AUTHORITY_SECRET || env.ARENA_AUTHORITY_SECRET.startsWith("REPLACE_"))
) {
  throw new Error("ARENA_AUTHORITY_SECRET is required when ONCHAIN_ARENAS_ENABLED=true");
}

export const onchainConfig = {
  enabled: env.ONCHAIN_ARENAS_ENABLED === "true",
  rpcUrl: env.ARENA_RPC_URL,
  authorityReserveLamports: env.ARENA_AUTHORITY_RESERVE_LAMPORTS,
  platformFeeBps: env.ARENA_PLATFORM_FEE_BPS,
  treasuryAddress: env.ARENA_TREASURY_ADDRESS,
  authoritySecret: env.ARENA_AUTHORITY_SECRET,
};
