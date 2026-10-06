/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/marco_vault.json`.
 */
export type MarcoVault = {
  "address": "CgJnDJHjhkMgrkaky3Dp9dD89NzXRMP287bqmgCPMC8q",
  "metadata": {
    "name": "marcoVault",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "Marco IPO Subscription Vaults — on-chain vault for HK IPO access via USDC"
  },
  "docs": [
    "Marco Pre-IPO Subscription Vaults.",
    "",
    "One vault per listing event. USDC is subscribed during a funding",
    "window, deployed to a licensed broker, and — after the shares list",
    "and sell — net proceeds return on-chain for pro-rata redemption.",
    "A single flat protocol fee (default 5%) is taken at settlement."
  ],
  "instructions": [
    {
      "name": "beginSourcing",
      "docs": [
        "Sealed -> Sourcing. Marks the allocation as requested/pending."
      ],
      "discriminator": [
        34,
        192,
        204,
        252,
        179,
        56,
        84,
        195
      ],
      "accounts": [
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "vault.admin",
                "account": "vault"
              },
              {
                "kind": "account",
                "path": "vault.vault_id",
                "account": "vault"
              }
            ]
          }
        },
        {
          "name": "admin",
          "signer": true,
          "relations": [
            "vault"
          ]
        }
      ],
      "args": []
    },
    {
      "name": "cancelVault",
      "docs": [
        "Abort a pre-deployment vault: * -> Cancelled. Enables refunds and",
        "records disclosed unrefundable costs."
      ],
      "discriminator": [
        150,
        95,
        141,
        252,
        158,
        53,
        60,
        102
      ],
      "accounts": [
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "vault.admin",
                "account": "vault"
              },
              {
                "kind": "account",
                "path": "vault.vault_id",
                "account": "vault"
              }
            ]
          }
        },
        {
          "name": "admin",
          "signer": true,
          "relations": [
            "vault"
          ]
        }
      ],
      "args": [
        {
          "name": "unrefundableCosts",
          "type": "u64"
        }
      ]
    },
    {
      "name": "claim",
      "docs": [
        "Burn claim tokens, receive pro-rata USDC. Allowed in Claimable/Winding."
      ],
      "discriminator": [
        62,
        198,
        214,
        193,
        213,
        159,
        108,
        210
      ],
      "accounts": [
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "vault.admin",
                "account": "vault"
              },
              {
                "kind": "account",
                "path": "vault.vault_id",
                "account": "vault"
              }
            ]
          }
        },
        {
          "name": "buyerState",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  98,
                  117,
                  121,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "vault"
              },
              {
                "kind": "account",
                "path": "claimant"
              }
            ]
          }
        },
        {
          "name": "shareMint",
          "writable": true
        },
        {
          "name": "vaultUsdc",
          "writable": true
        },
        {
          "name": "claimantShares",
          "writable": true
        },
        {
          "name": "claimantUsdc",
          "writable": true
        },
        {
          "name": "claimant",
          "writable": true,
          "signer": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": [
        {
          "name": "sharesAmount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "conclude",
      "docs": [
        "Winding/Claimable -> Concluded. Only after the close-out date. Terminal."
      ],
      "discriminator": [
        161,
        36,
        142,
        3,
        218,
        237,
        20,
        172
      ],
      "accounts": [
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "vault.admin",
                "account": "vault"
              },
              {
                "kind": "account",
                "path": "vault.vault_id",
                "account": "vault"
              }
            ]
          }
        },
        {
          "name": "admin",
          "signer": true,
          "relations": [
            "vault"
          ]
        }
      ],
      "args": []
    },
    {
      "name": "confirmAllocation",
      "docs": [
        "Sourcing -> Sourced. Records the confirmed deployable allocation;",
        "the remainder becomes refundable at redemption."
      ],
      "discriminator": [
        98,
        178,
        91,
        122,
        65,
        38,
        56,
        59
      ],
      "accounts": [
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "vault.admin",
                "account": "vault"
              },
              {
                "kind": "account",
                "path": "vault.vault_id",
                "account": "vault"
              }
            ]
          }
        },
        {
          "name": "admin",
          "signer": true,
          "relations": [
            "vault"
          ]
        }
      ],
      "args": [
        {
          "name": "deployableAmount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "createShareMetadata",
      "docs": [
        "Attach Metaplex token metadata to the vault's claim mint so wallets show",
        "a name and symbol. Safe on a mint that already has supply; reads the",
        "vault without writing it. Admin only."
      ],
      "discriminator": [
        176,
        243,
        233,
        202,
        218,
        168,
        53,
        158
      ],
      "accounts": [
        {
          "name": "vault",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "vault.admin",
                "account": "vault"
              },
              {
                "kind": "account",
                "path": "vault.vault_id",
                "account": "vault"
              }
            ]
          }
        },
        {
          "name": "shareMint"
        },
        {
          "name": "metadata",
          "docs": [
            "itself is created and owned by Metaplex during the CPI."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  101,
                  116,
                  97,
                  100,
                  97,
                  116,
                  97
                ]
              },
              {
                "kind": "account",
                "path": "tokenMetadataProgram"
              },
              {
                "kind": "account",
                "path": "shareMint"
              }
            ],
            "program": {
              "kind": "account",
              "path": "tokenMetadataProgram"
            }
          }
        },
        {
          "name": "admin",
          "writable": true,
          "signer": true,
          "relations": [
            "vault"
          ]
        },
        {
          "name": "tokenMetadataProgram",
          "address": "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "rent",
          "address": "SysvarRent111111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "name",
          "type": "string"
        },
        {
          "name": "symbol",
          "type": "string"
        },
        {
          "name": "uri",
          "type": "string"
        }
      ]
    },
    {
      "name": "deployCapital",
      "docs": [
        "Sourced -> Deployed (partial deploys allowed). Sends USDC to the",
        "immutable broker destination, capped to the confirmed allocation."
      ],
      "discriminator": [
        233,
        143,
        38,
        229,
        114,
        162,
        34,
        22
      ],
      "accounts": [
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "vault.admin",
                "account": "vault"
              },
              {
                "kind": "account",
                "path": "vault.vault_id",
                "account": "vault"
              }
            ]
          }
        },
        {
          "name": "vaultUsdc",
          "writable": true
        },
        {
          "name": "destination",
          "docs": [
            "The broker destination — must equal the immutable account fixed at creation."
          ],
          "writable": true
        },
        {
          "name": "adminOrOperator",
          "signer": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "deposit",
      "docs": [
        "Subscribe USDC. Partial-fill up to the cap and the per-address",
        "limit; unfilled USDC never leaves the depositor's wallet. Mints",
        "claim tokens 1:1 with accepted USDC."
      ],
      "discriminator": [
        242,
        35,
        198,
        137,
        82,
        225,
        242,
        182
      ],
      "accounts": [
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "vault.admin",
                "account": "vault"
              },
              {
                "kind": "account",
                "path": "vault.vault_id",
                "account": "vault"
              }
            ]
          }
        },
        {
          "name": "buyerState",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  98,
                  117,
                  121,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "vault"
              },
              {
                "kind": "account",
                "path": "depositor"
              }
            ]
          }
        },
        {
          "name": "shareMint",
          "writable": true
        },
        {
          "name": "depositorUsdc",
          "writable": true
        },
        {
          "name": "vaultUsdc",
          "writable": true
        },
        {
          "name": "depositorShares",
          "writable": true
        },
        {
          "name": "depositor",
          "writable": true,
          "signer": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "electDelivery",
      "docs": [
        "While Live and within the election window: pay the protocol fee in",
        "USDC, burn claim tokens, and record a real-share delivery entitlement",
        "for off-chain settlement. Opts these tokens out of cash redemption."
      ],
      "discriminator": [
        229,
        156,
        140,
        31,
        195,
        170,
        85,
        139
      ],
      "accounts": [
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "vault.admin",
                "account": "vault"
              },
              {
                "kind": "account",
                "path": "vault.vault_id",
                "account": "vault"
              }
            ]
          }
        },
        {
          "name": "buyerState",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  98,
                  117,
                  121,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "vault"
              },
              {
                "kind": "account",
                "path": "holder"
              }
            ]
          }
        },
        {
          "name": "shareMint",
          "writable": true
        },
        {
          "name": "holderShares",
          "writable": true
        },
        {
          "name": "holder",
          "writable": true,
          "signer": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": [
        {
          "name": "sharesAmount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "freezeDeposits",
      "docs": [
        "Freeze or unfreeze deposits. Admin only."
      ],
      "discriminator": [
        247,
        191,
        178,
        18,
        206,
        243,
        133,
        118
      ],
      "accounts": [
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "vault.admin",
                "account": "vault"
              },
              {
                "kind": "account",
                "path": "vault.vault_id",
                "account": "vault"
              }
            ]
          }
        },
        {
          "name": "admin",
          "signer": true,
          "relations": [
            "vault"
          ]
        }
      ],
      "args": [
        {
          "name": "frozen",
          "type": "bool"
        }
      ]
    },
    {
      "name": "initializeVault",
      "docs": [
        "Create a vault. PDA seeds: [b\"vault\", admin, vault_id].",
        "`deposit_destination` (the broker USDC account) is fixed here forever."
      ],
      "discriminator": [
        48,
        191,
        163,
        44,
        71,
        129,
        63,
        164
      ],
      "accounts": [
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "admin"
              },
              {
                "kind": "arg",
                "path": "p.vault_id"
              }
            ]
          }
        },
        {
          "name": "shareMint",
          "docs": [
            "Claim-token mint, 6 decimals to match USDC. Mint authority is the",
            "vault PDA so only the program can mint/burn. The vault PDA is also",
            "the freeze authority — that is what locks claim tokens in holders'",
            "wallets, and it means no external key can ever freeze or thaw them."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  104,
                  97,
                  114,
                  101,
                  95,
                  109,
                  105,
                  110,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "vault"
              }
            ]
          }
        },
        {
          "name": "vaultUsdc",
          "docs": [
            "The vault's USDC token account (owned by the vault PDA)."
          ]
        },
        {
          "name": "depositDestination",
          "docs": [
            "IMMUTABLE broker/SPV USDC account. Only its key is stored; capital",
            "can only ever be deployed here."
          ]
        },
        {
          "name": "admin",
          "writable": true,
          "signer": true
        },
        {
          "name": "operator"
        },
        {
          "name": "treasury"
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "rent",
          "address": "SysvarRent111111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "params",
          "type": {
            "defined": {
              "name": "vaultParams"
            }
          }
        }
      ]
    },
    {
      "name": "markListed",
      "docs": [
        "Deployed -> Live. Records that the security has listed, the real",
        "share allocation, and opens the share-delivery election window."
      ],
      "discriminator": [
        208,
        79,
        227,
        202,
        104,
        117,
        119,
        2
      ],
      "accounts": [
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "vault.admin",
                "account": "vault"
              },
              {
                "kind": "account",
                "path": "vault.vault_id",
                "account": "vault"
              }
            ]
          }
        },
        {
          "name": "admin",
          "signer": true,
          "relations": [
            "vault"
          ]
        }
      ],
      "args": [
        {
          "name": "sharesAllocated",
          "type": "u64"
        },
        {
          "name": "electionPeriodSecs",
          "type": "i64"
        }
      ]
    },
    {
      "name": "markRealized",
      "docs": [
        "Live -> Realized. Records gross sale proceeds (informational)."
      ],
      "discriminator": [
        58,
        2,
        43,
        133,
        24,
        185,
        33,
        147
      ],
      "accounts": [
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "vault.admin",
                "account": "vault"
              },
              {
                "kind": "account",
                "path": "vault.vault_id",
                "account": "vault"
              }
            ]
          }
        },
        {
          "name": "admin",
          "signer": true,
          "relations": [
            "vault"
          ]
        }
      ],
      "args": [
        {
          "name": "grossProceeds",
          "type": "u64"
        }
      ]
    },
    {
      "name": "openFunding",
      "docs": [
        "Scheduled -> Funding. Opens the subscription window."
      ],
      "discriminator": [
        255,
        94,
        231,
        132,
        50,
        44,
        163,
        83
      ],
      "accounts": [
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "vault.admin",
                "account": "vault"
              },
              {
                "kind": "account",
                "path": "vault.vault_id",
                "account": "vault"
              }
            ]
          }
        },
        {
          "name": "admin",
          "signer": true,
          "relations": [
            "vault"
          ]
        }
      ],
      "args": []
    },
    {
      "name": "refund",
      "docs": [
        "Refund a cancelled vault: burn claim tokens, receive principal less",
        "pro-rata unrefundable costs."
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
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "vault.admin",
                "account": "vault"
              },
              {
                "kind": "account",
                "path": "vault.vault_id",
                "account": "vault"
              }
            ]
          }
        },
        {
          "name": "buyerState",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  98,
                  117,
                  121,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "vault"
              },
              {
                "kind": "account",
                "path": "holder"
              }
            ]
          }
        },
        {
          "name": "shareMint",
          "writable": true
        },
        {
          "name": "vaultUsdc",
          "writable": true
        },
        {
          "name": "holderShares",
          "writable": true
        },
        {
          "name": "holderUsdc",
          "writable": true
        },
        {
          "name": "holder",
          "writable": true,
          "signer": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": [
        {
          "name": "sharesAmount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "sealFunding",
      "docs": [
        "Funding -> Sealed. Closes the subscription window (deadline or manual)."
      ],
      "discriminator": [
        142,
        8,
        204,
        196,
        129,
        57,
        65,
        52
      ],
      "accounts": [
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "vault.admin",
                "account": "vault"
              },
              {
                "kind": "account",
                "path": "vault.vault_id",
                "account": "vault"
              }
            ]
          }
        },
        {
          "name": "admin",
          "signer": true,
          "relations": [
            "vault"
          ]
        }
      ],
      "args": []
    },
    {
      "name": "setFeeTiming",
      "docs": [
        "Charge the protocol fee at redemption (mint gross) instead of at deposit",
        "(mint net). Admin only, and only before the first deposit."
      ],
      "discriminator": [
        154,
        27,
        199,
        126,
        178,
        222,
        28,
        128
      ],
      "accounts": [
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "vault.admin",
                "account": "vault"
              },
              {
                "kind": "account",
                "path": "vault.vault_id",
                "account": "vault"
              }
            ]
          }
        },
        {
          "name": "admin",
          "signer": true,
          "relations": [
            "vault"
          ]
        }
      ],
      "args": [
        {
          "name": "feeAtExit",
          "type": "bool"
        }
      ]
    },
    {
      "name": "setTransferLock",
      "docs": [
        "Lock or unlock claim tokens in holders' wallets. Locked by default:",
        "tokens are frozen on mint and can only be burned back to the vault.",
        "Clearing the flag stops new freezes; existing accounts still need",
        "`unlock_shares`. Admin only."
      ],
      "discriminator": [
        47,
        4,
        176,
        107,
        39,
        133,
        142,
        67
      ],
      "accounts": [
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "vault.admin",
                "account": "vault"
              },
              {
                "kind": "account",
                "path": "vault.vault_id",
                "account": "vault"
              }
            ]
          }
        },
        {
          "name": "admin",
          "signer": true,
          "relations": [
            "vault"
          ]
        }
      ],
      "args": [
        {
          "name": "locked",
          "type": "bool"
        }
      ]
    },
    {
      "name": "settle",
      "docs": [
        "Realized -> Claimable. Records net USDC returned, computes the flat",
        "fee, and sets the redeemable balance. Opens redemption."
      ],
      "discriminator": [
        175,
        42,
        185,
        87,
        144,
        131,
        102,
        212
      ],
      "accounts": [
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "vault.admin",
                "account": "vault"
              },
              {
                "kind": "account",
                "path": "vault.vault_id",
                "account": "vault"
              }
            ]
          }
        },
        {
          "name": "vaultUsdc"
        },
        {
          "name": "admin",
          "signer": true,
          "relations": [
            "vault"
          ]
        }
      ],
      "args": [
        {
          "name": "netAmount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "sweepFee",
      "docs": [
        "Sweep collected protocol fees to the treasury. Bounded by fees_collected."
      ],
      "discriminator": [
        13,
        53,
        93,
        89,
        43,
        177,
        127,
        31
      ],
      "accounts": [
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "vault.admin",
                "account": "vault"
              },
              {
                "kind": "account",
                "path": "vault.vault_id",
                "account": "vault"
              }
            ]
          }
        },
        {
          "name": "vaultUsdc",
          "writable": true
        },
        {
          "name": "treasuryUsdc",
          "docs": [
            "Must be a USDC account owned by the vault's treasury. `has_one =",
            "treasury` only validates the `treasury` account below — it says",
            "nothing about this token account, so the ownership constraint has to",
            "be stated explicitly or fees could be swept anywhere."
          ],
          "writable": true
        },
        {
          "name": "treasury",
          "relations": [
            "vault"
          ]
        },
        {
          "name": "admin",
          "signer": true,
          "relations": [
            "vault"
          ]
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "unlockShares",
      "docs": [
        "Thaw one holder's claim-token account once the transfer lock has",
        "been lifted. Permissionless — it only works after admin unlocks."
      ],
      "discriminator": [
        66,
        248,
        156,
        242,
        54,
        2,
        176,
        160
      ],
      "accounts": [
        {
          "name": "vault",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "vault.admin",
                "account": "vault"
              },
              {
                "kind": "account",
                "path": "vault.vault_id",
                "account": "vault"
              }
            ]
          }
        },
        {
          "name": "shareMint"
        },
        {
          "name": "holderShares",
          "docs": [
            "The holder account to thaw. Constrained to this vault's claim mint,",
            "so the instruction can never touch an unrelated token account."
          ],
          "writable": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": []
    },
    {
      "name": "updateOperator",
      "docs": [
        "Rotate the operator wallet. Admin only."
      ],
      "discriminator": [
        183,
        158,
        123,
        149,
        124,
        150,
        45,
        226
      ],
      "accounts": [
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "vault.admin",
                "account": "vault"
              },
              {
                "kind": "account",
                "path": "vault.vault_id",
                "account": "vault"
              }
            ]
          }
        },
        {
          "name": "admin",
          "signer": true,
          "relations": [
            "vault"
          ]
        }
      ],
      "args": [
        {
          "name": "newOperator",
          "type": "pubkey"
        }
      ]
    },
    {
      "name": "windDown",
      "docs": [
        "Claimable -> Winding. Marks the bulk-redeemed residual window."
      ],
      "discriminator": [
        108,
        63,
        202,
        124,
        241,
        98,
        53,
        50
      ],
      "accounts": [
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "vault.admin",
                "account": "vault"
              },
              {
                "kind": "account",
                "path": "vault.vault_id",
                "account": "vault"
              }
            ]
          }
        },
        {
          "name": "admin",
          "signer": true,
          "relations": [
            "vault"
          ]
        }
      ],
      "args": []
    }
  ],
  "accounts": [
    {
      "name": "buyerState",
      "discriminator": [
        196,
        226,
        50,
        172,
        9,
        123,
        201,
        250
      ]
    },
    {
      "name": "vault",
      "discriminator": [
        211,
        8,
        232,
        43,
        2,
        152,
        117,
        119
      ]
    }
  ],
  "events": [
    {
      "name": "claimMade",
      "discriminator": [
        46,
        137,
        105,
        193,
        40,
        75,
        104,
        209
      ]
    },
    {
      "name": "deliveryElected",
      "discriminator": [
        169,
        176,
        1,
        203,
        97,
        100,
        164,
        140
      ]
    },
    {
      "name": "depositMade",
      "discriminator": [
        210,
        201,
        130,
        183,
        244,
        203,
        155,
        199
      ]
    },
    {
      "name": "refundMade",
      "discriminator": [
        16,
        154,
        174,
        197,
        137,
        92,
        176,
        1
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "invalidPhase",
      "msg": "Vault is not in the required phase for this operation"
    },
    {
      "code": 6001,
      "name": "fundingNotStarted",
      "msg": "Subscription window is not open yet"
    },
    {
      "code": 6002,
      "name": "fundingClosed",
      "msg": "Subscription window has closed"
    },
    {
      "code": 6003,
      "name": "depositsFrozen",
      "msg": "Deposits are currently frozen by admin"
    },
    {
      "code": 6004,
      "name": "zeroDeposit",
      "msg": "Deposit amount must be greater than zero"
    },
    {
      "code": 6005,
      "name": "belowMinimum",
      "msg": "Deposit is below the minimum deposit for this vault"
    },
    {
      "code": 6006,
      "name": "addressLimitReached",
      "msg": "Address has reached its per-wallet deposit limit"
    },
    {
      "code": 6007,
      "name": "capFull",
      "msg": "Vault deposit cap is full"
    },
    {
      "code": 6008,
      "name": "unauthorizedAdmin",
      "msg": "Unauthorized — only admin can perform this action"
    },
    {
      "code": 6009,
      "name": "unauthorizedOperator",
      "msg": "Unauthorized — only admin or operator can perform this action"
    },
    {
      "code": 6010,
      "name": "wrongDestination",
      "msg": "Deploy destination does not match the vault's immutable broker account"
    },
    {
      "code": 6011,
      "name": "exceedsDeployable",
      "msg": "Deploy amount exceeds the confirmed deployable allocation"
    },
    {
      "code": 6012,
      "name": "allocationExceedsDeposits",
      "msg": "Confirmed allocation exceeds subscribed capital"
    },
    {
      "code": 6013,
      "name": "zeroSettlement",
      "msg": "Settlement amount must be greater than zero"
    },
    {
      "code": 6014,
      "name": "zeroRedemption",
      "msg": "Redemption amount must be greater than zero"
    },
    {
      "code": 6015,
      "name": "insufficientShares",
      "msg": "Insufficient claim tokens for this action"
    },
    {
      "code": 6016,
      "name": "noRedeemableAmount",
      "msg": "No redeemable amount is set"
    },
    {
      "code": 6017,
      "name": "feeSweepExceedsCollected",
      "msg": "Fee sweep amount exceeds collected fees"
    },
    {
      "code": 6018,
      "name": "vaultIdTooLong",
      "msg": "Vault ID too long (max 64 characters)"
    },
    {
      "code": 6019,
      "name": "feeTooHigh",
      "msg": "Fee exceeds the maximum allowed (20% = 2000 bps)"
    },
    {
      "code": 6020,
      "name": "unrefundableExceedsDeposits",
      "msg": "Unrefundable costs exceed subscribed capital"
    },
    {
      "code": 6021,
      "name": "closeOutNotReached",
      "msg": "Close-out date has not been reached yet"
    },
    {
      "code": 6022,
      "name": "invalidParameter",
      "msg": "Invalid parameter supplied at initialization"
    },
    {
      "code": 6023,
      "name": "electionClosed",
      "msg": "Share-delivery election window is closed"
    },
    {
      "code": 6024,
      "name": "electionStillOpen",
      "msg": "Share-delivery election window is still open"
    },
    {
      "code": 6025,
      "name": "allocationNotSet",
      "msg": "Share allocation has not been recorded for this vault"
    },
    {
      "code": 6026,
      "name": "transferLockActive",
      "msg": "Claim tokens are still locked for this vault"
    },
    {
      "code": 6027,
      "name": "transferLockInactive",
      "msg": "Claim tokens are already unlocked for this vault"
    },
    {
      "code": 6028,
      "name": "noCashCohort",
      "msg": "No cash cohort remains — every holder elected share delivery"
    },
    {
      "code": 6029,
      "name": "feeTimingLocked",
      "msg": "Fee timing can only be set before any deposits are made"
    },
    {
      "code": 6030,
      "name": "overflow",
      "msg": "Arithmetic overflow"
    }
  ],
  "types": [
    {
      "name": "buyerState",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "bump",
            "docs": [
              "PDA bump."
            ],
            "type": "u8"
          },
          {
            "name": "vault",
            "docs": [
              "The vault this record belongs to."
            ],
            "type": "pubkey"
          },
          {
            "name": "depositor",
            "docs": [
              "The depositor wallet."
            ],
            "type": "pubkey"
          },
          {
            "name": "depositAmount",
            "docs": [
              "Cumulative GROSS USDC paid in by this address."
            ],
            "type": "u64"
          },
          {
            "name": "sharesMinted",
            "docs": [
              "Cumulative claim tokens minted to this address. Entry-fee vault: the NET",
              "(`deposit_amount` less the entry fee). Exit-fee vault: equal to",
              "`deposit_amount` (minted 1:1 with the gross; the fee comes off at exit)."
            ],
            "type": "u64"
          },
          {
            "name": "sharesRedeemed",
            "docs": [
              "Claim tokens redeemed by this address."
            ],
            "type": "u64"
          },
          {
            "name": "usdcRedeemed",
            "docs": [
              "USDC received from redemptions."
            ],
            "type": "u64"
          },
          {
            "name": "usdcRefunded",
            "docs": [
              "USDC received from cancellation refunds."
            ],
            "type": "u64"
          },
          {
            "name": "sharesDelivered",
            "docs": [
              "Claim tokens this address burned to elect share delivery."
            ],
            "type": "u64"
          },
          {
            "name": "underlyingDelivered",
            "docs": [
              "Real underlying shares owed to this address from delivery elections.",
              "Off-chain settlement (broker -> holder brokerage account) reconciles",
              "against this figure."
            ],
            "type": "u64"
          },
          {
            "name": "entryFeePaid",
            "docs": [
              "Entry fee this address paid upfront across its deposits. Zero for an",
              "exit-fee vault, where the fee is instead skimmed from the cash",
              "redemption and tracked on the vault's `fees_collected`, not per depositor."
            ],
            "type": "u64"
          },
          {
            "name": "reserved",
            "docs": [
              "Reserved for forward-compatible upgrades."
            ],
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          }
        ]
      }
    },
    {
      "name": "claimMade",
      "docs": [
        "A holder burned claim tokens for their pro-rata USDC."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "vaultId",
            "type": "string"
          },
          {
            "name": "claimant",
            "type": "pubkey"
          },
          {
            "name": "sharesBurned",
            "type": "u64"
          },
          {
            "name": "usdcPaid",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "deliveryElected",
      "docs": [
        "A holder elected real shares over a cash redemption. The broker delivers",
        "`underlying_shares` off-chain and reconciles against",
        "`buyer_state.underlying_delivered`."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "vaultId",
            "type": "string"
          },
          {
            "name": "holder",
            "type": "pubkey"
          },
          {
            "name": "sharesBurned",
            "type": "u64"
          },
          {
            "name": "underlyingShares",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "depositMade",
      "docs": [
        "Events for the four holder-initiated instructions.",
        "",
        "These exist for the off-chain orchestrator, which creates every intent from",
        "an observed chain event and never from an HTTP call — the on-chain escrow",
        "*is* the authorisation. Without a structured event the watcher would have to",
        "decode raw instruction data and re-read account state to learn what",
        "happened, which is both fragile and racy.",
        "",
        "Admin transitions are deliberately not emitted. The operator submits those",
        "itself, so it already knows they happened; only holder actions arrive",
        "unannounced.",
        "",
        "Each event carries `vault_id` alongside the vault pubkey. The orchestrator",
        "keys deals by that string, and including it saves an account read per event",
        "on a hot polling path.",
        "A holder subscribed USDC and received claim tokens.",
        "",
        "`accepted` is gross (what the cap counts), `subscribed` is net of the",
        "upfront fee and equals the claim tokens minted. They differ, and conflating",
        "them mis-states the cap."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "vaultId",
            "type": "string"
          },
          {
            "name": "depositor",
            "type": "pubkey"
          },
          {
            "name": "intent",
            "docs": [
              "What the depositor asked for, before cap and per-address clamping."
            ],
            "type": "u64"
          },
          {
            "name": "accepted",
            "docs": [
              "Gross USDC actually pulled from the wallet."
            ],
            "type": "u64"
          },
          {
            "name": "fee",
            "docs": [
              "Upfront protocol fee taken from the gross."
            ],
            "type": "u64"
          },
          {
            "name": "subscribed",
            "docs": [
              "Net subscribed — claim tokens minted, 1:1."
            ],
            "type": "u64"
          },
          {
            "name": "totalDeposits",
            "type": "u64"
          },
          {
            "name": "autoSealed",
            "docs": [
              "True when this deposit hit the cap and auto-sealed the vault."
            ],
            "type": "bool"
          }
        ]
      }
    },
    {
      "name": "refundMade",
      "docs": [
        "A holder burned claim tokens on a cancelled vault for principal less the",
        "pro-rata share of disclosed unrefundable costs."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "vaultId",
            "type": "string"
          },
          {
            "name": "holder",
            "type": "pubkey"
          },
          {
            "name": "sharesBurned",
            "type": "u64"
          },
          {
            "name": "usdcPaid",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "vault",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "bump",
            "docs": [
              "PDA bump."
            ],
            "type": "u8"
          },
          {
            "name": "admin",
            "docs": [
              "Controlling authority — expected to be a Squads multisig PDA."
            ],
            "type": "pubkey"
          },
          {
            "name": "operator",
            "docs": [
              "Operator wallet — may trigger capital deployment (can equal admin)."
            ],
            "type": "pubkey"
          },
          {
            "name": "treasury",
            "docs": [
              "Treasury wallet — receives the protocol fee."
            ],
            "type": "pubkey"
          },
          {
            "name": "depositDestination",
            "docs": [
              "IMMUTABLE broker / SPV USDC account. Deployed capital can only",
              "ever be sent here. Set once at creation, never mutated."
            ],
            "type": "pubkey"
          },
          {
            "name": "shareMint",
            "docs": [
              "SPL mint for the vault claim token."
            ],
            "type": "pubkey"
          },
          {
            "name": "vaultUsdc",
            "docs": [
              "The vault's own USDC token account."
            ],
            "type": "pubkey"
          },
          {
            "name": "vaultId",
            "docs": [
              "Human-readable id, e.g. \"hkex-sdmc-2026-q3\"."
            ],
            "type": "string"
          },
          {
            "name": "phase",
            "docs": [
              "Current lifecycle phase."
            ],
            "type": {
              "defined": {
                "name": "vaultPhase"
              }
            }
          },
          {
            "name": "frozen",
            "docs": [
              "Whether deposits are frozen (emergency control)."
            ],
            "type": "bool"
          },
          {
            "name": "transferLock",
            "docs": [
              "Whether claim tokens are locked in holders' wallets. True from",
              "creation: every claim-token account is frozen on mint, so tokens",
              "cannot be transferred or sold on — they can only be burned back",
              "to the vault via claim/refund/elect_delivery. Admin can lift this",
              "with `set_transfer_lock(false)`, after which holders call",
              "`unlock_shares` to thaw their own account."
            ],
            "type": "bool"
          },
          {
            "name": "depositCap",
            "docs": [
              "Maximum USDC the vault will accept (6 decimals)."
            ],
            "type": "u64"
          },
          {
            "name": "minDeposit",
            "docs": [
              "Minimum USDC a single deposit must intend (anti-dust)."
            ],
            "type": "u64"
          },
          {
            "name": "maxDeposit",
            "docs": [
              "Maximum cumulative USDC per address (0 = no per-address cap)."
            ],
            "type": "u64"
          },
          {
            "name": "fundingStart",
            "docs": [
              "Unix ts the subscription window opens."
            ],
            "type": "i64"
          },
          {
            "name": "fundingDeadline",
            "docs": [
              "Unix ts after which deposits are rejected."
            ],
            "type": "i64"
          },
          {
            "name": "closeOutAt",
            "docs": [
              "Unix ts after which Claimable/Winding can be Concluded."
            ],
            "type": "i64"
          },
          {
            "name": "totalDeposits",
            "docs": [
              "Total USDC subscribed."
            ],
            "type": "u64"
          },
          {
            "name": "totalShares",
            "docs": [
              "Total claim tokens minted (== total_deposits while funding)."
            ],
            "type": "u64"
          },
          {
            "name": "deployableAmount",
            "docs": [
              "Confirmed deployable amount (set at allocation confirmation)."
            ],
            "type": "u64"
          },
          {
            "name": "undeployedAmount",
            "docs": [
              "Subscribed capital NOT deployed (refundable remainder)."
            ],
            "type": "u64"
          },
          {
            "name": "totalDeployed",
            "docs": [
              "Total USDC actually sent to the broker destination."
            ],
            "type": "u64"
          },
          {
            "name": "sharesAllocated",
            "docs": [
              "Real underlying shares the broker acquired for the vault, recorded",
              "at listing. Establishes the per-token delivery entitlement:",
              "a claim token converts to `shares_allocated / total_shares` shares."
            ],
            "type": "u64"
          },
          {
            "name": "electionDeadline",
            "docs": [
              "Unix ts the share-delivery election window closes. Elections are",
              "only accepted while Live and before this deadline."
            ],
            "type": "i64"
          },
          {
            "name": "deliveredShares",
            "docs": [
              "Claim tokens burned via share-delivery election. These leave the",
              "cash cohort, so redemption divides only among the remaining tokens."
            ],
            "type": "u64"
          },
          {
            "name": "grossProceeds",
            "docs": [
              "Gross sale proceeds reported at Realized (informational)."
            ],
            "type": "u64"
          },
          {
            "name": "settlementAmount",
            "docs": [
              "Net USDC returned by the broker after the sale."
            ],
            "type": "u64"
          },
          {
            "name": "redeemableAmount",
            "docs": [
              "USDC available to claimants (settlement balance minus fee)."
            ],
            "type": "u64"
          },
          {
            "name": "totalRedeemedShares",
            "docs": [
              "Claim tokens redeemed so far."
            ],
            "type": "u64"
          },
          {
            "name": "totalRedeemedUsdc",
            "docs": [
              "USDC paid out in redemptions so far."
            ],
            "type": "u64"
          },
          {
            "name": "feeBps",
            "docs": [
              "Protocol fee in basis points (500 = 5.00%). Marco's single on-chain",
              "take. WHEN it is charged depends on `fee_at_exit`: an entry-fee vault",
              "deducts it from each deposit as it arrives (so claim tokens are the",
              "net); an exit-fee vault mints tokens against the gross deposit and",
              "deducts the fee from the redemption instead. Either way it is the only",
              "fee — no delivery fee, no upside/performance fee."
            ],
            "type": "u16"
          },
          {
            "name": "feesEscrowed",
            "docs": [
              "Fee deducted from deposits but not yet earned. Held in the vault and",
              "refunded with principal if the deal is cancelled before deployment —",
              "the fee is only earned once capital actually deploys into the deal."
            ],
            "type": "u64"
          },
          {
            "name": "feesCollected",
            "docs": [
              "Fee earned, moved across from `fees_escrowed` when capital deploys.",
              "Excluded from the redeemable pool and sweepable to the treasury."
            ],
            "type": "u64"
          },
          {
            "name": "feesSwept",
            "docs": [
              "Protocol fee swept to treasury."
            ],
            "type": "u64"
          },
          {
            "name": "unrefundableCosts",
            "docs": [
              "Disclosed unrefundable costs deducted from refunds on cancel."
            ],
            "type": "u64"
          },
          {
            "name": "totalRefundedUsdc",
            "docs": [
              "USDC returned to depositors during a cancellation refund."
            ],
            "type": "u64"
          },
          {
            "name": "feeAtExit",
            "docs": [
              "Fee timing. `false` (the original behaviour, and the default for every",
              "account created before this field existed — it reads as a zeroed",
              "reserved byte) charges the fee at deposit: tokens are minted net.",
              "`true` charges it at redemption: deposits mint 1:1 against the gross,",
              "and `claim` deducts the fee from the payout. Fixed by `set_fee_timing`",
              "before the first deposit and never changed after."
            ],
            "type": "bool"
          },
          {
            "name": "reserved",
            "docs": [
              "Reserved for forward-compatible upgrades."
            ],
            "type": {
              "array": [
                "u8",
                94
              ]
            }
          }
        ]
      }
    },
    {
      "name": "vaultParams",
      "docs": [
        "All vault parameters, frozen at creation. Grouped into one struct so",
        "the entrypoint stays readable and the client passes a single object."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "vaultId",
            "type": "string"
          },
          {
            "name": "depositCap",
            "type": "u64"
          },
          {
            "name": "minDeposit",
            "type": "u64"
          },
          {
            "name": "maxDeposit",
            "docs": [
              "0 = no per-address maximum."
            ],
            "type": "u64"
          },
          {
            "name": "fundingStart",
            "type": "i64"
          },
          {
            "name": "fundingDeadline",
            "type": "i64"
          },
          {
            "name": "closeOutAt",
            "type": "i64"
          },
          {
            "name": "feeBps",
            "type": "u16"
          }
        ]
      }
    },
    {
      "name": "vaultPhase",
      "docs": [
        "The Marco vault lifecycle. Each phase gates a specific set of",
        "actions; transitions are driven by admin calls backed by real",
        "off-chain events (allocation confirmations, listing, sale, cash",
        "return). Naming is Marco's own — the shape follows the economics",
        "of a subscription vault, not any one competitor's labels."
      ],
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "scheduled"
          },
          {
            "name": "funding"
          },
          {
            "name": "sealed"
          },
          {
            "name": "sourcing"
          },
          {
            "name": "sourced"
          },
          {
            "name": "deployed"
          },
          {
            "name": "live"
          },
          {
            "name": "realized"
          },
          {
            "name": "claimable"
          },
          {
            "name": "winding"
          },
          {
            "name": "concluded"
          },
          {
            "name": "cancelled"
          },
          {
            "name": "refunded"
          }
        ]
      }
    }
  ]
};
