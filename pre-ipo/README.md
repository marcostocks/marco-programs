# Marco — Pre-IPO Subscription Vaults

On-chain vaults that give USDC holders access to hard-to-reach IPO allocations
(initially Hong Kong listings via a licensed broker). Depositors receive a
tradeable vault token representing their pro-rata claim; once the IPO settles,
tokens are redeemed for the net cash proceeds.

This repository contains the Solana program (Anchor/Rust), a TypeScript test
suite covering the full vault lifecycle, and a Next.js frontend.

> **Important:** You never directly hold the underlying shares. A vault token is
> a claim on the vault's net settlement proceeds, not the live equity price.

---

## The five flows

The five core user/operator actions map directly to on-chain instructions:

| Flow | Instruction | File | What happens |
|------|-------------|------|--------------|
| **Deposit** | `deposit` | `instructions/deposit.rs` | USDC transferred from the depositor into the vault's token account. Enforces cap, deadline, and freeze. |
| **Token issuance** | `deposit` | `instructions/deposit.rs` | Vault share tokens minted **1:1** with USDC (both 6 decimals) directly to the depositor's ATA. |
| **IPO value** | `record_settlement` | `instructions/record_settlement.rs` | Admin records the net USDC returned by the broker after the IPO settles. This fixes the settlement value (NAV) and locks in fees. |
| **Token redemption** | `redeem` | `instructions/redeem.rs` | Holder burns share tokens. Payout = `redeemable_amount × shares ÷ total_shares` (u128 math). |
| **USDC withdrawal** | `redeem` | `instructions/redeem.rs` | The pro-rata USDC proceeds are transferred from the vault back to the redeemer in the same instruction. |

A live indicative value can be shown pre-settlement in the frontend; on-chain the
value is only fixed once `record_settlement` is called.

---

## Vault lifecycle (state machine)

```
FundingOpen ──close_funding──▶ FundingClosed ──move_assets──▶ AssetsDeployed
     │  (auto-closes when cap hit)                                   │
     │                                                       record_settlement
     ▼                                                               ▼
  deposit                                                        Settled
  (USDC in,                                                          │
   tokens out)                                                 open_redemption
                                                                     ▼
                                                             RedemptionOpen
                                                                     │
                                                              redeem (burn →
                                                                USDC out)
```

| Phase | Meaning |
|-------|---------|
| `FundingOpen` | Deposits accepted; share tokens minted 1:1. |
| `FundingClosed` | Window closed (deadline passed or cap hit). No more deposits. |
| `AssetsDeployed` | USDC moved to the broker for IPO subscription. |
| `Settled` | Broker returned proceeds; settlement amount recorded on-chain. |
| `RedemptionOpen` | Holders can burn tokens and withdraw pro-rata USDC. |

---

## Instruction reference

| Instruction | Caller | Purpose |
|-------------|--------|---------|
| `initialize_vault` | Admin | Create the vault PDA + share mint (6 decimals, vault is mint authority). |
| `deposit` | Anyone | Deposit USDC, receive 1:1 share tokens. |
| `close_funding` | Admin | `FundingOpen → FundingClosed`. |
| `move_assets` | Admin / operator | Send USDC to the broker. `FundingClosed → AssetsDeployed`. Capped to unmoved deposits. |
| `record_settlement` | Admin | Record net proceeds. `AssetsDeployed → Settled`. Computes fees. |
| `open_redemption` | Admin | Set `redeemable_amount` to balance − fees. `Settled → RedemptionOpen`. |
| `redeem` | Holder | Burn shares, receive pro-rata USDC. |
| `sweep_fee` | Admin | Move collected fees to treasury (post-settlement only). |
| `freeze_deposits` | Admin | Emergency freeze/unfreeze of deposits. |
| `update_operator` | Admin | Rotate the operator wallet. |

---

## Revenue model

Marco earns on spreads and a custody margin — **not** management or
performance fees. Three revenue lines (per the deck):

1. **Sourcing spread** — Marco sources pre-IPO shares against confirmed vault
   demand and fills at a margin.
2. **Market-making spread** — the bid-ask earned on every trade on the venue.
   No commission; the spread is the revenue.
3. **Custody margin** — an annual fee on the real shares held with the regulated
   custodian.

**What this vault program charges on-chain: the sourcing spread only.**

- `sourcing_spread_bps` is the sourcing margin (e.g. 150 = 1.50%, capped at 20%).
- It is taken **once at settlement** as a flat bps of `settlement_amount`
  (`Vault::sourcing_fee()`), recorded into `fees_collected`, and swept to the
  treasury via `sweep_fee`. It never reduces a holder's redeemable balance below
  the intended pro-rata amount.
- The **market-making spread** is earned on the trading venue (the Phase 1
  secondary market and Phase 2 perps), not in this vault contract.
- The **custody margin** is billed by the regulated custodian off-chain.

---

## Security design

The contract was designed against the published findings from a comparable
audited protocol:

- **PDA front-running (H-1, L-2):** the admin pubkey is part of the vault PDA
  seeds, so vault addresses can't be squatted.
- **Stuck excess USDC (H-2):** `open_redemption` sets `redeemable_amount` to the
  full vault balance minus fees, so rounding dust / extra USDC stays redeemable.
- **Receiver validation (M-1):** share tokens are minted to the depositor's own
  ATA, validated by `owner`/`mint` constraints.
- **Asset-drain protection (M-2):** `move_assets` is capped to deposits not yet
  moved; it cannot drain reserved funds.
- **No post-settlement yield sweep (M-3):** fee sweeps are bounded by
  `fees_collected − fees_swept`.
- **Decimal mismatch (L-3):** share tokens use 6 decimals to match USDC.
- All balance math uses `u128` intermediates and `checked_*` arithmetic;
  `overflow-checks = true` in release.

> Not yet independently audited. Do not use with real funds until audited.

---

## Repository layout

```
preipovaults/
├── Anchor.toml
├── Cargo.toml                  # Rust workspace
├── package.json                # TS test deps + scripts
├── tsconfig.json
├── programs/marco-vault/
│   └── src/
│       ├── lib.rs              # program entrypoints
│       ├── state.rs            # Vault + BuyerState accounts, fee/redeem math
│       ├── errors.rs           # VaultError codes
│       └── instructions/       # one file per instruction
├── tests/
│   └── marco-vault.ts       # full lifecycle test suite
└── app/                        # Next.js + TypeScript frontend
```

---

## Build, test, deploy

Prerequisites: [Rust](https://rustup.rs), [Solana CLI](https://docs.solanalabs.com/cli/install),
[Anchor](https://www.anchor-lang.com/docs/installation) 0.29, Node 18+.

```bash
# install JS deps
npm install        # or: yarn

# build the program
anchor build

# run the lifecycle tests against a local validator
anchor test

# deploy to devnet
solana config set --url devnet
anchor deploy --provider.cluster devnet
```

After the first `anchor build`, replace the placeholder program ID
(`Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS`) in `Anchor.toml` and
`declare_id!` in `lib.rs` with the generated keypair's pubkey
(`anchor keys list`), then rebuild.

---

## Frontend

The `app/` directory is a Next.js app with the Marco design system and
deposit/redeem interfaces. See `app/package.json` for its own scripts
(`npm run dev`).

A standalone, self-contained prototype that simulates the full deposit →
issuance → live NAV → settlement → redemption → withdrawal cycle in the browser
(no chain required) lives in the parent project as `marco-vaults.html`.

---

## License

MIT
