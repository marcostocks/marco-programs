# Marco Orchestrator

The off-chain service that connects Marco's Solana programs to the regulated world.

Both on-chain programs are **operator-driven** — `marco-spot` cannot advance past
`place_buy` without someone calling `deploy_buy` and `confirm_buy`, and
`marco-vault` cannot advance past a deposit without someone calling
`deploy_capital`, `mark_listed` and `settle`. This service is that operator. It
watches the chain, moves the money, places the trade, confirms custody, and
writes the result back on-chain.

```
┌─────────────┐   chain events    ┌──────────────────┐
│   Solana    │ ────────────────▶ │   Orchestrator   │
│ marco-spot  │                   │                  │
│ marco-vault │ ◀──────────────── │  intents · sagas │
└─────────────┘  operator writes  │  ledger · recon  │
                                  └────────┬─────────┘
                                           │
              ┌────────────────────────────┼────────────────────────────┐
              ▼                            ▼                            ▼
      ┌───────────────┐           ┌────────────────┐           ┌───────────────┐
      │      MSB      │  HKD wire │ Executing      │  settles  │   Custodian   │
      │ USDC ⇄ HKD    │ ────────▶ │ broker (HKEX)  │ ────────▶ │  1:1, segreg. │
      │ on/off ramp   │           │ SFC-licensed   │           │  bankruptcy-  │
      └───────────────┘           └────────────────┘           │  remote       │
                                                               └───────────────┘
```

**Status:** runs end-to-end against deterministic mock counterparties. No real
adapter is wired yet — `bootstrap.ts` refuses to start with a partially real
configuration, deliberately.

```bash
npm install
npm test                  # 108 tests
npm run demo              # narrated end-to-end buy, with reconciliation

cp .env.example .env      # dev placeholders; .env is gitignored
npm run dev               # http://localhost:8080
```

`/readyz` returns **503** on a fresh start and that is correct — the treasury
buffers are empty, so the service is not in a state where it could safely fund
an order. It fails closed. `/healthz` returns 200.

---

## The three rules

Everything else follows from these.

**1. The on-chain escrow is the authorisation.**
Intents are created from observed chain events, never from an HTTP call. There
is no "place an order" endpoint and there must never be one — a trader whose
USDC is not locked in the market escrow has not agreed to anything, and an
orchestrator that accepts orders over HTTP has no cryptographic basis for
spending their money.

**2. A position token is never minted on the strength of a payment.**
`deploy_buy` proves funds left the escrow. It does not prove a share was
acquired. Only `confirm_buy` mints, and it requires the custodian's position
reference *and* a document fingerprint. Token supply therefore tracks
**custodied shares**, not intent — which is what makes the 1:1 backing claim
verifiable rather than asserted.

**3. Never retry an ambiguous effect.**
A timeout on "wire HKD 4,000,000 to the broker" is not a retryable failure. It
is an *unknown* one. The error taxonomy (`src/domain/errors.ts`) splits failures
three ways, and the runner treats them differently:

| Disposition | Meaning | Runner behaviour |
|---|---|---|
| `RetryableError` | The effect definitely did not happen | Retry with the same `clientRef`, exponential backoff, park at the ceiling |
| `TerminalError` | It did not happen and never will | Unwind, running compensations in reverse |
| `AmbiguousError` | We cannot tell | **Never retry.** Query the counterparty for our deterministic reference; park for a human if that is inconclusive |

An unclassified throw from inside a vendor SDK is treated as ambiguous. Guessing
is not a failure mode we accept.

---

## How money actually moves

The funding model is **hybrid**: a pre-funded HKD buffer at the broker with a
just-in-time fallback.

A buy reserves against the working buffer and reaches the exchange in seconds,
while the USDC→HKD crossing settles behind it as replenishment. That draw is
safe because the trader's USDC is *already locked* in the on-chain escrow and
the program can only ever release it to the immutable conversion-partner
account — the buffer draw is collateralised, not speculative.

When the buffer cannot cover an order, the same step blocks until the crossing
and the wire have both landed. Slower, but it never overdraws and it never
blocks. Nothing downstream knows which path was taken.

```
SPOT_BUY
  screen → validate_order → reserve_funding → deploy_escrow
                                  │                │  USDC escrow ⇒ MSB
                    buffer or JIT ┘                ▼
                            fund_execution → place_order → await_fill
                                                                │
                        settle_crossing ◀───────────────────────┘
                                  │
                        await_custody → attest_and_mint     (confirm_buy mints)
```

```
SPOT_SELL
  screen → validate_order → place_order → await_fill → reserve_payout
                                                              │
              repatriate ◀── settle_onchain ◀── await_custody_release
              (replenish       (burn + pay
               the float)       the seller)
```

Two ordering decisions in the sell path carry real weight. Tokens **burn after
custody releases, not before** — while the broker is selling, the custodian
still holds the share, so supply should still reflect it. And the seller is
**paid from the USDC float** as soon as custody releases, with repatriation
following asynchronously; that decoupling is the entire reason to hold a float.

The pre-IPO vault is driven separately (`src/orchestration/vault-driver.ts`),
because a vault is a *deal*, not a user request. It advances on operator
authority and outlives any individual subscription. Every phase is gated on a
real off-chain fact: `mark_listed` is submitted because the custodian confirmed
the shares, not because a listing date passed; `settle` is submitted because the
USDC is actually back, not because a sale happened.

---

## The ledger

Double-entry, integer-only, two books sharing one journal.

Every entry must sum to zero — cash per currency, positions per ticker — and the
ledger **rejects** an unbalanced entry rather than repairing it. Silently
plugging a gap would put a wrong number in the book that reconciliation would
later report as a counterparty break, attributed to a counterparty that did
nothing wrong.

The posting templates live in one file (`src/ledger/postings.ts`), one function
per economic event, each asserted independently in the test suite. There are no
floats anywhere in the money path.

`FX_CLEARING` is a **position** account, not a suspense account: a USDC→HKD
conversion debits it in USDC and credits it in HKD, leaving a long-USDC /
short-HKD position that unwinds as the cycle completes. Its net value at current
rates is the open FX exposure — a number the treasury desk wants anyway.

### Reconciliation

Three-way, on a schedule and on demand:

```
custodian holdings  ==  position tokens on Solana  ==  the position ledger
```

Plus on-chain escrow against the books, broker cash, MSB balances, stalled
intents and a non-zero suspense balance. A disagreement is a **break**. Breaks
are recorded and escalated; they are never auto-resolved, and closing one
requires a written resolution.

### The interlock

Detection that leaves the mint path open is not a control. A confirmed backing
shortfall for a ticker **blocks minting** of that ticker: `attest_and_mint`
refuses to run and the intent parks, so no unbacked token can be created while
someone investigates. `/readyz` goes 503. An acknowledged-but-unresolved break
still blocks — acknowledging a shortfall does not put the shares back.

Halting the market is deliberately **not** automatic. With minting already
blocked there is nothing unbacked to prevent, so a custodian reporting glitch
must never stop a live market unattended. An operator halts via
`POST /v1/markets/:ticker/status`.

→ [Runbook: backing shortfall](docs/runbooks/backing-shortfall.md)

---

## Layout

```
src/
  domain/        money (integer-only), ids and deterministic client refs,
                 the error taxonomy, the injectable clock
  ledger/        chart of accounts, the posting engine, posting templates
  ports/         MSB · broker · custodian · chain · compliance · store
  adapters/
    mock/        deterministic, manually-stepped simulators
    store/       in-memory repositories with real optimistic-concurrency
  orchestration/ the intent model, the saga runner, the three sagas,
                 the vault driver, the chain watcher
  treasury/      buffer snapshots, reservations, top-up policy
  recon/         the three-way reconciler
  api/           Fastify routes, webhook ingest, wire serialisation
```

**Nothing outside `bootstrap.ts` imports an adapter.** That is what makes
swapping a counterparty a one-line change rather than an archaeology exercise.

---

## Durability

- **Deterministic client references.** Every outbound call is keyed
  `<intentId>.<step>[.<sub>]`. A retry after a crash produces byte-identical
  references, so the counterparty's own idempotency layer collapses the
  duplicate. It is also how an inbound webhook finds its way home without a
  mapping table.
- **Write-ahead attempts.** The step journal is written *before* the side
  effect, so a crash always leaves evidence that something may be in flight. On
  resume, the runner finds the orphaned attempt and calls the step's `resolve()`
  — which queries the counterparty — instead of re-running the effect.
- **Optimistic concurrency everywhere.** Two runners working the same intent is
  not hypothetical; it is what happens during a rolling deploy.
- **Leases and cursors.** The chain cursor is persisted, so a restart resumes
  rather than replaying from the head. A missed `place_buy` is a trader whose
  USDC sits escrowed forever.
- **Reservations expire.** A hold from a crashed intent must not lock buffer
  capacity permanently; the sweeper releases it and alarms, because an expired
  hold always means an intent stalled.

---

## HTTP surface

Two audiences, kept apart. `/v1/**` is bearer-authenticated operator API;
`/v1/webhooks/**` is authenticated by HMAC over the raw body instead.

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/healthz` `/readyz` | Liveness; readiness fails closed on buffer health or open critical breaks |
| `GET` | `/v1/intents` | List and filter |
| `GET` | `/v1/intents/:id` | Intent, its step attempts and its journal entries |
| `POST` | `/v1/intents/:id/resume` | Resume a parked intent — **requires a note** |
| `POST` | `/v1/intents/:id/unwind` | Force the compensation path |
| `POST` | `/v1/intents/tick` | Drive the runner once |
| `POST` | `/v1/accounts` · `GET /v1/accounts/:wallet` | Account records |
| `PUT` | `/v1/accounts/:wallet/verification` | Record a KYC outcome (never the documents) |
| `GET` | `/v1/markets/:ticker` | Market state and any open backing shortfall |
| `POST` | `/v1/markets/:ticker/status` | Halt or resume a market — **requires a note** |
| `GET` `POST` | `/v1/vaults` | Vault mandates |
| `POST` | `/v1/vaults/:id/advance` | Authorise the next phase — permission, not a command |
| `GET` | `/v1/treasury` | Buffer snapshots and top-up plans |
| `POST` | `/v1/treasury/sweep-expired` | Release stale holds |
| `GET` | `/v1/ledger/trial-balance` · `/v1/ledger/balances` | The books |
| `POST` | `/v1/recon/run` · `GET /v1/recon/breaks` | Reconciliation |
| `POST` | `/v1/recon/breaks/:id/resolve` | Close a break — **requires a resolution** |
| `POST` | `/v1/webhooks/{msb,broker,custodian}` | Signed counterparty callbacks |

Webhook ingest applies four gates in order: signature over the **raw** bytes,
replay window on the signed timestamp, delivery-id dedupe, then effect. The
effect is only ever to *wake* the owning intent — a webhook is a hint that state
changed, not a trustworthy statement of what it changed to. The saga re-reads
the counterparty and decides for itself.

Amounts on the wire carry exact minor units as a string plus a decimal string.
`bigint` does not survive `JSON.stringify`, and coercing to `number` corrupts
anything above 2^53.

---

## Going live

1. **Pick counterparties.** See
   [`docs/counterparty-integration.md`](docs/counterparty-integration.md) for
   the capability checklist to send each candidate. Marco's notes name Emperor
   Group (HK, SFC Type 1/4/9) as the intended broker; the MSB and custodian are
   open.
2. **Write the adapter** under `src/adapters/<provider>/`, implementing the port
   in `src/ports/`. Contract tests should run the same scenarios the mocks do,
   against the provider's sandbox.
3. **Wire it in `bootstrap.ts`** and remove the guard that currently refuses a
   partially real configuration.
4. **Replace the in-memory store with Postgres.** `claimDue` becomes
   `SELECT … FOR UPDATE SKIP LOCKED`, and `JournalStore.append` must run in the
   same transaction as the state change that produced it.
5. **Replace the mock signer.** The operator key should be an HSM/KMS key or a
   Squads proposal flow, never a file in production.

### Not yet built

- Real adapters for all five ports.
- Postgres persistence and the balance projection (the current ledger keeps
  balances in-process, which is single-instance only).
- Dividends and corporate actions. The custodian port surfaces them so
  reconciliation can *explain* a discrepancy rather than just alarm on it, but
  nothing acts on them yet — matching the on-chain programs, where both are
  explicitly out of scope for the first cut.
- Metrics and alerting. Breaks and parked intents are recorded but nothing pages.
- The treasury top-up is *planned* (`assessTopUp`) but not executed
  automatically; a human still initiates the funding cycle.

---

## Related

- `spotstocks/` — the `marco-spot` Anchor program
- `preipovaults/` — the `marco-vault` Anchor program
- `docs/general/architecture.md` — the regulated stack, for users
- `docs/general/fees.md` — the authoritative fee schedule
