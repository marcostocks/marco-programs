# Marco — Pre-IPO Subscription Vaults

On-chain vaults that give USDC holders access to hard-to-reach IPO
allocations (initially Hong Kong listings via a licensed broker).
Depositors receive a tradeable claim token representing their pro-rata
share of the vault's net proceeds; once the shares list and sell, tokens
are redeemed for the net cash returned.

This repository contains the Solana program (Anchor/Rust), a TypeScript
test suite covering the vault lifecycle, and a Next.js frontend.

> **Important:** You never directly hold the underlying shares. A claim
> token is a right to the vault's net settlement proceeds, not the live
> equity price.

---

## Lifecycle (state machine)

One vault = one listing event, paired with one off-chain SPV / licensed
broker. The program advances through the phases below; each transition is
an admin action backed by a real off-chain event.

```
Scheduled ──open_funding──▶ Funding ──seal_funding──▶ Sealed
                              │ (auto-seals on cap)        │
                              │                     begin_sourcing
                              ▼                            ▼
                           deposit                     Sourcing
                       (USDC in, 1:1                       │
                        claim tokens out)          confirm_allocation
                                                           ▼
                                                        Sourced
                                                           │
                                                     deploy_capital
                                                           ▼
                                                       Deployed
                                                           │
                                                       mark_listed
                                                           ▼
                                                         Live
                                                           │
                                                      mark_realized
                                                           ▼
                                                       Realized
                                                           │
                                                        settle
                                                           ▼
                                                       Claimable ──▶ claim
                                                           │        (burn → USDC)
                                                       wind_down
                                                           ▼
                                                        Winding ──▶ claim
                                                           │
                                                 conclude (after close-out)
                                                           ▼
                                                       Concluded

Off-path (pre-deployment): any of Scheduled/Funding/Sealed/Sourcing/Sourced
        ──cancel_vault──▶ Cancelled ──refund (burn → principal − pro-rata costs)
```

| Phase | Meaning |
|-------|---------|
| `Scheduled` | Parameters published; subscription not yet open. |
| `Funding` | Subscription window live; USDC accepted up to cap. |
| `Sealed` | Subscription closed (cap hit or deadline). |
| `Sourcing` | Allocation requested from the source; confirmation pending. |
| `Sourced` | Allocation confirmed; deployable amount fixed. |
| `Deployed` | Capital sent to the broker settlement account. |
| `Live` | Underlying security has listed / is trading. |
| `Realized` | Position sold; gross proceeds reported. |
| `Claimable` | Net cash returned on-chain; redemption open. |
| `Winding` | Bulk redeemed; residual window before close-out. |
| `Concluded` | Close-out date passed. Terminal — no more claims. |
| `Cancelled` | Deal aborted pre-deployment; refunds enabled. |
| `Refunded` | All refunds processed. Terminal. |

---

## Instruction reference

| Instruction | Caller | Purpose |
|-------------|--------|---------|
| `initialize_vault` | Admin | Create vault PDA + claim mint. Fixes the **immutable broker destination**, cap, per-address min/max, windows, fee. |
| `open_funding` | Admin | `Scheduled → Funding`. |
| `deposit` | Anyone | Subscribe USDC (partial-fill to cap/limit), receive 1:1 claim tokens. |
| `seal_funding` | Admin | `Funding → Sealed` (deadline or manual; cap auto-seals). |
| `begin_sourcing` | Admin | `Sealed → Sourcing`. |
| `confirm_allocation` | Admin | `Sourcing → Sourced`. Records deployable amount; remainder is refundable. |
| `deploy_capital` | Admin/operator | `Sourced → Deployed`. Sends USDC to the immutable broker account only. |
| `mark_listed` | Admin | `Deployed → Live`. |
| `mark_realized` | Admin | `Live → Realized`. Records gross proceeds. |
| `settle` | Admin | `Realized → Claimable`. Records net cash, takes the flat fee, sets redeemable. |
| `claim` | Holder | Burn claim tokens, receive pro-rata USDC (Claimable/Winding). |
| `wind_down` | Admin | `Claimable → Winding`. |
| `conclude` | Admin | `Winding/Claimable → Concluded` after close-out. |
| `cancel_vault` | Admin | Abort pre-deployment → `Cancelled`; records disclosed unrefundable costs. |
| `refund` | Holder | Burn claim tokens, receive principal − pro-rata unrefundable costs. |
| `sweep_fee` | Admin | Move collected fee to treasury (post-settlement). |
| `freeze_deposits` | Admin | Emergency freeze/unfreeze of deposits. |
| `update_operator` | Admin | Rotate the operator wallet. |

---

## Mechanics

**Subscription & partial-fill.** Deposits are 1:1 — 1 USDC of subscribed
capital mints 1 claim token (both 6 decimals). A deposit is accepted up to
`min(intent, cap_remaining, per_address_remaining)`; anything that doesn't
fit is never pulled from the wallet. No revert on over-cap, no separate
refund transaction. A per-vault minimum blocks dust; an optional
per-address maximum prevents concentration.

**Deployment & the immutable destination.** The broker payout account is
fixed at creation and stored on the vault. `deploy_capital` can only ever
send USDC to that one account, and only up to the confirmed deployable
allocation. The undeployed remainder stays in the vault and is returned to
holders pro-rata at redemption.

**Settlement & redemption.** After the broker wires the net cash back,
`settle` records it, takes the fee, and sets `redeemable_amount` to the
**full vault balance minus fee** — so undeployed capital and rounding dust
stay redeemable (no stuck USDC). Redemption value is fixed at `settle` and
does not float with the public stock price afterward. Each token redeems
at `redeemable_amount × shares ÷ total_shares` (u128 math).

**Cancellation.** If a deal dies before deployment, `cancel_vault` opens a
refund flow. Refund = `(total_deposits − unrefundable_costs) × shares ÷
total_shares` — principal back, less each holder's pro-rata share of any
disclosed, already-incurred cost.

---

## Fee model

Marco charges **one flat protocol fee** — `fee_bps` (default **500 = 5.00%**,
hard-capped at 2000 = 20%) of the **net settlement amount**, taken once at
`settle` and swept to the treasury. There is **no separate platform or
performance fee**, and no upside-only cut. The fee never reduces a holder's
pro-rata redeemable balance below its intended amount.

The market-making spread is earned on the trading venue (Phase 2), and the
custody margin is billed by the regulated custodian off-chain — neither is
charged in this contract.

---

## Security design

- **PDA front-running:** the admin pubkey is part of the vault PDA seeds, so
  vault addresses can't be squatted.
- **Multisig admin:** `admin` is intended to be a **Squads multisig** PDA.
  The program treats it as a single authority; m-of-n signing happens in the
  multisig program — no custom, unaudited threshold logic here.
- **Immutable broker destination:** deployed capital can only go to the one
  account fixed at creation (`WrongDestination` otherwise).
- **No stuck USDC:** `settle` sets redeemable to the full balance minus fee.
- **Receiver validation:** claim tokens are minted to the depositor's own
  ATA, validated by `owner`/`mint` constraints.
- **Deploy cap:** `deploy_capital` is bounded by the confirmed deployable
  allocation; it cannot drain the refundable remainder.
- **Bounded fee sweep:** sweeps are bounded by `fees_collected − fees_swept`.
- **Decimals:** claim tokens use 6 decimals to match USDC.
- All balance math uses `u128` intermediates and `checked_*`/`saturating_*`
  arithmetic; `overflow-checks = true` in release.

> Not yet independently audited. Do not use with real funds until audited.

---

## Repository layout

```
preipovaults/
├── Anchor.toml
├── Cargo.toml                  # Rust workspace
├── package.json                # TS test deps + scripts
├── programs/marco-vault/
│   └── src/
│       ├── lib.rs              # program entrypoints
│       ├── state.rs            # Vault + BuyerState accounts, fee/redeem/refund math
│       ├── errors.rs           # VaultError codes
│       └── instructions/       # one file per instruction
├── tests/
│   └── marco-vault.ts          # lifecycle + partial-fill + cancel/refund tests
└── app/                        # Next.js + TypeScript frontend
```

---

## Build, test, deploy

Prerequisites: [Rust](https://rustup.rs), [Solana CLI](https://docs.solanalabs.com/cli/install),
[Anchor](https://www.anchor-lang.com/docs/installation) 0.29, Node 18+.

```bash
npm install
anchor build

# wire the real program id after the first build:
anchor keys list            # copy the marco_vault pubkey
# paste it into declare_id! (lib.rs) and both entries in Anchor.toml, then:
anchor build
anchor test
```

The program id currently holds the standard Anchor placeholder
(`Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS`) and **must** be replaced
with the generated keypair's pubkey before deployment.

---

## Frontend

The `app/` directory is a Next.js app with the Marco design system and
deposit/redeem interfaces (`npm run dev`).

---

## License

MIT
