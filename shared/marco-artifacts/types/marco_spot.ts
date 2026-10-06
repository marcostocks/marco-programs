/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/marco_spot.json`.
 */
export type MarcoSpot = {
  "address": "44PTF8po9JW5KK5VVH295XRFfNm1x9KuwcAVsvYGgn9e",
  "metadata": {
    "name": "marcoSpot",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "Marco Spot Stocks — custodian-backed HKEX equity positions settled in stablecoins on Solana"
  },
  "docs": [
    "Marco Spot Stocks.",
    "",
    "One market per HKEX-listed security. Traders buy with stablecoins; a",
    "licensed conversion partner crosses to HKD, an SFC-licensed broker buys",
    "the real share on HKEX as principal, and a regulated custodian holds it",
    "1:1 in segregated custody. Only once that holding is attested on-chain is",
    "a position token minted — so supply tracks custodied shares, not intent.",
    "",
    "In Phase 1 the position token is non-transferable, locked to the holder's",
    "wallet. Phase 2 lifts the lock into a freely tradable, composable token."
  ],
  "instructions": [
    {
      "name": "cancelBuy",
      "docs": [
        "Cancel a buy and refund the trader. Pending (trader or admin) or",
        "Deployed (admin only, after a failed off-chain leg returns funds)."
      ],
      "discriminator": [
        238,
        76,
        36,
        218,
        132,
        177,
        224,
        233
      ],
      "accounts": [
        {
          "name": "market",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  114,
                  107,
                  101,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "market.admin",
                "account": "market"
              },
              {
                "kind": "account",
                "path": "market.ticker",
                "account": "market"
              }
            ]
          }
        },
        {
          "name": "order",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  111,
                  114,
                  100,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "market"
              },
              {
                "kind": "account",
                "path": "order.order_id",
                "account": "order"
              }
            ]
          }
        },
        {
          "name": "marketUsdc",
          "writable": true
        },
        {
          "name": "traderUsdc",
          "docs": [
            "Refund always goes to the order's own trader."
          ],
          "writable": true
        },
        {
          "name": "signer",
          "signer": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": []
    },
    {
      "name": "cancelSell",
      "docs": [
        "Cancel a pending sell and return the escrowed position tokens."
      ],
      "discriminator": [
        198,
        198,
        130,
        203,
        163,
        95,
        175,
        75
      ],
      "accounts": [
        {
          "name": "market",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  114,
                  107,
                  101,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "market.admin",
                "account": "market"
              },
              {
                "kind": "account",
                "path": "market.ticker",
                "account": "market"
              }
            ]
          }
        },
        {
          "name": "order",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  111,
                  114,
                  100,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "market"
              },
              {
                "kind": "account",
                "path": "order.order_id",
                "account": "order"
              }
            ]
          }
        },
        {
          "name": "positionMint",
          "writable": true
        },
        {
          "name": "positionEscrow",
          "writable": true
        },
        {
          "name": "traderPosition",
          "docs": [
            "Tokens always return to the order's own trader."
          ],
          "writable": true
        },
        {
          "name": "signer",
          "signer": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": []
    },
    {
      "name": "confirmBuy",
      "docs": [
        "Attest the custodied position and mint the trader's position tokens.",
        "Deployed -> Filled. The only path that creates position tokens."
      ],
      "discriminator": [
        110,
        103,
        19,
        167,
        225,
        180,
        229,
        55
      ],
      "accounts": [
        {
          "name": "market",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  114,
                  107,
                  101,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "market.admin",
                "account": "market"
              },
              {
                "kind": "account",
                "path": "market.ticker",
                "account": "market"
              }
            ]
          }
        },
        {
          "name": "order",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  111,
                  114,
                  100,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "market"
              },
              {
                "kind": "account",
                "path": "order.order_id",
                "account": "order"
              }
            ]
          }
        },
        {
          "name": "holding",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  104,
                  111,
                  108,
                  100,
                  105,
                  110,
                  103
                ]
              },
              {
                "kind": "account",
                "path": "market"
              },
              {
                "kind": "account",
                "path": "order.trader",
                "account": "order"
              }
            ]
          }
        },
        {
          "name": "positionMint",
          "writable": true
        },
        {
          "name": "traderPosition",
          "docs": [
            "The order's own trader receives the position — never an arbitrary",
            "account supplied by the caller."
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
          "name": "shares",
          "type": "u64"
        },
        {
          "name": "executionPrice",
          "type": "u64"
        },
        {
          "name": "custodyRef",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        },
        {
          "name": "docHash",
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
      "name": "deployBuy",
      "docs": [
        "Send the escrowed stablecoins to the immutable conversion-partner",
        "account and take the trading spread. Pending -> Deployed."
      ],
      "discriminator": [
        206,
        154,
        37,
        179,
        159,
        127,
        253,
        201
      ],
      "accounts": [
        {
          "name": "market",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  114,
                  107,
                  101,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "market.admin",
                "account": "market"
              },
              {
                "kind": "account",
                "path": "market.ticker",
                "account": "market"
              }
            ]
          }
        },
        {
          "name": "order",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  111,
                  114,
                  100,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "market"
              },
              {
                "kind": "account",
                "path": "order.order_id",
                "account": "order"
              }
            ]
          }
        },
        {
          "name": "marketUsdc",
          "writable": true
        },
        {
          "name": "destination",
          "docs": [
            "Must be the market's immutable settlement destination."
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
      "args": []
    },
    {
      "name": "initializeMarket",
      "docs": [
        "Create a market for one security. PDA seeds: [b\"market\", admin, ticker].",
        "`settlement_destination` (the conversion partner) is fixed here forever."
      ],
      "discriminator": [
        35,
        35,
        189,
        193,
        155,
        48,
        170,
        203
      ],
      "accounts": [
        {
          "name": "market",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  114,
                  107,
                  101,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "admin"
              },
              {
                "kind": "arg",
                "path": "p.ticker"
              }
            ]
          }
        },
        {
          "name": "positionMint",
          "docs": [
            "Position-token mint. The market PDA is both mint and freeze",
            "authority — minting is gated on a custody attestation, and the",
            "freeze authority is what locks positions in Phase 1."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  115,
                  105,
                  116,
                  105,
                  111,
                  110,
                  95,
                  109,
                  105,
                  110,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "market"
              }
            ]
          }
        },
        {
          "name": "marketUsdc",
          "docs": [
            "Stablecoin escrow, owned by the market PDA."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  114,
                  107,
                  101,
                  116,
                  95,
                  117,
                  115,
                  100,
                  99
                ]
              },
              {
                "kind": "account",
                "path": "market"
              }
            ]
          }
        },
        {
          "name": "positionEscrow",
          "docs": [
            "Holds position tokens escrowed against pending sells. Never frozen,",
            "so escrowed tokens can be burned at settlement or returned on cancel."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  115,
                  105,
                  116,
                  105,
                  111,
                  110,
                  95,
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
                "path": "market"
              }
            ]
          }
        },
        {
          "name": "usdcMint"
        },
        {
          "name": "settlementDestination",
          "docs": [
            "IMMUTABLE conversion-partner USDC account. Only its key is stored;",
            "it is validated as a token account when capital is deployed."
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
              "name": "marketParams"
            }
          }
        }
      ]
    },
    {
      "name": "placeBuy",
      "docs": [
        "Submit a buy: escrow stablecoins and open an order. Nothing is",
        "deployed and no position exists yet.",
        "",
        "`min_shares_out` is mandatory slippage protection — a price cap alone",
        "does not constrain how many shares come back."
      ],
      "discriminator": [
        2,
        60,
        74,
        90,
        120,
        38,
        62,
        183
      ],
      "accounts": [
        {
          "name": "market",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  114,
                  107,
                  101,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "market.admin",
                "account": "market"
              },
              {
                "kind": "account",
                "path": "market.ticker",
                "account": "market"
              }
            ]
          }
        },
        {
          "name": "order",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  111,
                  114,
                  100,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "market"
              },
              {
                "kind": "arg",
                "path": "orderId"
              }
            ]
          }
        },
        {
          "name": "holding",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  104,
                  111,
                  108,
                  100,
                  105,
                  110,
                  103
                ]
              },
              {
                "kind": "account",
                "path": "market"
              },
              {
                "kind": "account",
                "path": "trader"
              }
            ]
          }
        },
        {
          "name": "traderAccount",
          "docs": [
            "Eligibility is keyed by the market's admin, so one verification",
            "covers every market in the deployment."
          ],
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  114,
                  97,
                  100,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "market.admin",
                "account": "market"
              },
              {
                "kind": "account",
                "path": "trader"
              }
            ]
          }
        },
        {
          "name": "traderUsdc",
          "writable": true
        },
        {
          "name": "marketUsdc",
          "writable": true
        },
        {
          "name": "trader",
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
          "name": "orderId",
          "type": "u64"
        },
        {
          "name": "usdcAmount",
          "type": "u64"
        },
        {
          "name": "limitPrice",
          "type": "u64"
        },
        {
          "name": "minSharesOut",
          "type": "u64"
        }
      ]
    },
    {
      "name": "placeSell",
      "docs": [
        "Submit a sell: escrow position tokens while the broker sells the",
        "underlying. Tokens are burned at settlement, not here."
      ],
      "discriminator": [
        17,
        86,
        4,
        221,
        48,
        125,
        40,
        14
      ],
      "accounts": [
        {
          "name": "market",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  114,
                  107,
                  101,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "market.admin",
                "account": "market"
              },
              {
                "kind": "account",
                "path": "market.ticker",
                "account": "market"
              }
            ]
          }
        },
        {
          "name": "order",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  111,
                  114,
                  100,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "market"
              },
              {
                "kind": "arg",
                "path": "orderId"
              }
            ]
          }
        },
        {
          "name": "holding",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  104,
                  111,
                  108,
                  100,
                  105,
                  110,
                  103
                ]
              },
              {
                "kind": "account",
                "path": "market"
              },
              {
                "kind": "account",
                "path": "trader"
              }
            ]
          }
        },
        {
          "name": "traderAccount",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  114,
                  97,
                  100,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "market.admin",
                "account": "market"
              },
              {
                "kind": "account",
                "path": "trader"
              }
            ]
          }
        },
        {
          "name": "positionMint",
          "writable": true
        },
        {
          "name": "traderPosition",
          "writable": true
        },
        {
          "name": "positionEscrow",
          "writable": true
        },
        {
          "name": "trader",
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
          "name": "orderId",
          "type": "u64"
        },
        {
          "name": "shares",
          "type": "u64"
        },
        {
          "name": "limitPrice",
          "type": "u64"
        }
      ]
    },
    {
      "name": "registerTrader",
      "docs": [
        "Record a trader's eligibility after off-chain identity verification.",
        "Keyed by admin, so one verification covers every market."
      ],
      "discriminator": [
        75,
        243,
        224,
        167,
        1,
        5,
        51,
        32
      ],
      "accounts": [
        {
          "name": "traderAccount",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  114,
                  97,
                  100,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "admin"
              },
              {
                "kind": "account",
                "path": "trader"
              }
            ]
          }
        },
        {
          "name": "admin",
          "writable": true,
          "signer": true
        },
        {
          "name": "trader"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "eligible",
          "type": "bool"
        },
        {
          "name": "jurisdiction",
          "type": "u16"
        }
      ]
    },
    {
      "name": "setFeeBps",
      "docs": [
        "Adjust the trading spread, within the hard cap."
      ],
      "discriminator": [
        2,
        161,
        245,
        141,
        111,
        32,
        39,
        198
      ],
      "accounts": [
        {
          "name": "market",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  114,
                  107,
                  101,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "market.admin",
                "account": "market"
              },
              {
                "kind": "account",
                "path": "market.ticker",
                "account": "market"
              }
            ]
          }
        },
        {
          "name": "admin",
          "signer": true,
          "relations": [
            "market"
          ]
        }
      ],
      "args": [
        {
          "name": "feeBps",
          "type": "u16"
        }
      ]
    },
    {
      "name": "setMarketStatus",
      "docs": [
        "Open, pause or close the market. A HK trading halt maps to Paused."
      ],
      "discriminator": [
        101,
        175,
        83,
        107,
        200,
        141,
        155,
        182
      ],
      "accounts": [
        {
          "name": "market",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  114,
                  107,
                  101,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "market.admin",
                "account": "market"
              },
              {
                "kind": "account",
                "path": "market.ticker",
                "account": "market"
              }
            ]
          }
        },
        {
          "name": "admin",
          "signer": true,
          "relations": [
            "market"
          ]
        }
      ],
      "args": [
        {
          "name": "status",
          "type": {
            "defined": {
              "name": "marketStatus"
            }
          }
        }
      ]
    },
    {
      "name": "setTransferLock",
      "docs": [
        "Lock/unlock position tokens — the Phase 1 to Phase 2 switch. Clearing",
        "it stops new freezes; existing accounts still need `unlock_position`."
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
          "name": "market",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  114,
                  107,
                  101,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "market.admin",
                "account": "market"
              },
              {
                "kind": "account",
                "path": "market.ticker",
                "account": "market"
              }
            ]
          }
        },
        {
          "name": "admin",
          "signer": true,
          "relations": [
            "market"
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
      "name": "settleSell",
      "docs": [
        "Settle a sell: burn the escrowed tokens and pay the trader the",
        "proceeds net of the spread. Pending -> Settled."
      ],
      "discriminator": [
        0,
        246,
        23,
        242,
        117,
        243,
        0,
        136
      ],
      "accounts": [
        {
          "name": "market",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  114,
                  107,
                  101,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "market.admin",
                "account": "market"
              },
              {
                "kind": "account",
                "path": "market.ticker",
                "account": "market"
              }
            ]
          }
        },
        {
          "name": "order",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  111,
                  114,
                  100,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "market"
              },
              {
                "kind": "account",
                "path": "order.order_id",
                "account": "order"
              }
            ]
          }
        },
        {
          "name": "holding",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  104,
                  111,
                  108,
                  100,
                  105,
                  110,
                  103
                ]
              },
              {
                "kind": "account",
                "path": "market"
              },
              {
                "kind": "account",
                "path": "order.trader",
                "account": "order"
              }
            ]
          }
        },
        {
          "name": "positionMint",
          "writable": true
        },
        {
          "name": "positionEscrow",
          "writable": true
        },
        {
          "name": "marketUsdc",
          "writable": true
        },
        {
          "name": "traderUsdc",
          "docs": [
            "Proceeds always go to the order's own trader."
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
          "name": "proceedsUsdc",
          "type": "u64"
        },
        {
          "name": "executionPrice",
          "type": "u64"
        },
        {
          "name": "docHash",
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
      "name": "sweepFee",
      "docs": [
        "Sweep collected trading spread to the treasury."
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
          "name": "market",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  114,
                  107,
                  101,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "market.admin",
                "account": "market"
              },
              {
                "kind": "account",
                "path": "market.ticker",
                "account": "market"
              }
            ]
          }
        },
        {
          "name": "marketUsdc",
          "writable": true
        },
        {
          "name": "treasuryUsdc",
          "writable": true
        },
        {
          "name": "admin",
          "signer": true,
          "relations": [
            "market"
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
      "name": "unlockPosition",
      "docs": [
        "Thaw one holder's position once the transfer lock has been lifted.",
        "Permissionless — it only works after admin unlocks."
      ],
      "discriminator": [
        118,
        47,
        35,
        66,
        38,
        70,
        192,
        62
      ],
      "accounts": [
        {
          "name": "market",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  114,
                  107,
                  101,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "market.admin",
                "account": "market"
              },
              {
                "kind": "account",
                "path": "market.ticker",
                "account": "market"
              }
            ]
          }
        },
        {
          "name": "positionMint"
        },
        {
          "name": "holderPosition",
          "docs": [
            "Constrained to this market's position mint, so the instruction can",
            "never touch an unrelated token account."
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
        "Rotate the operator wallet."
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
          "name": "market",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  114,
                  107,
                  101,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "market.admin",
                "account": "market"
              },
              {
                "kind": "account",
                "path": "market.ticker",
                "account": "market"
              }
            ]
          }
        },
        {
          "name": "admin",
          "signer": true,
          "relations": [
            "market"
          ]
        }
      ],
      "args": [
        {
          "name": "newOperator",
          "type": "pubkey"
        }
      ]
    }
  ],
  "accounts": [
    {
      "name": "holding",
      "discriminator": [
        23,
        96,
        64,
        250,
        235,
        191,
        0,
        144
      ]
    },
    {
      "name": "market",
      "discriminator": [
        219,
        190,
        213,
        55,
        0,
        227,
        198,
        154
      ]
    },
    {
      "name": "order",
      "discriminator": [
        134,
        173,
        223,
        185,
        77,
        86,
        28,
        51
      ]
    },
    {
      "name": "traderAccount",
      "discriminator": [
        111,
        222,
        42,
        107,
        177,
        76,
        38,
        149
      ]
    }
  ],
  "events": [
    {
      "name": "buyCancelled",
      "discriminator": [
        37,
        183,
        219,
        178,
        87,
        185,
        146,
        94
      ]
    },
    {
      "name": "buyPlaced",
      "discriminator": [
        51,
        50,
        173,
        239,
        207,
        55,
        87,
        153
      ]
    },
    {
      "name": "sellCancelled",
      "discriminator": [
        64,
        208,
        56,
        230,
        82,
        248,
        147,
        239
      ]
    },
    {
      "name": "sellPlaced",
      "discriminator": [
        9,
        0,
        201,
        155,
        165,
        37,
        25,
        76
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "marketNotActive",
      "msg": "Market is not accepting new orders"
    },
    {
      "code": 6001,
      "name": "invalidOrderStatus",
      "msg": "Order is not in the required status for this operation"
    },
    {
      "code": 6002,
      "name": "wrongOrderSide",
      "msg": "Order side does not match this instruction"
    },
    {
      "code": 6003,
      "name": "unauthorizedAdmin",
      "msg": "Unauthorized — only admin can perform this action"
    },
    {
      "code": 6004,
      "name": "unauthorizedOperator",
      "msg": "Unauthorized — only admin or operator can perform this action"
    },
    {
      "code": 6005,
      "name": "unauthorizedTrader",
      "msg": "Unauthorized — only the order's trader can perform this action"
    },
    {
      "code": 6006,
      "name": "traderNotEligible",
      "msg": "Trader is not eligible to trade — identity verification required"
    },
    {
      "code": 6007,
      "name": "zeroAmount",
      "msg": "Order amount must be greater than zero"
    },
    {
      "code": 6008,
      "name": "belowMinimum",
      "msg": "Order is below the market minimum"
    },
    {
      "code": 6009,
      "name": "aboveMaximum",
      "msg": "Order exceeds the market maximum"
    },
    {
      "code": 6010,
      "name": "insufficientShares",
      "msg": "Insufficient position tokens for this order"
    },
    {
      "code": 6011,
      "name": "limitPriceExceeded",
      "msg": "Execution price is worse than the order's limit price"
    },
    {
      "code": 6012,
      "name": "wrongDestination",
      "msg": "Deploy destination does not match the market's immutable settlement account"
    },
    {
      "code": 6013,
      "name": "exceedsEscrow",
      "msg": "Deploy amount exceeds the escrowed balance for this order"
    },
    {
      "code": 6014,
      "name": "notionalMismatch",
      "msg": "Attested notional does not match the capital deployed for this order"
    },
    {
      "code": 6015,
      "name": "feeSweepExceedsCollected",
      "msg": "Fee sweep amount exceeds collected fees"
    },
    {
      "code": 6016,
      "name": "invalidTicker",
      "msg": "Ticker is empty or longer than 16 characters"
    },
    {
      "code": 6017,
      "name": "feeTooHigh",
      "msg": "Fee exceeds the maximum allowed (5% = 500 bps)"
    },
    {
      "code": 6018,
      "name": "invalidParameter",
      "msg": "Invalid parameter supplied"
    },
    {
      "code": 6019,
      "name": "transferLockActive",
      "msg": "Position tokens are still locked for this market"
    },
    {
      "code": 6020,
      "name": "invalidAttestation",
      "msg": "Custody attestation is missing required fields"
    },
    {
      "code": 6021,
      "name": "belowMinimumShares",
      "msg": "Fill is below the minimum shares the trader accepted"
    },
    {
      "code": 6022,
      "name": "missingSlippageProtection",
      "msg": "Minimum shares out must be greater than zero"
    },
    {
      "code": 6023,
      "name": "insufficientUnreservedFunds",
      "msg": "Market holds no unreserved USDC for this payout — settlement funds have not arrived"
    },
    {
      "code": 6024,
      "name": "overflow",
      "msg": "Arithmetic overflow"
    }
  ],
  "types": [
    {
      "name": "buyCancelled",
      "docs": [
        "A buy was cancelled and the stablecoins returned. Cancelled while Pending",
        "refunds in full; cancelled while Deployed also reverses the spread."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "market",
            "type": "pubkey"
          },
          {
            "name": "ticker",
            "type": "string"
          },
          {
            "name": "orderId",
            "type": "u64"
          },
          {
            "name": "trader",
            "type": "pubkey"
          },
          {
            "name": "usdcRefunded",
            "type": "u64"
          },
          {
            "name": "wasDeployed",
            "docs": [
              "True when the cancel asserted a failed off-chain leg (admin only)."
            ],
            "type": "bool"
          }
        ]
      }
    },
    {
      "name": "buyPlaced",
      "docs": [
        "Events for the four trader-initiated instructions.",
        "",
        "These exist for the off-chain orchestrator, which creates every intent from",
        "an observed chain event and never from an HTTP call — the on-chain escrow",
        "*is* the authorisation. A trader whose USDC is not locked in the market",
        "escrow has not agreed to anything, so the escrow event is the only thing",
        "that may start work on their behalf.",
        "",
        "Operator transitions (`deploy_buy`, `confirm_buy`, `settle_sell`) are",
        "deliberately not emitted. The operator submits those itself and already",
        "knows the outcome; only trader actions arrive unannounced.",
        "",
        "Each event carries `ticker` alongside the market pubkey. The orchestrator",
        "keys markets by that string, and including it saves an account read per",
        "event on a hot polling path.",
        "A trader escrowed USDC and opened a buy."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "market",
            "type": "pubkey"
          },
          {
            "name": "ticker",
            "type": "string"
          },
          {
            "name": "orderId",
            "type": "u64"
          },
          {
            "name": "trader",
            "type": "pubkey"
          },
          {
            "name": "usdcAmount",
            "docs": [
              "USDC moved into the market escrow."
            ],
            "type": "u64"
          },
          {
            "name": "limitPrice",
            "docs": [
              "Per-share limit the trader agreed to. A fill may never be attested",
              "worse than this."
            ],
            "type": "u64"
          },
          {
            "name": "minSharesOut",
            "type": "u64"
          },
          {
            "name": "feeBps",
            "docs": [
              "Spread snapshotted at placement — a later `set_fee_bps` must not",
              "re-price an order already in flight."
            ],
            "type": "u16"
          }
        ]
      }
    },
    {
      "name": "holding",
      "docs": [
        "Cumulative per-trader record for one market. The position token balance",
        "is the live position; this is the running history used for reconciliation",
        "against the custodian's statements."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "market",
            "type": "pubkey"
          },
          {
            "name": "trader",
            "type": "pubkey"
          },
          {
            "name": "sharesBought",
            "type": "u64"
          },
          {
            "name": "sharesSold",
            "type": "u64"
          },
          {
            "name": "usdcSpent",
            "type": "u64"
          },
          {
            "name": "usdcReceived",
            "type": "u64"
          },
          {
            "name": "feesPaid",
            "type": "u64"
          },
          {
            "name": "reserved",
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
      "name": "market",
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
              "Operator wallet — may deploy capital and confirm fills."
            ],
            "type": "pubkey"
          },
          {
            "name": "treasury",
            "docs": [
              "Treasury wallet — receives swept trading-spread fees."
            ],
            "type": "pubkey"
          },
          {
            "name": "settlementDestination",
            "docs": [
              "IMMUTABLE conversion-partner USDC account. Escrowed stablecoins",
              "can only ever be sent here. Set once at creation, never mutated."
            ],
            "type": "pubkey"
          },
          {
            "name": "positionMint",
            "docs": [
              "SPL mint for this market's position token."
            ],
            "type": "pubkey"
          },
          {
            "name": "marketUsdc",
            "docs": [
              "The market's USDC account (PDA, owned by the market)."
            ],
            "type": "pubkey"
          },
          {
            "name": "positionEscrow",
            "docs": [
              "Position tokens escrowed against pending sells (PDA, market-owned)."
            ],
            "type": "pubkey"
          },
          {
            "name": "ticker",
            "docs": [
              "HKEX ticker, e.g. \"0700.HK\"."
            ],
            "type": "string"
          },
          {
            "name": "status",
            "docs": [
              "Whether the market is accepting new orders."
            ],
            "type": {
              "defined": {
                "name": "marketStatus"
              }
            }
          },
          {
            "name": "transferLock",
            "docs": [
              "Phase 1: position tokens are frozen in the holder's wallet on mint.",
              "Phase 2: admin clears this and holders thaw via `unlock_position`."
            ],
            "type": "bool"
          },
          {
            "name": "shareDecimals",
            "docs": [
              "Decimals on the position token. Matches USDC (6) so fractional",
              "share quantities are expressible."
            ],
            "type": "u8"
          },
          {
            "name": "feeBps",
            "docs": [
              "Trading spread charged in-contract, in basis points."
            ],
            "type": "u16"
          },
          {
            "name": "minOrderUsdc",
            "docs": [
              "Minimum USDC a single buy must intend (anti-dust)."
            ],
            "type": "u64"
          },
          {
            "name": "maxOrderUsdc",
            "docs": [
              "Maximum USDC for a single buy (0 = no limit)."
            ],
            "type": "u64"
          },
          {
            "name": "totalSharesOutstanding",
            "docs": [
              "Position tokens minted and outstanding. Reconciles 1:1 against the",
              "shares the custodian reports holding."
            ],
            "type": "u64"
          },
          {
            "name": "usdcEscrowed",
            "docs": [
              "USDC held against Pending buy orders (not yet deployed)."
            ],
            "type": "u64"
          },
          {
            "name": "sharesEscrowed",
            "docs": [
              "Position tokens held against Pending sell orders."
            ],
            "type": "u64"
          },
          {
            "name": "totalDeployed",
            "docs": [
              "USDC sent to the conversion partner over the market's life."
            ],
            "type": "u64"
          },
          {
            "name": "totalBoughtUsdc",
            "docs": [
              "Lifetime USDC spent on filled buys (net of fee)."
            ],
            "type": "u64"
          },
          {
            "name": "totalSoldUsdc",
            "docs": [
              "Lifetime USDC paid out on settled sells (net of fee)."
            ],
            "type": "u64"
          },
          {
            "name": "feesCollected",
            "docs": [
              "Trading spread collected, awaiting sweep."
            ],
            "type": "u64"
          },
          {
            "name": "feesSwept",
            "docs": [
              "Trading spread swept to treasury."
            ],
            "type": "u64"
          },
          {
            "name": "orderSeq",
            "docs": [
              "Monotonic order counter — seeds the per-order PDA."
            ],
            "type": "u64"
          },
          {
            "name": "createdAt",
            "docs": [
              "Unix ts the market was created."
            ],
            "type": "i64"
          },
          {
            "name": "reserved",
            "docs": [
              "Reserved for forward-compatible upgrades."
            ],
            "type": {
              "array": [
                "u8",
                128
              ]
            }
          }
        ]
      }
    },
    {
      "name": "marketParams",
      "docs": [
        "Market parameters, fixed at creation."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "ticker",
            "docs": [
              "HKEX ticker, e.g. \"0700.HK\"."
            ],
            "type": "string"
          },
          {
            "name": "shareDecimals",
            "docs": [
              "Decimals on the position token; 6 matches USDC."
            ],
            "type": "u8"
          },
          {
            "name": "feeBps",
            "docs": [
              "Trading spread in basis points."
            ],
            "type": "u16"
          },
          {
            "name": "minOrderUsdc",
            "type": "u64"
          },
          {
            "name": "maxOrderUsdc",
            "docs": [
              "0 = no per-order maximum."
            ],
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "marketStatus",
      "docs": [
        "Whether a market is accepting new orders.",
        "",
        "A Hong Kong trading halt maps to `Paused`: no new orders are taken,",
        "but orders already in flight can still settle or be cancelled, so a",
        "halt never strands capital that has already left a wallet."
      ],
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "active"
          },
          {
            "name": "paused"
          },
          {
            "name": "closed"
          }
        ]
      }
    },
    {
      "name": "order",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "market",
            "type": "pubkey"
          },
          {
            "name": "trader",
            "type": "pubkey"
          },
          {
            "name": "orderId",
            "docs": [
              "Monotonic id within the market; part of the order PDA seeds."
            ],
            "type": "u64"
          },
          {
            "name": "side",
            "type": {
              "defined": {
                "name": "orderSide"
              }
            }
          },
          {
            "name": "status",
            "type": {
              "defined": {
                "name": "orderStatus"
              }
            }
          },
          {
            "name": "usdcAmount",
            "docs": [
              "Buy: USDC escrowed at submission (gross, fee inclusive).",
              "Sell: USDC paid out at settlement (net of fee)."
            ],
            "type": "u64"
          },
          {
            "name": "sharesAmount",
            "docs": [
              "Buy: shares minted at fill. Sell: shares escrowed at submission."
            ],
            "type": "u64"
          },
          {
            "name": "limitPrice",
            "docs": [
              "Buy: highest acceptable price per share. Sell: lowest acceptable.",
              "Enforced against the attested execution price."
            ],
            "type": "u64"
          },
          {
            "name": "minSharesOut",
            "docs": [
              "Buy only: the fewest shares the trader will accept for their capital.",
              "`limit_price` caps what each share may cost but says nothing about",
              "how many arrive, so without this a fill could convert the whole",
              "deployment into a token dust position. Must be non-zero."
            ],
            "type": "u64"
          },
          {
            "name": "feeBps",
            "docs": [
              "Spread rate snapshotted when the order was placed, so a later",
              "`set_fee_bps` cannot re-price an order already in flight."
            ],
            "type": "u16"
          },
          {
            "name": "executionPrice",
            "docs": [
              "Attested execution price per share."
            ],
            "type": "u64"
          },
          {
            "name": "feePaid",
            "docs": [
              "Trading spread charged on this order."
            ],
            "type": "u64"
          },
          {
            "name": "deployedAmount",
            "docs": [
              "Buy: USDC actually sent to the conversion partner."
            ],
            "type": "u64"
          },
          {
            "name": "custodyRef",
            "docs": [
              "Custodian's reference for the resulting position."
            ],
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "docHash",
            "docs": [
              "Fingerprint of the broker confirmation + custodian statement. The",
              "documents stay off-chain; publishing only the hash lets a holder",
              "verify a document they are shown is genuine without exposing",
              "counterparty paperwork."
            ],
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "createdAt",
            "type": "i64"
          },
          {
            "name": "updatedAt",
            "type": "i64"
          },
          {
            "name": "attestedAt",
            "type": "i64"
          },
          {
            "name": "reserved",
            "type": {
              "array": [
                "u8",
                54
              ]
            }
          }
        ]
      }
    },
    {
      "name": "orderSide",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "buy"
          },
          {
            "name": "sell"
          }
        ]
      }
    },
    {
      "name": "orderStatus",
      "docs": [
        "Order lifecycle. Buys and sells share the enum but walk different paths:",
        "",
        "```text",
        "Buy:   Pending ─deploy_buy─▶ Deployed ─confirm_buy─▶ Filled",
        "└──────────── cancel_buy ────────────┘ ─▶ Cancelled",
        "",
        "Sell:  Pending ─settle_sell──────────────────────▶ Settled",
        "└─ cancel_sell ─▶ Cancelled",
        "```"
      ],
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "pending"
          },
          {
            "name": "deployed"
          },
          {
            "name": "filled"
          },
          {
            "name": "settled"
          },
          {
            "name": "cancelled"
          }
        ]
      }
    },
    {
      "name": "sellCancelled",
      "docs": [
        "A pending sell was cancelled and the escrowed position returned intact."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "market",
            "type": "pubkey"
          },
          {
            "name": "ticker",
            "type": "string"
          },
          {
            "name": "orderId",
            "type": "u64"
          },
          {
            "name": "trader",
            "type": "pubkey"
          },
          {
            "name": "sharesReturned",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "sellPlaced",
      "docs": [
        "A trader escrowed position tokens and opened a sell.",
        "",
        "The tokens are escrowed, not burned: while the broker is selling, the",
        "custodian still holds the share, so supply should still reflect it."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "market",
            "type": "pubkey"
          },
          {
            "name": "ticker",
            "type": "string"
          },
          {
            "name": "orderId",
            "type": "u64"
          },
          {
            "name": "trader",
            "type": "pubkey"
          },
          {
            "name": "shares",
            "type": "u64"
          },
          {
            "name": "limitPrice",
            "type": "u64"
          },
          {
            "name": "feeBps",
            "type": "u16"
          }
        ]
      }
    },
    {
      "name": "traderAccount",
      "docs": [
        "Per-trader eligibility record.",
        "",
        "Keyed by `admin` rather than by market, so a trader is verified once",
        "for the whole deployment rather than per security. Marco sets this",
        "after off-chain identity verification; the program only reads the flag."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "admin",
            "docs": [
              "The authority that vouched for this trader."
            ],
            "type": "pubkey"
          },
          {
            "name": "trader",
            "docs": [
              "The trader's wallet."
            ],
            "type": "pubkey"
          },
          {
            "name": "eligible",
            "docs": [
              "Whether the trader may place orders. Revocable."
            ],
            "type": "bool"
          },
          {
            "name": "jurisdiction",
            "docs": [
              "ISO 3166-1 numeric country code, for jurisdiction gating off-chain.",
              "0 when unset."
            ],
            "type": "u16"
          },
          {
            "name": "registeredAt",
            "type": "i64"
          },
          {
            "name": "updatedAt",
            "type": "i64"
          },
          {
            "name": "reserved",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          }
        ]
      }
    }
  ]
};
