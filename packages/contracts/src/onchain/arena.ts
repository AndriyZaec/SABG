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
      "name": "awardBadge",
      "docs": [
        "Issue a proof-of-win badge to a winning wallet. The badge PDA `init` prevents",
        "awarding the same winner twice."
      ],
      "discriminator": [
        163,
        255,
        101,
        118,
        140,
        5,
        179,
        99
      ],
      "accounts": [
        {
          "name": "arena",
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
          "name": "winner"
        },
        {
          "name": "badge",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  98,
                  97,
                  100,
                  103,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "arena"
              },
              {
                "kind": "account",
                "path": "winner"
              }
            ]
          }
        },
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
      "args": []
    },
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
      "name": "cancelArena",
      "docs": [
        "Permanently close entry and enable deterministic per-EntryPass refunds."
      ],
      "discriminator": [
        104,
        161,
        139,
        47,
        18,
        111,
        92,
        43
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
          },
          "relations": [
            "settlement"
          ]
        },
        {
          "name": "payoutAuthority",
          "signer": true
        },
        {
          "name": "settlement",
          "optional": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  101,
                  116,
                  116,
                  108,
                  101,
                  109,
                  101,
                  110,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "arena"
              }
            ]
          }
        }
      ],
      "args": []
    },
    {
      "name": "closeSettlement",
      "docs": [
        "Reclaim the rent deposit after the backend has reconciled the terminal result."
      ],
      "discriminator": [
        45,
        247,
        83,
        183,
        24,
        102,
        0,
        68
      ],
      "accounts": [
        {
          "name": "arena",
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
          },
          "relations": [
            "settlement"
          ]
        },
        {
          "name": "settlement",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  101,
                  116,
                  116,
                  108,
                  101,
                  109,
                  101,
                  110,
                  116
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
          "name": "funder",
          "writable": true,
          "relations": [
            "settlement"
          ]
        },
        {
          "name": "payoutAuthority",
          "signer": true,
          "relations": [
            "arena"
          ]
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
      "name": "payBatch",
      "docs": [
        "Pay a bounded slice of recipients in strictly increasing raw pubkey order."
      ],
      "discriminator": [
        94,
        138,
        173,
        194,
        252,
        142,
        7,
        53
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
          },
          "relations": [
            "settlement"
          ]
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
          "name": "settlement",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  101,
                  116,
                  116,
                  108,
                  101,
                  109,
                  101,
                  110,
                  116
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
          "name": "treasury",
          "writable": true,
          "address": "nvy4VWVymKZpYZEBtwNYUzJzG9R11P7Wc7khvenMpzW"
        },
        {
          "name": "payoutAuthority",
          "signer": true,
          "relations": [
            "arena"
          ]
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "expectedPaid",
          "type": "u32"
        }
      ]
    },
    {
      "name": "recordResult",
      "docs": [
        "Record the final leaderboard hash on-chain after settlement, for verification."
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
          "name": "payoutAuthority",
          "signer": true
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
        "Refund one entry from a cancelled arena. Anyone may submit; destination and amount are",
        "fixed by the program-owned EntryPass."
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
          },
          "relations": [
            "entryPass"
          ]
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
                "path": "entry_pass.player",
                "account": "entryPass"
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
          "writable": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "startSettlement",
      "docs": [
        "Freeze the recorded pool and fix the equal share. The authority chooses recipients."
      ],
      "discriminator": [
        120,
        157,
        184,
        126,
        71,
        133,
        61,
        245
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
          "name": "treasury",
          "address": "nvy4VWVymKZpYZEBtwNYUzJzG9R11P7Wc7khvenMpzW"
        },
        {
          "name": "settlement",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  101,
                  116,
                  116,
                  108,
                  101,
                  109,
                  101,
                  110,
                  116
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
          "writable": true,
          "signer": true,
          "relations": [
            "arena"
          ]
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "winnerCount",
          "type": "u32"
        }
      ]
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
    },
    {
      "name": "settlement",
      "discriminator": [
        55,
        11,
        219,
        33,
        36,
        136,
        40,
        182
      ]
    },
    {
      "name": "winnerBadge",
      "discriminator": [
        137,
        158,
        104,
        161,
        177,
        222,
        154,
        1
      ]
    }
  ],
  "events": [
    {
      "name": "settlementCompleted",
      "discriminator": [
        24,
        33,
        148,
        69,
        53,
        1,
        59,
        48
      ]
    },
    {
      "name": "winnerBatchPaid",
      "discriminator": [
        231,
        125,
        223,
        22,
        208,
        205,
        44,
        198
      ]
    },
    {
      "name": "winnerSkipped",
      "discriminator": [
        157,
        186,
        91,
        108,
        208,
        145,
        46,
        196
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
      "name": "notSettled",
      "msg": "Arena is not settled yet"
    },
    {
      "code": 6002,
      "name": "doubleEntry",
      "msg": "Player already entered this arena"
    },
    {
      "code": 6003,
      "name": "unauthorized",
      "msg": "Unauthorized payout authority"
    },
    {
      "code": 6004,
      "name": "noWinners",
      "msg": "Empty winner list"
    },
    {
      "code": 6005,
      "name": "invalidEntryFee",
      "msg": "Entry fee must be greater than zero"
    },
    {
      "code": 6006,
      "name": "invalidPlatformFee",
      "msg": "Platform fee must be 10%"
    },
    {
      "code": 6007,
      "name": "arenaNotOpen",
      "msg": "Arena is not open"
    },
    {
      "code": 6008,
      "name": "notCancelled",
      "msg": "Arena is not cancelled"
    },
    {
      "code": 6009,
      "name": "alreadyRefunded",
      "msg": "Entry pass was already refunded"
    },
    {
      "code": 6010,
      "name": "accountingUnderflow",
      "msg": "Arena accounting underflow"
    },
    {
      "code": 6011,
      "name": "invalidWinner",
      "msg": "Account cannot receive a winner payout"
    },
    {
      "code": 6012,
      "name": "accountingOverflow",
      "msg": "Arena accounting overflow"
    },
    {
      "code": 6013,
      "name": "invalidTreasury",
      "msg": "Invalid platform treasury"
    },
    {
      "code": 6014,
      "name": "invalidWinnerCount",
      "msg": "Winner count must be positive and at most the number of entries"
    },
    {
      "code": 6015,
      "name": "notSettling",
      "msg": "Arena is not settling"
    },
    {
      "code": 6016,
      "name": "staleBatchCursor",
      "msg": "Requested payout cursor does not match the settlement"
    },
    {
      "code": 6017,
      "name": "invalidBatchSize",
      "msg": "Batch size exceeds the remaining winners or the transaction limit"
    },
    {
      "code": 6018,
      "name": "winnerOrder",
      "msg": "Winner keys must be strictly increasing"
    },
    {
      "code": 6019,
      "name": "insufficientEscrow",
      "msg": "Escrow balance is less than the recorded pool"
    },
    {
      "code": 6020,
      "name": "zeroWinnerShare",
      "msg": "Each winner must receive at least one lamport"
    },
    {
      "code": 6021,
      "name": "escrowRent",
      "msg": "Intermediate escrow balance is below the rent-exempt minimum"
    },
    {
      "code": 6022,
      "name": "recipientRent",
      "msg": "Destination balance after payout would be below the rent-exempt minimum"
    },
    {
      "code": 6023,
      "name": "missingSettlement",
      "msg": "A settlement account is needed to cancel a settling arena"
    },
    {
      "code": 6024,
      "name": "payoutStarted",
      "msg": "Cannot cancel after any winner has been paid"
    },
    {
      "code": 6025,
      "name": "settlementNotTerminal",
      "msg": "Cannot close a settlement for a nonterminal arena"
    },
    {
      "code": 6026,
      "name": "smallShareRequiresSingleBatch",
      "msg": "A share below the wallet rent minimum requires one atomic payout batch"
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
              "Platform fee in basis points, fixed at arena initialization."
            ],
            "type": "u16"
          },
          {
            "name": "playerCount",
            "type": "u32"
          },
          {
            "name": "state",
            "docs": [
              "Open until the authority settles winners or cancels for deterministic refunds."
            ],
            "type": {
              "defined": {
                "name": "arenaState"
              }
            }
          },
          {
            "name": "resultHash",
            "docs": [
              "Hash of the final leaderboard, recorded after settlement (zeros until set)."
            ],
            "type": {
              "array": [
                "u8",
                32
              ]
            }
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
      "name": "arenaState",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "open"
          },
          {
            "name": "settled"
          },
          {
            "name": "cancelled"
          },
          {
            "name": "settling"
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
    },
    {
      "name": "settlement",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "arena",
            "type": "pubkey"
          },
          {
            "name": "funder",
            "type": "pubkey"
          },
          {
            "name": "winnerCount",
            "type": "u32"
          },
          {
            "name": "paidCount",
            "type": "u32"
          },
          {
            "name": "lastPaidKey",
            "type": "pubkey"
          },
          {
            "name": "share",
            "type": "u64"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "settlementCompleted",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "arena",
            "type": "pubkey"
          },
          {
            "name": "winnerCount",
            "type": "u32"
          },
          {
            "name": "share",
            "type": "u64"
          },
          {
            "name": "treasuryLamports",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "winnerBadge",
      "docs": [
        "Proof-of-win issued to a winning wallet."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "arena",
            "type": "pubkey"
          },
          {
            "name": "winner",
            "type": "pubkey"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "winnerBatchPaid",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "arena",
            "type": "pubkey"
          },
          {
            "name": "from",
            "type": "u32"
          },
          {
            "name": "count",
            "type": "u32"
          }
        ]
      }
    },
    {
      "name": "winnerSkipped",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "arena",
            "type": "pubkey"
          },
          {
            "name": "index",
            "type": "u32"
          },
          {
            "name": "winner",
            "type": "pubkey"
          }
        ]
      }
    }
  ]
};
