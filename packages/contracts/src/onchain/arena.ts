/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/arena.json`.
 */
export type Arena = {
  "address": "84o7QQ3vkGkm3D6wfaqEHxFN93p3Q2b6SFtfazzxZuxH",
  "metadata": {
    "name": "arena",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "SABG arena escrow, entry pass and payout program (Solana devnet)."
  },
  "instructions": [
    {
      "name": "buyEntry",
      "docs": [
        "C1 — buy an entry pass: move fixed lamports into escrow, register participation.",
        "Double entry must be rejected."
      ],
      "discriminator": [
        238,
        105,
        42,
        125,
        75,
        50,
        52,
        81
      ],
      "accounts": [
        {
          "name": "player",
          "writable": true,
          "signer": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "initArena",
      "docs": [
        "C1 — create an arena PDA with a fixed entry fee (and optional platform fee, MVP 0%)."
      ],
      "discriminator": [
        24,
        246,
        252,
        176,
        155,
        175,
        123,
        124
      ],
      "accounts": [
        {
          "name": "authority",
          "writable": true,
          "signer": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "entryFeeLamports",
          "type": "u64"
        }
      ]
    },
    {
      "name": "recordResult",
      "docs": [
        "C3 — record final result hash (+ winner badge) on-chain for verification."
      ],
      "discriminator": [
        208,
        243,
        63,
        218,
        63,
        116,
        76,
        80
      ],
      "accounts": [
        {
          "name": "payoutAuthority",
          "writable": true,
          "signer": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "resultHash",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        }
      ]
    },
    {
      "name": "refund",
      "docs": [
        "C1 (optional) — refund an entry if the arena is cancelled / underfilled."
      ],
      "discriminator": [
        2,
        96,
        183,
        251,
        63,
        208,
        46,
        46
      ],
      "accounts": [
        {
          "name": "player",
          "writable": true,
          "signer": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "settlePayout",
      "docs": [
        "C2 — distribute escrow to winner(s): winner-takes-all, or equal split on shared win",
        "(spec §7/§12). Backend payout authority (PDA-gated); must not run twice."
      ],
      "discriminator": [
        245,
        141,
        29,
        81,
        209,
        73,
        180,
        155
      ],
      "accounts": [
        {
          "name": "payoutAuthority",
          "writable": true,
          "signer": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "winners",
          "type": {
            "vec": "pubkey"
          }
        }
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "alreadySettled",
      "msg": "Arena already settled"
    },
    {
      "code": 6001,
      "name": "doubleEntry",
      "msg": "Player already entered this arena"
    },
    {
      "code": 6002,
      "name": "unauthorized",
      "msg": "Unauthorized payout authority"
    },
    {
      "code": 6003,
      "name": "noWinners",
      "msg": "Empty winner list"
    }
  ]
};
