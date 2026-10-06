# Marco — APAC equity access on Solana

Hong Kong–listed shares, pre-IPO allocations and valuation futures on private
companies — one app, bought with stablecoins. Three Anchor programs, all
live on devnet, and every trade in the app is a transaction your wallet signs.

**[Open the app →](https://marcostocks.github.io/marco-programs/)**

## The app

`index.html` is the whole platform. One rail, one wallet, one theme across
three products:

| | | |
|---|---|---|
| **Markets · Trade · Portfolio** | Live HK/China tech and crypto prices, a spot order ticket, portfolio and research agents. Each of the 14 markets is its own `marco_spot` market on devnet: a buy escrows your USDC in a `place_buy`, and position tokens arrive when the operator confirms custody. With a wallet connected, Portfolio is that wallet's on-chain book. | `#/markets` |
| **Pre-IPO** | Subscription vaults for Moonshot AI and ByteDance, read live from `marco_vault` on devnet — cap, commitments, deadline and fee timing come from the vault account, and subscribing is a holder-signed `deposit`. | `#/preipo` · `#/preipo/moon` |
| **Futures** | Leveraged long/short on Moonshot AI's valuation, cash-settled at the IPO, against the `marco_futures` market `moon-fut-1`. Opening is `deposit_collateral` + `open_position` in one wallet-signed transaction, filled against the vAMM with no operator step; closing pays the margin back. The mark, depth ladder and position are read from chain. | `#/futures` · `#/futures/docs` |

Pre-IPO and Futures are complete apps of their own (`pre-ipo/web/`,
`valuation-futures/web/`), framed by the platform. The platform exposes
`window.MarcoShell`: an embedded app registers with it, takes the shell's
theme, borrows its wallet provider (so Phantom approves once, for all three),
and reports its own route so a deep link like `#/preipo/byte` can be shared.
Each still runs standalone when opened directly.

Connect Phantom set to **Devnet**. One wallet trades all three products. It
needs:

- **devnet SOL** for fees, and **test USDC** (mint `C7e4CP…G9ef`; the deploy
  wallet holds its mint authority, so `spl-token mint` funds a tester);
- for spot only, **eligibility** — `marco_spot` admits registered traders, once
  per wallet across every market:
  `npx --prefix platform/orchestrator tsx platform/orchestrator/scripts/register-trader.ts <WALLET>`;
- for spot fills, **the operator running** (`npm run operator` in `platform/`). It plays the
  broker and custodian: `deploy_buy` and `confirm_buy` for buys, the return
  wire and `settle_sell` for sells, polling every 20 s. Without it, orders
  stay escrowed and pending — they are never faked.

Without a wallet every chain-backed figure is still read live. A declined or
failed connection leaves you disconnected; only a page opened with no chain
bundle at all (straight off disk) falls back to a labelled simulation, and the
recorded tour (`?demo=1`) runs on simulations by design.

### Run it locally

```bash
cd platform
npm install
npm run build:chain   # optional — marco-chain.js is committed; rebuild after changing src/chain/
npm run build         # index.html + pre-ipo/web + valuation-futures/web
npm run serve         # http://localhost:8099, serving the repo root
npm run operator      # spot fills (needs ~/.config/solana/id.json = the operator)
```

`npm run setup:devnet` is what created the 14 spot markets and the futures
market; it is idempotent, and records every address in
`platform/shared/marco-artifacts/addresses.json`.

Wallets cannot inject into `file://` pages, so serve over HTTP to connect one.

**[Read the on-chain proof →](https://marcostocks.github.io/marco-programs/platform/docs/)** — both lifecycles walked end to end, every figure linked to the confirmed transaction it was read from.

Retail investors outside Hong Kong can rarely touch HKEX directly, and pre-IPO
allocations are effectively closed to them — they clear through brokers with
syndicate access and minimums far above a retail ticket. Marco puts both behind
a wallet: stablecoins in, a token representing a real custodied position out,
stablecoins back when it closes.

| Program | What it does | Devnet |
|---|---|---|
| **`marco_spot`** ([`spot/`](spot)) | Buy and sell HK-listed shares with USDC. Each position token is backed 1:1 by a share held in segregated custody. 15 instructions. | [`44PTF8po…Ggn9e`](https://explorer.solana.com/address/44PTF8po9JW5KK5VVH295XRFfNm1x9KuwcAVsvYGgn9e?cluster=devnet) |
| **`marco_vault`** ([`pre-ipo/`](pre-ipo)) | Pool subscriptions into an IPO allocation. Depositors hold a tradeable claim on the vault's net proceeds. 24 instructions. | [`CgJnDJHj…PMC8q`](https://explorer.solana.com/address/CgJnDJHjhkMgrkaky3Dp9dD89NzXRMP287bqmgCPMC8q?cluster=devnet) |
| **`marco_futures`** ([`valuation-futures/`](valuation-futures)) | Dated valuation futures on private companies: isolated margin, a vAMM mark, liquidation, an insurance fund, and settlement at the IPO. 13 instructions. | [`GCW6Gt86…3ztkW`](https://explorer.solana.com/address/GCW6Gt86tSVMqEwz6GkVNDWuzivDXCG2bzjp4AS3ztkW?cluster=devnet) |

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

**A valuation future, opened and closed** — from the app, on `moon-fut-1`
($50B anchor, 10× max, 0.30% taker fee), $1,000 margin at 5×.

| | | |
|---|---|---|
| `deposit_collateral` + `open_position` | $1,000 in, $4,901 long filled on the vAMM; mark $50.00B → $50.25B | [tx](https://explorer.solana.com/tx/5GEqyDDS6GMKewtDroa2aMrLYpahVEQr9DHKrbUA2tfNQ6vNMcoM2LB2YJgeaiDPSd1EhNT5qgCQYGrhwHxR2psK?cluster=devnet) |
| `close_position` | mark back to $50.00B, $971 paid out — the two taker fees went to the insurance fund | [tx](https://explorer.solana.com/tx/2ZmmGNKaTawJnxUT9mxCGU5gRSBDrBr42mV9XBMqSQA8xp9ssAQ7EL4Ttxuegvy5CJ8R8mqXGc7sfUdgw1Mtq6mi?cluster=devnet) |

## Run the tests

Each program is its own Anchor workspace, so run `anchor` from inside it.
Requires Anchor 0.31.1 and the Solana toolchain. Both point at Localnet, so
nothing here touches devnet.

```bash
cd spot && npm install && anchor test      # 21 tests
cd pre-ipo && npm install && anchor test   # 19 tests
cd valuation-futures && npm install && anchor test   # 6 tests
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

**Working** — all three programs deployed and upgradeable on public devnet;
full round trips on each; every order, subscription and futures position in the
app signed by an external wallet through the production interface; operator
instructions driven by a service rather than by hand; balances reconcile
exactly across every step shown above.

**Not yet** — the futures market's mark is the program's vAMM; the screen's
8-hour EMA and external-anchor convergence are described in its docs but are
not on chain, and settlement waits for the admin's
`settle_market`. Unlike the other two, that program holds trader margin and is
the counterparty, so it carries an insurance fund and liquidation; no keeper
runs `liquidate_position` yet. Spot prices on screen are live exchange feeds,
while fills are attested by the mock operator just inside your limit. Devnet
test USDC throughout, so no real
securities, funds or custody are involved. Custody attestations are synthetic: no custodian has signed anything.
No licensed broker, custodian or FX counterparty is integrated, and the
programs are unaudited. Operator keys are local files rather than an HSM or
multisig. This is a technical proof of concept, not an offer or solicitation.

## Layout

```
index.html          the app — built, single self-contained file (GitHub Pages serves the repo root)

spot/               marco_spot — Anchor workspace: programs/marco-spot, tests/, scripts/
                    (its trading UI is the platform itself: Markets · Trade · Portfolio)
pre-ipo/            marco_vault — Anchor workspace: programs/marco-vault, tests/, scripts/
  web/              the Pre-IPO app: src/ (build.mjs, parts/, art/) → index.html
valuation-futures/  marco_futures — Anchor workspace: programs/marco-futures, tests/, scripts/
  web/              the Valuation Futures app: src/ → index.html, how-it-works.html

platform/           everything else
  src/              the platform's source: parts/ (build.sh → ../index.html), chain/ → marco-chain.js
  marco-chain.js    the Solana client bundle all three pages load
  shared/           marco-artifacts: addresses.json (the only place an address comes from) + IDLs
  orchestrator/     the off-chain operator; scripts/auto-operator-devnet.ts fills spot orders
  scripts/devnet/   created the devnet markets (npm run setup:devnet)
  docs/             the on-chain proof page
```

The program inside `pre-ipo/` is named `marco_vault`, which is the name it is
deployed under; renaming the crate would change the binary.

`scripts/` in each holds the devnet tooling that created and drove the markets
and vaults above. They load a wallet from `~/.config/solana/id.json` at runtime
and contain no key material; the `devnet-*.json` files are run records of
public keys and signatures.
