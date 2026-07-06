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
        "Buy an entry pass: move the fixed fee into escrow, register participation.",
        "The EntryPass PDA `init` rejects a second entry by the same player."
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
          "name": "arena",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  114,
                  101,
                  110,
                  97
                ]
              },
              {
                "kind": "account",
                "path": "arena.arena_id",
                "account": "arena"
              }
            ]
          }
        },
        {
          "name": "entryPass",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  101,
                  110,
                  116,
                  114,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "arena"
              },
              {
                "kind": "account",
                "path": "player"
              }
            ]
          }
        },
        {
          "name": "escrow",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  101,
                  115,
                  99,
                  114,
                  111,
                  119
                ]
              },
              {
                "kind": "account",
                "path": "arena"
              }
            ]
          }
        },
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
        "Create an arena with a fixed entry fee and a designated payout authority."
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
          "name": "arena",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  114,
                  101,
                  110,
                  97
                ]
              },
              {
                "kind": "arg",
                "path": "arenaId"
              }
            ]
          }
        },
        {
          "name": "escrow",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  101,
                  115,
                  99,
                  114,
                  111,
                  119
                ]
              },
              {
                "kind": "account",
                "path": "arena"
              }
            ]
          }
        },
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
          "name": "arenaId",
          "type": "u64"
        },
        {
          "name": "entryFeeLamports",
          "type": "u64"
        },
        {
          "name": "payoutAuthority",
          "type": "pubkey"
        },
        {
          "name": "platformFeeBps",
          "type": "u16"
        }
      ]
    },
    {
      "name": "recordResult",
      "docs": [
        "Record final result hash (+ winner badge) on-chain for verification."
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
        "Refund an entry if the arena is cancelled / underfilled."
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
        "Distribute the escrow to winner(s), passed as writable remaining accounts.",
        "Equal split with any remainder going to the first winner; runs once."
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
          "name": "arena",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  114,
                  101,
                  110,
                  97
                ]
              },
              {
                "kind": "account",
                "path": "arena.arena_id",
                "account": "arena"
              }
            ]
          }
        },
        {
          "name": "escrow",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  101,
                  115,
                  99,
                  114,
                  111,
                  119
                ]
              },
              {
                "kind": "account",
                "path": "arena"
              }
            ]
          }
        },
        {
          "name": "payoutAuthority",
          "signer": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    }
  ],
  "accounts": [
    {
      "name": "arena",
      "discriminator": [
        243,
        215,
        44,
        44,
        231,
        211,
        232,
        168
      ]
    },
    {
      "name": "entryPass",
      "discriminator": [
        240,
        252,
        181,
        23,
        86,
        34,
        53,
        219
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
    },
    {
      "code": 6004,
      "name": "invalidEntryFee",
      "msg": "Entry fee must be greater than zero"
    },
    {
      "code": 6005,
      "name": "invalidPlatformFee",
      "msg": "Platform fee exceeds 100%"
    }
  ],
  "types": [
    {
      "name": "arena",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "authority",
            "docs": [
              "Creator; may init the arena."
            ],
            "type": "pubkey"
          },
          {
            "name": "payoutAuthority",
            "docs": [
              "Key allowed to trigger payout (backend payout service)."
            ],
            "type": "pubkey"
          },
          {
            "name": "arenaId",
            "docs": [
              "Off-chain arena identifier, also part of the PDA seed."
            ],
            "type": "u64"
          },
          {
            "name": "entryFeeLamports",
            "docs": [
              "Fixed entry fee each player pays into escrow."
            ],
            "type": "u64"
          },
          {
            "name": "prizePoolLamports",
            "docs": [
              "Running total held in escrow."
            ],
            "type": "u64"
          },
          {
            "name": "platformFeeBps",
            "docs": [
              "Optional platform fee in basis points (0 for MVP)."
            ],
            "type": "u16"
          },
          {
            "name": "playerCount",
            "type": "u32"
          },
          {
            "name": "settled",
            "docs": [
              "Set once payout has run; blocks further entries/payouts."
            ],
            "type": "bool"
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "escrowBump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "entryPass",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "arena",
            "type": "pubkey"
          },
          {
            "name": "player",
            "type": "pubkey"
          },
          {
            "name": "amountLamports",
            "type": "u64"
          },
          {
            "name": "refunded",
            "type": "bool"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    }
  ]
};
