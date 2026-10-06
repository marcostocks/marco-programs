# Runbook — BACKING SHORTFALL

```
CRITICAL — BACKING SHORTFALL: 200 0700.HK tokens are outstanding but only
150 shares back them (150 held at the custodian). Minting is blocked.
Halt the market and investigate.
```

**What it means.** More position tokens exist on Solana than the custodian
reports holding. If real, the "backed 1:1 by a regulated custodian" claim is
false for that name right now.

**What is already contained, automatically:**

- **Minting is blocked.** `attest_and_mint` refuses to run while the break is
  unresolved. Buys in flight park in `NEEDS_MANUAL` at the mint step. No
  unbacked token can be created while you work.
- **`/readyz` returns 503.** Anything gating on readiness will notice.

**What is not automatic:** halting the market, and telling users. Both are
yours. That is deliberate — a custodian reporting glitch must never halt a live
market unattended.

> **Do not resolve the break to make the alarm stop.** Resolving unblocks
> minting. It is the *last* step, not the first.

---

## 1. Triage — is it real? (target: 10 minutes)

Most shortfalls are reporting artefacts. Check these before anything drastic.

```bash
export ORCH=http://localhost:8080
export TOKEN=...   # operator token

# The break itself, and every other break in the same run
curl -s -H "Authorization: Bearer $TOKEN" "$ORCH/v1/recon/breaks?status=OPEN" | jq

# Live market state and the shortfall attached to it
curl -s -H "Authorization: Bearer $TOKEN" "$ORCH/v1/markets/0700.HK" | jq
```

Work down this list. Each rules out a benign cause:

| # | Check | Benign if… |
|---|---|---|
| 1 | **Is the custodian read stale?** Re-run reconciliation. Compare `asOf` on the custody position. | The second run is clean. A single stale read is not an incident — note it and watch for a pattern. |
| 2 | **Sells awaiting burn.** The check already allows for shares released by the custodian whose `settle_sell` has not landed (`CUSTODY_OUTBOUND`). Is there a *stuck* sell inflating that bucket? | A sell is genuinely in flight. If one has been stuck for hours, that intent is the incident — not the custodian. |
| 3 | **A corporate action.** A split, consolidation or rights issue changes share counts. The custodian applies it; the chain does not. | `listCorporateActions` shows an ex-date at or before today for the name. This will keep re-firing until handled — corporate actions are not yet implemented. |
| 4 | **A supply break alongside it.** Is `positions:<ticker>:supply` *also* open? | If supply drifted from the ledger too, the problem is more likely on the chain/ledger side than at the custodian. Investigate that first — it may be the cause. |
| 5 | **Delivery elections.** Did vault holders elect share delivery? Those shares legitimately leave custody. | `DELIVERY_PENDING` in the position ledger accounts for the difference. |

```bash
# Ledger's own view of the position accounts
curl -s -H "Authorization: Bearer $TOKEN" "$ORCH/v1/ledger/trial-balance" | jq

# Every intent touching this name, newest first
curl -s -H "Authorization: Bearer $TOKEN" "$ORCH/v1/intents?ticker=0700.HK&limit=50" | jq \
  '.intents[] | {id, state, stage, manualReason}'
```

> If a check keeps explaining the same recurring break, the reconciler is
> comparing the wrong figures. Raise it as a code defect. Do **not** paper over
> it by resolving the break each morning — a control that fires on normal
> operation is worse than no control, because it teaches people to ignore it.

---

## 2. Decide: halt or hold

Halt if **any** of these is true:

- The shortfall is real and unexplained after triage.
- The custodian cannot confirm the holding within your escalation window.
- The gap is growing between reconciliation runs.

Halting is safe and reversible. The on-chain program treats `PAUSED` as: no new
orders, but **in-flight orders still settle or cancel** — so a halt never
strands capital that has already left a wallet.

```bash
curl -s -X POST -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"status":"PAUSED","note":"Backing shortfall brk_xxx under investigation, INC-123"}' \
  "$ORCH/v1/markets/0700.HK/status" | jq
```

Do **not** halt if triage found a benign cause — fix the underlying issue
instead. Halting a healthy market has its own cost in revenue and trust.

---

## 3. Escalate

- **Custodian**, immediately: quote the account reference and the position
  reference from the affected settlements. Ask them to confirm the holding
  as of a specific timestamp and to send the holdings statement.
- **Broker**, if unsettled trades are involved: confirm settlement status and
  whether anything failed.
- **Internal**: whoever owns the incident. If the shortfall is real and
  material, this is a user-facing disclosure decision, not just an ops task.

Gather before you call — they will ask for all of it:

```bash
curl -s -H "Authorization: Bearer $TOKEN" "$ORCH/v1/intents/<INTENT_ID>" | jq \
  '{intent: .intent.facts, journal: .journal}'
```

You want: affected intent ids, custody references, broker trade references, the
document hashes attested on-chain, and the exact token supply and custody
figures with timestamps.

---

## 4. Resolve

Only once custody and token supply genuinely agree again.

```bash
# Confirm it is actually clean now
curl -s -X POST -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"tickers":["0700.HK"]}' "$ORCH/v1/recon/run" | jq '{clean, breaks: [.breaks[].scope]}'

# Close the break — the resolution is mandatory and permanent
curl -s -X POST -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"resolution":"Custodian mis-booked a transfer between sub-accounts; corrected and confirmed by holdings statement 2026-03-04. INC-123."}' \
  "$ORCH/v1/recon/breaks/<BREAK_ID>/resolve" | jq
```

Write the resolution for someone reading it in a year with no context. "Fixed"
is not a resolution.

Then release the parked intents — each needs its own note:

```bash
curl -s -X POST -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"note":"Backing confirmed after INC-123; safe to mint."}' \
  "$ORCH/v1/intents/<INTENT_ID>/resume" | jq '.intent.state'
```

And resume the market if you halted it:

```bash
curl -s -X POST -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"status":"ACTIVE","note":"INC-123 resolved, backing confirmed"}' \
  "$ORCH/v1/markets/0700.HK/status" | jq
```

Confirm `/readyz` is back to 200.

---

## 5. Afterwards

- If it was a **reconciler defect** (checks 2, 4, 5): fix the check. A control
  that cries wolf gets ignored, and then it is not a control.
- If it was a **corporate action**: that gap is known and unimplemented. Every
  future action on any name will do this again. Prioritise accordingly.
- If it was **real**: the incident is not closed when the numbers match. Work out
  how tokens came to exist without shares behind them, and what stops it
  recurring.

## Related

- `src/recon/reconciler.ts` — where the check lives
- `src/recon/safety.ts` — the mint interlock
- `test/safety.test.ts` — the behaviour this runbook depends on, pinned
