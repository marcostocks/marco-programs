# Marco Spot Stocks

Solana program for buying and selling **real Hong Kong–listed shares with stablecoins**.

One market per HKEX-listed security. A trader pays USDC; a licensed conversion partner crosses to HKD; an SFC-licensed broker buys the share on HKEX as principal; a regulated custodian holds it 1:1 in a segregated account on trust. The trader is the beneficial owner, Marco holds legal title in a bankruptcy-remote structure.

This program owns the **on-chain leg only**: stablecoin escrow, order state, the custody attestation, and issuance/redemption of the position token. Sourcing, execution, custody and FX are off-chain, regulated functions.

- **Program id:** `44PTF8po9JW5KK5VVH295XRFfNm1x9KuwcAVsvYGgn9e`
- **Framework:** Anchor 0.31.1 · Solana 3.x
- **Status:** ⚠️ **Not audited. Do not use with real funds.**

---

## The invariant that shapes everything

**A position token is never minted on the strength of a payment.**

`deploy_buy` proves funds left the escrow. It does not prove a share was acquired. Only `confirm_buy` mints, and it requires the custodian's position reference *and* a document fingerprint — zeroed values are rejected.

Token supply therefore tracks **custodied shares**, not intent. That is what makes the backing claim verifiable on-chain rather than asserted.

The same reasoning drives sells. Tokens are **escrowed, not burned**, when a sell is placed: while the broker is selling, the custodian still holds the share, so supply should still reflect it. Burning happens at settlement, when the share genuinely leaves custody — and a cancelled sell returns the position intact.

---

## Lifecycle

```
Buy
  place_buy ─────▶ Pending ──── deploy_buy ────▶ Deployed ──── confirm_buy ────▶ Filled
  (escrow USDC)      │        (to conversion       │        (attest custody,       │
                     │         partner, spread     │         mint locked position) │
                     │         earned here)        │                               │
                     └──────── cancel_buy ─────────┴──────────▶ Cancelled
                        (trader or admin)   (admin only, after a
                         refunds in full     failed leg returns funds)

Sell
  place_sell ────▶ Pending ──── settle_sell ───▶ Settled
  (escrow tokens)    │        (burn escrow, pay
                     │         proceeds net of spread)
                     └──────── cancel_sell ────▶ Cancelled
                        (tokens returned, re-locked)
```

A Hong Kong trading halt maps to `MarketStatus::Paused`: no new orders, but in-flight orders can still settle or cancel, so a halt never strands capital that has already left a wallet.

---

## Instructions

| Instruction | Caller | Purpose |
|---|---|---|
| `initialize_market` | Admin | Create market + position mint. Fixes the immutable settlement destination, ticker, spread, order limits. |
| `register_trader` | Admin | Record eligibility after off-chain identity verification. Revocable. |
| `place_buy` | Trader | Escrow USDC, open a buy order at a limit price. |
| `deploy_buy` | Admin/operator | Send escrowed USDC to the conversion partner. Spread earned here. |
| `confirm_buy` | Admin/operator | Attest custody, mint the locked position. The only mint path. |
| `cancel_buy` | Trader / Admin | Refund. Trader may cancel while Pending; admin only once Deployed. |
| `place_sell` | Trader | Escrow position tokens, open a sell at a limit price. |
| `settle_sell` | Admin/operator | Burn the escrow, pay proceeds net of spread. |
| `cancel_sell` | Trader / Admin | Return escrowed tokens and re-lock them. |
| `set_market_status` | Admin | Active / Paused / Closed. |
| `set_transfer_lock` | Admin | The Phase 1 → Phase 2 switch. |
| `unlock_position` | Anyone | Thaw one holder's position once admin has unlocked. |
| `set_fee_bps` | Admin | Adjust the spread, within the cap. |
| `update_operator` | Admin | Rotate the operator wallet. |
| `sweep_fee` | Admin | Move earned spread to treasury. |

---

## Accounts

| Account | PDA seeds | Holds |
|---|---|---|
| `Market` | `["market", admin, ticker]` | Config, authorities, running totals |
| position mint | `["position_mint", market]` | SPL mint; market PDA is mint **and** freeze authority |
| `market_usdc` | `["market_usdc", market]` | Stablecoin escrow |
| `position_escrow` | `["position_escrow", market]` | Tokens escrowed against pending sells |
| `Order` | `["order", market, order_id]` | One buy or sell, plus its attestation |
| `Holding` | `["holding", market, trader]` | Cumulative per-trader record |
| `TraderAccount` | `["trader", admin, trader]` | Eligibility — keyed by admin, so one verification covers every market |

---

## The position token

**Phase 1 — non-transferable.** The market PDA holds the SPL freeze authority and freezes each position account on mint. The token records real custodied ownership but cannot be transferred, sold on, or used as collateral. It leaves only by being burned back through a sell.

Because a frozen SPL account can be neither minted to nor transferred from, every path that moves position tokens thaws first and re-freezes in the same instruction. The market PDA is the sole freeze authority, so no external key can freeze or thaw a holder, and the open window never spans a transaction the holder controls.

A fully sold-down account is left thawed rather than re-frozen: a frozen account cannot be closed, so re-locking an emptied one would strand the holder's rent.

**Phase 2 — tradable.** `set_transfer_lock(false)`, then `unlock_position` per holder. The lock is an authority rather than a Token-2022 non-transferable mint precisely so this needs no program upgrade.

> SPL freezes are per-account and cannot be applied or cleared mint-wide. Clearing the flag stops *new* freezes but does not thaw existing accounts; setting it back does not retroactively re-freeze thawed ones. **Treat the Phase 2 unlock as effectively one-way.**

---

## Fees

A single **trading spread** (`fee_bps`, hard-capped at 500 = 5%), charged in-contract at two points:

- **Buy** — taken at `deploy_buy`, so a buy cancelled before deployment **refunds in full**.
- **Sell** — taken from proceeds at `settle_sell`; the trader receives the net.

Sweeps are bounded by `fees_collected - fees_swept`, so they can never reach into escrowed customer funds or sale proceeds awaiting settlement.

The custody margin is billed off-chain by the regulated custodian and is **not** charged here.

---

## Safeguards

- **Immutable settlement destination.** The conversion partner's account is fixed at market creation; deployment cannot be pointed anywhere else.
- **Attestation required to mint.** Custody reference and document hash must both be non-zero.
- **Limit price.** A fill may never be attested worse than the price the trader agreed to.
- **Over-mint guard.** Attested notional may not exceed the capital actually deployed for that order.
- **Own-account only.** Positions mint to the order's trader, refunds and proceeds pay the order's trader — never an account supplied by the caller.
- **Bounded sweeps.** Earned spread only.
- **Eligibility.** Revoking blocks new orders without touching existing positions.
- **Multisig admin.** `admin` is intended to be a Squads multisig PDA; no custom threshold logic lives in this program.
- `u128` intermediates and checked arithmetic throughout; `overflow-checks = true` in release.

Documents backing an attestation stay off-chain. Publishing only the hash lets a holder verify a document they are shown is genuine and unaltered, without exposing counterparty paperwork.

**What an attestation does not do:** it establishes what was recorded, when, and that the referenced documents are unaltered. It cannot independently verify that the custodian holds the shares — no on-chain record can reach into a custody account. That is why custody is regulated, segregated and bankruptcy-remote, and why a custodian- or auditor-co-signed attestation is the intended enhancement.

---

## Build & test

Requires Rust, Solana CLI, Anchor 0.31.1, Node 18+.

```bash
npm install
anchor build
anchor test
```

18 tests cover the full buy and sell lifecycle, the Phase 1 → Phase 2 unlock, and the negative paths. Negative tests assert **specific error codes** rather than "something threw", so a malformed account list cannot silently pass for a real guard.

> ⚠️ **Back up `target/deploy/marco_spot-keypair.json`.** It is gitignored — correctly, since private keys do not belong in version control — which means pushing to GitHub does **not** back it up. That file *is* the program id and its upgrade authority. Lose it and the program can never be deployed or upgraded at this address.

---

## Scope

Implemented: markets, eligibility, the async buy and sell lifecycle, cancellation and failed-leg refunds, the position lock, fee accrual and sweeps.

Not implemented: **dividends** and **corporate actions** (splits, rights issues, delistings). Dividends are passed through in USDC per the product docs and need a record-date mechanism; both are deliberately out of scope for this first cut.

---

## Related

- `docs/spot-stocks/` — product documentation
- `marcostocks/preipovaults` — pre-IPO subscription vaults. Spot is where a pre-IPO position lands at listing.
