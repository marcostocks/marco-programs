# Counterparty integration checklist

What to ask each candidate before signing, and what the adapter needs from them
afterwards. Everything here maps to a specific method in `src/ports/`, so a
"no" against a required item is a concrete integration cost, not a vague concern.

Send the relevant section to each candidate during diligence. The questions are
ordered so the deal-breakers come first.

---

## Universal — ask all three

These decide whether an integration is *safe*, independent of what the
counterparty does.

| # | Question | Why it matters | Port |
|---|---|---|---|
| U1 | **Do you support client-supplied idempotency keys on every mutating call?** What is the retention window, and what do you return on a repeat? | This is the single most important question on the page. Without it, a network timeout on a payment or an order becomes an unresolvable question. We send deterministic references (`<intentId>.<step>`); a repeat must return the original object, not create a second one. | all |
| U2 | **Can we look an object up by our own reference**, not just yours? | Crash recovery works by asking "what happened to `int_01J….fund_execution`". If we can only query by *your* id, and we died before storing it, the money is unaccounted for. | all |
| U3 | What is the **maximum length and permitted character set** of that reference field? | FIX `ClOrdID` is conventionally 20 chars; bank payment references are often 16 or 35. Drives `boundedRef()`. | all |
| U4 | Do you send **webhooks**? Signing scheme, replay protection, retry policy, and do you echo our client reference in the payload? | Without an echoed reference we must keep a mapping table, which is another thing that can be lost. | all |
| U5 | **Sandbox**: full-fidelity, with a way to drive state transitions on demand (settle this, fail that)? | Every failure path in this service needs a test. A sandbox that only does happy paths tests nothing worth testing. | all |
| U6 | **Rate limits** — per second, per day, and behaviour at the limit (429 with `Retry-After`, or silent drop)? | Decides backoff policy and whether a 429 is `Retryable` or `Ambiguous`. | all |
| U7 | Authentication: mTLS, signed requests, OAuth client credentials? **Key rotation without downtime?** | Rotation-without-downtime is not optional for a service that cannot be stopped mid-settlement. | all |
| U8 | Statement/reporting API for **reconciliation**, with a stable cursor or date range? | Recon is the control that catches everything else. A daily PDF is not an integration. | all |
| U9 | Operational SLA, support hours **in HKT**, and the escalation path for a stuck settlement. | Our parked-intent path ends at a human calling someone. | — |
| U10 | Contractual position on **liability for a duplicated instruction** caused by an ambiguous response. | The one case idempotency is designed to prevent. Get it in writing. | — |

---

## Money Services Business

Implements `src/ports/msb.ts`. This is the on/off ramp and the rails.

### Required

| # | Requirement | Method |
|---|---|---|
| M1 | **A stable Solana address to receive USDC.** It is written into `marco-spot` at market creation as the immutable settlement destination and **cannot be rotated without redeploying a market.** Confirm they can commit to a fixed address, or that they support a per-market sub-address that is equally permanent. | `getDepositInstructions` |
| M2 | USDC → HKD conversion with a **quote you can bind to**, and a worst-acceptable-rate guard. A conversion that settles at an arbitrary rate can under-fund an order that has already been placed. | `quoteConversion`, `createConversion` |
| M3 | HKD payout to a **named beneficiary registered out of band** (the broker's settlement account). We never transmit raw account numbers — the API must take an opaque beneficiary id. | `createPayout` |
| M4 | HKD → USDC repatriation, paying out to a Solana address. | `createConversion`, `createPayout` |
| M5 | Per-currency balances and a statement with our client reference on each line. | `getBalances`, `listStatement` |
| M6 | Explicit **terminal-vs-pending status** on conversions and payouts. "Processing" that can still become "returned" days later must be distinguishable from "settled". | `Conversion.status`, `Payout.status` |
| M7 | **Travel-rule** field support (originator/beneficiary) for transfers above the local threshold. | `CreatePayoutRequest.travelRule` |

### Ask about

- **Licensing**: which regulator, which licence class, and does it cover both the
  stablecoin leg and the HKD leg? Marco's users are told this is licensed
  infrastructure — that claim has to survive scrutiny.
- **Settlement times** for each leg, and the cut-off in HKT. The buffer policy in
  `.env` is sized from this: a T+1 crossing needs a materially larger working
  balance than a same-day one.
- **FX spread and fee schedule**, and whether the quoted rate already includes
  the spread. Feeds `EXPENSE_MSB_FEE` and the treasury's cost model.
- **Maximum single transfer and daily aggregate.** Directly caps vault size.
- What happens to a **returned wire** — is it automatic, and do we get a webhook?
- Do they hold client money in **segregated** accounts?

---

## Executing broker

Implements `src/ports/broker.ts`. SFC-licensed, acting as principal on HKEX.

### Required

| # | Requirement | Method |
|---|---|---|
| B1 | **Limit orders on HKEX** with a client order id we supply. Market orders are unusable: the program refuses to attest a fill worse than the trader's limit, so a market fill can strand a position that can never be minted. | `placeOrder` |
| B2 | **A trade reference on each fill that the custodian also sees.** This is the join key between the fill and the settlement. Without a shared reference, matching is manual. Confirm with the broker *and* the custodian that it is the same field. | `BrokerOrder.tradeReference` |
| B3 | Fill detail: executed quantity, average price, **commission and levies broken out** (stamp duty, SFC levy, HKEX trading fee). | `Execution` |
| B4 | **Intraday buying power**, not just an end-of-day figure. The hybrid buffer is reconciled against this. | `getBuyingPower` |
| B5 | Reference data: **board lot size**, tick size, and current trading status per name. An order that is not a whole number of lots is rejected by the exchange. | `getInstrument` |
| B6 | Order cancellation, with a clear answer for the race where a cancel and a fill cross. | `cancelOrder` |
| B7 | Same-day execution and cash statements for reconciliation. | `listExecutions`, `listCashStatement` |

### IPO subscription — required for the pre-IPO vaults

| # | Requirement | Method |
|---|---|---|
| B8 | **Programmatic HKEX IPO application**, or a documented file/manual process with a reference we can poll. Many HK brokers only offer this through a portal — if so, the adapter wraps a human step and the vault mandate must reflect that honestly. | `placeIpoSubscription` |
| B9 | Ballot result: **allocated quantity, consideration consumed, and the registrar refund.** | `IpoSubscription` |
| B10 | Listing reference data: final offer price, lot size, application window, expected listing date. | `getIpoListing` |
| B11 | The **application funding deadline**, in HKT. This is a hard wall that sets the vault's sealing time — the mandate must seal with enough margin to source and deploy. | — |

### Ask about

- **SFC licence classes held** (Type 1 dealing, Type 4 advising, Type 9 asset
  management) and whether acting as principal for an omnibus account is within
  scope.
- **Omnibus account structure**: does the broker require beneficial-owner
  disclosure per trade, periodically, or on request? Marco carries verification
  on every beneficial owner and evidences it on request — confirm that is
  acceptable to them.
- **Halt and suspension handling**: what happens to a resting order?
- Commission schedule and any per-order minimum. The mock assumes bps with a
  floor; replace with the real one.
- **Short-selling and settlement-failure** policy — what happens if the
  custodian cannot deliver on a sale.

---

## Custodian

Implements `src/ports/custodian.ts`. This is the port that makes the backing
claim verifiable instead of asserted.

### Required

| # | Requirement | Method |
|---|---|---|
| C1 | **A position reference for each settled holding, retrievable by API.** `confirm_buy` will not mint without it and rejects zeroed values. This is non-negotiable — without it Marco cannot mint at all. | `SettlementRecord.positionReference` |
| C2 | **A retrievable settlement document** (contract note / settlement confirmation) whose bytes are stable. We hash it and publish the digest on-chain so a holder can verify a document they are shown is genuine and unaltered. If the document is regenerated with a timestamp on each fetch, the hash is worthless — confirm byte stability explicitly. | `getDocument` |
| C3 | **Settlement lookup by the broker's trade reference.** See B2. | `getSettlementByTrade` |
| C4 | Position reporting split into **settled, pending-in and pending-out.** Reconciliation compares settled holdings against token supply; conflating in-flight quantities produces false breaks every settlement cycle. | `listPositions` |
| C5 | **Segregated, bankruptcy-remote** accounts held on trust, with documentation we can show users. | — |
| C6 | Settlement-failure notification with a reason. | `SettlementRecord.failureReason` |

### Required for the vault share-delivery election

| # | Requirement | Method |
|---|---|---|
| C7 | **Transfer out to a holder's external brokerage account**, instructed by an opaque beneficiary reference registered out of band. | `requestDelivery` |
| C8 | Delivery status through to confirmed receipt. | `getDelivery` |

### Ask about

- **Regulatory status and jurisdiction**, and the legal opinion on
  bankruptcy-remoteness. Marco tells users their interest is protected even
  though the account is in Marco's name; that needs to be true and evidenced.
- **Custody margin**: basis, rate, and billing frequency. Billed off-chain, and
  it is one of Marco's three revenue lines — confirm the arithmetic.
- **Corporate actions**: what is notified, when, and in what format. Splits and
  rights issues change share counts and will break the 1:1 invariant unless
  reconciliation can explain them. Dividends are passed through in USDC per the
  product docs and need a record-date mechanism.
- **Settlement cycle** for HKEX equities (T+2) and any earlier internal cut-off.
- Whether they will **co-sign an attestation**. The on-chain attestation
  establishes what was recorded and that the documents are unaltered; it cannot
  independently prove the custodian holds the shares. A custodian- or
  auditor-co-signed attestation is the intended enhancement.
- **Audit and proof-of-reserves**: frequency, auditor, and whether the report is
  publishable.

---

## Compliance / KYC provider

Implements `src/ports/compliance.ts`.

| # | Requirement | Method |
|---|---|---|
| K1 | Identity verification with **tiered assurance levels**, and professional/accredited investor status as a distinct flag — pre-IPO offerings may be restricted to professional investors. | `getVerification` |
| K2 | **Point-in-time screening** on a specific action, not just onboarding. Sanctions lists and wallet risk scores change between orders. | `screen` |
| K3 | **On-chain analytics** on the counterparty wallet — source-of-funds and flow analysis, not just a name check. | `ScreeningRequest.counterpartyAddress` |
| K4 | A three-way outcome: clear / review / block. A binary result forces us to either reject legitimate users or wave through flagged ones. | `ScreeningDecision` |
| K5 | Per-account velocity and notional limits. | `assessLimits` |
| K6 | Jurisdiction eligibility rules, configurable per offering. | `requiredTier` |

**The orchestrator stores outcomes, never documents or identity data.** Those
stay with the provider licensed to hold them. Any adapter that pulls PII into
this service is wrong.

---

## Before the first real transaction

- [ ] Every port has an adapter with contract tests **green against the
      provider's sandbox**, covering the same failure paths the mocks cover.
- [ ] Idempotency verified empirically: send the same request twice, confirm one
      object exists. Do this for every mutating call, not just one.
- [ ] Ambiguity verified: kill the connection mid-request, then resolve by
      client reference. This is the recovery path that protects real money.
- [ ] Webhook signature verification tested against a **tampered** body and a
      **replayed** delivery.
- [ ] The MSB's Solana address is fixed and written into each market.
- [ ] Postgres persistence in place; the in-memory store is single-instance only.
- [ ] The operator signer is an HSM/KMS key or a Squads proposal flow.
- [ ] Treasury buffer sized from **measured** settlement times, not estimates.
- [ ] Reconciliation runs on a schedule, with alerting on `CRITICAL` breaks.
- [ ] A runbook exists for a parked intent: who is called, and what they check.
- [ ] Both Anchor programs are independently audited. Neither is today.
