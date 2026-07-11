// Ported from world-cup's services/txline.service.ts, with Redis caching swapped for the
// in-memory token-cache (no-Redis decision for this port). Obtains a TxLine API token by
// subscribing on-chain (devnet) and activating the subscription with a signed message —
// this is the vendor's (TXODDS/TxLine) access mechanism, unrelated to SABG's own
// `programs/arena` on-chain program.

import { createRequire } from "node:module";
import * as anchor from "@coral-xyz/anchor";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  createAssociatedTokenAccountIdempotent,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import axios from "axios";
import nacl from "tweetnacl";
import { WalletService } from "./wallet.service.js";
import { getCached, setCached } from "./token-cache.js";
import { logger } from "../logger.js";
import { UpstreamApiError } from "../errors.js";
import { API_ORIGIN, TXL_TOKEN_MINT } from "../config/network.js";
import { GuestJwtService } from "./guest-jwt.service.js";

const require = createRequire(import.meta.url);

const SERVICE_LEVEL_ID = 1; // World Cup & Int Friendlies (60s delay)
const DURATION_WEEKS = 4;
const SELECTED_LEAGUES: number[] = [];
const CACHE_KEY = "txline:devnet:api-token";
const CACHE_TTL_SECONDS = 28 * 24 * 60 * 60; // 28 days

export class TxLineService {
  private static instance: TxLineService;

  public static getInstance(): TxLineService {
    if (!TxLineService.instance) {
      TxLineService.instance = new TxLineService();
    }
    return TxLineService.instance;
  }

  private async getOrCreateApiToken(): Promise<string> {
    const cachedToken = getCached(CACHE_KEY);
    if (cachedToken) {
      logger.debug("TxLINE token loaded from cache");
      return cachedToken;
    }

    logger.info("generating new TxLINE token");
    const token = await this.generateNewToken();

    setCached(CACHE_KEY, token, CACHE_TTL_SECONDS);
    logger.info("new TxLINE token cached in memory");
    return token;
  }

  private async generateNewToken(): Promise<string> {
    const walletService = WalletService.getInstance();
    const { connection, wallet } = walletService;
    const apiBaseUrl = `${API_ORIGIN}/api`;

    const provider = new anchor.AnchorProvider(connection, wallet, {
      commitment: "confirmed",
    });
    anchor.setProvider(provider);

    const txoracleIdl = require("../idl/txoracle.json") as anchor.Idl;

    // anchor v0.30+: constructor is (idl, provider) — programId comes from the IDL.
    // Cast to any: IDL is loaded at runtime so TypeScript can't infer method shapes.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const program = new anchor.Program(txoracleIdl, provider) as any;

    const [tokenTreasuryPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("token_treasury_v2")],
      program.programId,
    );

    const tokenTreasuryVault = getAssociatedTokenAddressSync(
      TXL_TOKEN_MINT,
      tokenTreasuryPda,
      true,
      TOKEN_2022_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID,
    );

    const [pricingMatrixPda] = PublicKey.findProgramAddressSync([Buffer.from("pricing_matrix")], program.programId);

    const userTokenAccount = getAssociatedTokenAddressSync(
      TXL_TOKEN_MINT,
      wallet.publicKey,
      false,
      TOKEN_2022_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID,
    );

    // Ensure the user's ATA exists before calling subscribe (idempotent — no-op if already created)
    await createAssociatedTokenAccountIdempotent(
      connection,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (wallet as any).payer,
      TXL_TOKEN_MINT,
      wallet.publicKey,
      {},
      TOKEN_2022_PROGRAM_ID,
    );

    let txSig: string;
    try {
      txSig = await program.methods
        .subscribe(SERVICE_LEVEL_ID, DURATION_WEEKS)
        .accounts({
          user: wallet.publicKey,
          pricingMatrix: pricingMatrixPda,
          tokenMint: TXL_TOKEN_MINT,
          userTokenAccount,
          tokenTreasuryVault,
          tokenTreasuryPda,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
    } catch (err) {
      throw new UpstreamApiError(
        `On-chain subscription failed: ${err instanceof Error ? err.message : String(err)}`,
        undefined,
        err,
      );
    }

    logger.info({ txSig }, "subscription transaction submitted");

    const guestJwtService = GuestJwtService.getInstance();
    const jwt = await guestJwtService.getJwt();
    logger.debug("guest JWT obtained for activation");

    const messageString = `${txSig}:${SELECTED_LEAGUES.join(",")}:${jwt}`;
    const message = new TextEncoder().encode(messageString);

    let signatureBytes: Uint8Array;
    if ("signMessage" in wallet && typeof wallet.signMessage === "function") {
      signatureBytes = await wallet.signMessage(message);
    } else {
      // Local Keypair
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      signatureBytes = nacl.sign.detached(message, (wallet as any).payer.secretKey);
    }

    const walletSignature = Buffer.from(signatureBytes).toString("base64");

    const activationResponse = await axios.post<{ token?: string } | string>(
      `${apiBaseUrl}/token/activate`,
      {
        txSig,
        walletSignature,
        leagues: SELECTED_LEAGUES,
      },
      {
        headers: { Authorization: `Bearer ${jwt}` },
      },
    );

    const apiToken =
      typeof activationResponse.data === "string" ? activationResponse.data : activationResponse.data.token;
    if (!apiToken || typeof apiToken !== "string") {
      throw new UpstreamApiError(
        `Failed to get API token from activation response: ${JSON.stringify(activationResponse.data)}`,
      );
    }

    return apiToken;
  }

  public async getApiToken(): Promise<string> {
    return this.getOrCreateApiToken();
  }
}
