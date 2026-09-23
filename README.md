# Marco — Chinese equity access on Solana

Hong Kong–listed shares and pre-IPO allocations, bought with stablecoins and
backed 1:1 by real shares in regulated custody. Two Anchor programs, both live
on devnet and both exercised through their full lifecycle on chain.

**[Read the on-chain proof →](https://marcostocks.github.io/marco-programs/docs/)** — both lifecycles walked end to end, every figure linked to the confirmed transaction it was read from.

Retail investors outside Hong Kong can rarely touch HKEX directly, and pre-IPO
allocations are effectively closed to them — they clear through brokers with
syndicate access and minimums far above a retail ticket. Marco puts both behind
a wallet: stablecoins in, a token representing a real custodied position out,
stablecoins back when it closes.

| Program | What it does | Devnet |
|---|---|---|
| **`marco_spot`** ([`spot/`](spot)) | Buy and sell HK-listed shares with USDC. Each position token is backed 1:1 by a share held in segregated custody. 15 instructions. | [`44PTF8po…Ggn9e`](https://explorer.solana.com/address/44PTF8po9JW5KK5VVH295XRFfNm1x9KuwcAVsvYGgn9e?cluster=devnet) |
| **`marco_vault`** ([`pre-ipo/`](pre-ipo)) | Pool subscriptions into an IPO allocation. Depositors hold a tradeable claim on the vault's net proceeds. 24 instructions. | [`CgJnDJHj…PMC8q`](https://explorer.solana.com/address/CgJnDJHjhkMgrkaky3Dp9dD89NzXRMP287bqmgCPMC8q?cluster=devnet) |

## How it works

Money moves through three counterparties: an **MSB** converting USDC to HKD, an
**SFC-licensed broker** executing on HKEX, and a **custodian** holding the
shares 1:1 and segregated. All three are simulated on devnet today — see
[Scope](#scope). Marco never takes custody of client funds — it
is the orchestrator, and each program is constrained so that it *cannot* pay
anyone but the one address fixed when the market or vault was created.

Two design decisions carry most of the weight.

**The escrow is the authorisation.** There is no HTTP endpoint that starts an
order. The off-chain operator builds work only from an observed on-chain
escrow, which is why the trader-initiated instructions emit events. A wallet
whose funds are not locked on chain has not agreed to anything, so there is
nothing an API key could be stolen to trigger.

**Nothing mints without evidence.** `confirm_buy` requires a custody
attestation with a supporting document hash before a single position token is
created, and refuses a fill worse than the trader's limit price or smaller than
their minimum quantity. On the way out, `place_sell` escrows the tokens rather
than burning them — while the broker is still selling, the custodian genuinely
holds the share, and supply should say so. They burn in the same transaction
that pays the seller.

The vault runs a lifecycle gated on real events rather than dates:

```
Scheduled → Funding → Sealed → Sourcing → Sourced → Deployed
          → Live → Realized → Claimable → Concluded
```

It cannot mark a listing that has not happened, and `settle` reads the vault's
actual USDC balance, so redemption cannot open against cash that has not
arrived. Holders may elect share delivery instead of cash. The protocol fee is
a flat percentage charged either at deposit or at redemption, fixed per vault
before the first deposit and never changed after.

## Verify it on chain

Two complete lifecycles, on devnet. Every figure below is read from a confirmed
transaction.

**A spot round trip** — one wallet buys 7 shares of 3690.HK at $142.50 and
sells them at $150, on a market whose spread is 25 bps per leg.

| | | |
|---|---|---|
| `place_buy` | $1,000 leaves the wallet, order opens | [tx](https://explorer.solana.com/tx/3PLQQZLuFR3N6bNdti7Fs8qpo4uUH5Tb2pxZsqH5q9LhHeoDe6UrKWcrJHeQAwpPWZ1khtLLpxwH8CaLhbzhxoBF?cluster=devnet) |
| `deploy_buy` | $997.50 to the MSB, $2.50 spread retained | [tx](https://explorer.solana.com/tx/3pBCiTuue4Uan8Q4119G2LqYwHpckhtPGgrrEAFbmm5EGqBm3XzXfVMaeXTW9GoW5vuWBJwfNkGhc4U4fRZ2Q8nk?cluster=devnet) |
| `confirm_buy` | custody attested, 7 tokens minted | [tx](https://explorer.solana.com/tx/4tEjCpA8kRyxzdnR8EFEiQ1ZzA2NFFoJdY1zjcEAZ1zsgfgw6qk7eej3r1z7ivrVg5D6GnQaGikkK6x9LXhnJVWL?cluster=devnet) |
| `place_sell` | tokens escrowed, not burned | [tx](https://explorer.solana.com/tx/5y23XouswLJPLQjDsSgVHCHS7LcbgxwYAosfoE9d9JP8yRAyPRVZgSZC6ED6XcPTBHHaM1B4wX1DwE9cNXGCYs1L?cluster=devnet) |
| `settle_sell` | tokens burn, $1,047.375 paid | [tx](https://explorer.solana.com/tx/qHs2NRUUPL9qAe2uyQhNY8VUofPxJCFmCvUCqrAC3Qf4oFKCmoA6QDmseT74ouNk4JUXXTE16oh8ZQ3iPbF2KUM?cluster=devnet) |

$997.50 deployed is exactly 7 × $142.50, and $1,050 returned is exactly
7 × $150. Both legs reconcile to the cent.

**A vault, subscribed to concluded** — $1,000 in, deal returns 20%, 5% charged
on the redemption.

| | | |
|---|---|---|
| `deposit` | $1,000 in, 1,000 claim tokens minted 1:1, frozen | [tx](https://explorer.solana.com/tx/2ifgfocMyXDmCebuR6awuYo2LZQ3Veg9FkWJn5pMAb2gBb591Y37qyoKREpR1Pdqr82VJH9YS4S1ZXu9tjmypEpr?cluster=devnet) |
| `deploy_capital` | $1,000 to the MSB, the only address it can pay | [tx](https://explorer.solana.com/tx/2apYV7oZVAbUeH6GvW5Huf9WoU4BxGUqPeFdBRksLoWThFML1ZPA38DAU9VcNvSLm4c44upynKinJepETLUSFnnZ?cluster=devnet) |
| `settle` | reads the real balance — $1,200 — opens redemption | [tx](https://explorer.solana.com/tx/5HJo9FUWXB9jXpADC95ZtgQYH3kZ5EJbfJWjqMXDmxbik6BqhS4rJz82WjJjaqhQgMZSVWbXCE8KBfwEhUyjWLu?cluster=devnet) |
| `claim` | 1,000 tokens burn, $1,140 paid, $60 fee retained | [tx](https://explorer.solana.com/tx/36ECFZe9bJxoLJjVqtemhVdd2JMHBwD93NNP3hoXu6yKZ2tpMWovEMiEj41NiP7DRb3nWxy3GRam44uDS2MqNES5?cluster=devnet) |

Each phase transition is its own transaction — `open_funding`, `seal_funding`,
`begin_sourcing`, `confirm_allocation`, `mark_listed`, `mark_realized` — all
visible in the [vault's history](https://explorer.solana.com/address/9scqYnGfYGDS7CUm4LxFV4EScBMLntjAzSK8fUMEiZA?cluster=devnet).

## Run the tests

Each program is its own Anchor workspace, so run `anchor` from inside it.
Requires Anchor 0.31.1 and the Solana toolchain. Both point at Localnet, so
nothing here touches devnet.

```bash
cd spot && npm install && anchor test      # 21 tests
cd pre-ipo && npm install && anchor test   # 19 tests
```

## Security

Both programs were put through an adversarial review, and the findings are
fixed with regression tests holding them closed. Two were high severity, and
both began as working exploits against this code — the proofs of concept live
in [`spot/tests/security.ts`](spot/tests/security.ts), inverted into tests that
assert the exploit is now refused with a specific error.

- **`settle_sell` paid out of other traders' escrowed funds.** One pooled USDC
  account holds pending buy escrow, earned spread and returned sale proceeds,
  and payouts checked only the SPL balance. A settlement raised before the
  broker returned anything paid one trader out of another's escrow.
  `Market::unreserved_usdc` now bounds every payout not drawn against the
  order's own escrow.
- **`confirm_buy` had no minimum-quantity protection.** A limit price caps what
  each share may cost but says nothing about how many come back; a 10,000 USDC
  order could be filled with a single share. `min_shares_out` is now required
  and enforced.
- **`sweep_fee` could send fees to any token account**, and the constraint
  comment claimed a validation that did not exist.
- **`settle` would succeed with an empty cash cohort**, stranding the balance
  permanently unclaimable if every holder elected share delivery. It now fails
  loudly instead.

## Scope

Honest about what is and is not established:

**Working** — both programs deployed and upgradeable on public devnet; full
round trips on each; order entry signed by an external wallet through the
production interface; operator instructions driven by a service rather than by
hand; balances reconcile exactly across every step shown above.

**Not yet** — devnet test USDC, so no real securities, funds or custody are
involved. Custody attestations are synthetic: no custodian has signed anything.
No licensed broker, custodian or FX counterparty is integrated, and the
programs are unaudited. Operator keys are local files rather than an HSM or
multisig. This is a technical proof of concept, not an offer or solicitation.

## Layout

```
spot/     Anchor workspace — programs/marco-spot,  tests/, scripts/
pre-ipo/  Anchor workspace — programs/marco-vault, tests/, scripts/
```

The program inside `pre-ipo/` is named `marco_vault`, which is the name it is
deployed under; renaming the crate would change the binary.

`scripts/` in each holds the devnet tooling that created and drove the markets
and vaults above. They load a wallet from `~/.config/solana/id.json` at runtime
and contain no key material; the `devnet-*.json` files are run records of
public keys and signatures.
