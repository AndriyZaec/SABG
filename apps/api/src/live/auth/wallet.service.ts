// Ported from world-cup's services/wallet.service.ts. Loads the devnet keypair used to sign
// the TxLine on-chain `subscribe()` call (see txline.service.ts) — unrelated to SABG's own
// `programs/arena` wallet/identity flow (C5).

import * as anchor from "@coral-xyz/anchor";
import { Keypair, Connection } from "@solana/web3.js";
import bs58 from "bs58";
import { liveConfig } from "../config/env.js";
import { RPC_URL } from "../config/network.js";

export class WalletService {
  private static instance: WalletService;
  public wallet: anchor.Wallet;
  public connection: Connection;

  private constructor() {
    const privateKeyStr = liveConfig.solana.privateKey;
    let keypair: Keypair;

    if (privateKeyStr.startsWith("[")) {
      // JSON array
      const secretKey = Uint8Array.from(JSON.parse(privateKeyStr) as number[]);
      keypair = Keypair.fromSecretKey(secretKey);
    } else {
      // base58
      keypair = Keypair.fromSecretKey(bs58.decode(privateKeyStr));
    }

    this.wallet = new anchor.Wallet(keypair);
    this.connection = new Connection(RPC_URL, "confirmed");
  }

  public static getInstance(): WalletService {
    if (!WalletService.instance) {
      WalletService.instance = new WalletService();
    }
    return WalletService.instance;
  }
}
