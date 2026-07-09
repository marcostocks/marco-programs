"use client";

import { EXAMPLE_VAULTS } from "@/lib/constants";

export default function Home() {
  const featured = EXAMPLE_VAULTS[0];

  return (
    <div style={{ background: "var(--bg)", minHeight: "calc(100vh - 48px)" }}>

      {/* ══ TICKER BAR ══ */}
      <div style={{
        overflow: "hidden",
        borderBottom: "1px solid var(--border)",
        background: "var(--card)",
        padding: "12px 0",
      }}>
        <div style={{
          display: "flex", gap: 48, fontFamily: "var(--font-mono)", fontSize: 13,
          whiteSpace: "nowrap" as const,
        }}>
          {[
            { name: "BTC", price: "$103,842", change: "+2.4%", up: true },
            { name: "ETH", price: "$2,561", change: "+1.8%", up: true },
            { name: "SOL", price: "$172.40", change: "+3.1%", up: true },
            { name: "HKEX", price: "22,840", change: "+0.6%", up: true },
            { name: "HSI", price: "23,561", change: "-0.3%", up: false },
            { name: "USDC", price: "$1.00", change: "0.0%", up: true },
            { name: "BTC", price: "$103,842", change: "+2.4%", up: true },
            { name: "ETH", price: "$2,561", change: "+1.8%", up: true },
            { name: "SOL", price: "$172.40", change: "+3.1%", up: true },
          ].map((t, i) => (
            <span key={i} style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ color: "var(--white)", fontWeight: 500 }}>{t.name}</span>
              <span style={{ color: "var(--muted)" }}>{t.price}</span>
              <span style={{ color: t.up ? "var(--green)" : "var(--red)" }}>{t.change}</span>
              {i < 8 && <span style={{ color: "var(--muted-dim)", fontSize: 8 }}>•</span>}
            </span>
          ))}
        </div>
      </div>

      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "0 24px" }}>

        {/* ══ HERO ROW — 2-col grid: Featured vault | Stats sidebar ══ */}
        <div style={{
          display: "grid",
          gridTemplateColumns: "1fr 280px",
          gap: 12,
          marginTop: 24,
          marginBottom: 24,
        }}>

          {/* ── Featured Vault Card (like dash-hero-card) ── */}
          {featured && (
            <a href="/vault" style={{
              background: "var(--card)", border: "1px solid var(--border)",
              padding: "24px 28px 20px", textDecoration: "none", color: "inherit",
              display: "block", position: "relative", overflow: "hidden",
              transition: "border-color 0.3s",
            }}>
              {/* Label row */}
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                <span style={{
                  fontFamily: "var(--font-mono)", fontSize: 11, fontWeight: 600,
                  textTransform: "uppercase" as const, letterSpacing: "0.5px",
                  color: "var(--green)", background: "rgba(74,222,128,0.1)", padding: "3px 8px",
                }}>
                  Pre-IPO Vault
                </span>
                <span style={{
                  display: "flex", alignItems: "center", gap: 5,
                  fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--green)", fontWeight: 600,
                }}>
                  <span style={{
                    width: 6, height: 6, borderRadius: "50%", background: "var(--green)",
                    display: "inline-block",
                  }} />
                  OPEN
                </span>
              </div>

              {/* Company name */}
              <div style={{
                fontFamily: "var(--font-heading)", fontSize: 22, fontWeight: 600,
                color: "var(--white)", marginBottom: 4,
              }}>
                {featured.companyName}
              </div>
              <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 10 }}>
                {featured.ticker}.HK · {featured.sector} · {featured.exchange}
              </div>

              {/* Price + change */}
              <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 10 }}>
                <span style={{
                  fontFamily: "var(--font-mono)", fontSize: 26, fontWeight: 700, color: "var(--white)",
                }}>
                  {featured.offerPrice}
                </span>
                <span style={{
                  fontFamily: "var(--font-mono)", fontSize: 15, fontWeight: 600, color: "var(--green)",
                }}>
                  IPO {featured.ipoDate}
                </span>
              </div>

              {/* Progress bar area (like chart area) */}
              <div style={{ marginBottom: 12 }}>
                <div className="vault-progress-bar" style={{ height: 4 }}>
                  <div className="vault-progress-fill" style={{ width: "60%" }} />
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6 }}>
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--muted-dim)" }}>
                    $1.80M deposited
                  </span>
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--muted-dim)" }}>
                    $3.0M cap
                  </span>
                </div>
              </div>

              {/* Volume-style stats */}
              <div style={{
                display: "flex", gap: 24, fontFamily: "var(--font-mono)", fontSize: 10,
                color: "var(--muted-dim)", marginBottom: 12,
              }}>
                <span>Mkt Cap <span style={{ color: "var(--muted)" }}>{featured.marketCap}</span></span>
                <span>Fee <span style={{ color: "var(--muted)" }}>{featured.feeRateBps / 100}% + {featured.performanceFeeBps / 100}%</span></span>
                <span>Duration <span style={{ color: "var(--muted)" }}>~2 weeks</span></span>
              </div>

              {/* Trade button */}
              <button style={{
                position: "absolute" as const, top: 24, right: 24,
                fontFamily: "var(--font-heading)", fontSize: 12, fontWeight: 600,
                padding: "8px 18px", background: "var(--green)", color: "#000",
                border: "none", cursor: "pointer",
              }}>
                Deposit →
              </button>

              {/* Description area (like tape) */}
              <div style={{
                borderTop: "1px solid var(--border)", paddingTop: 10, marginTop: 4,
              }}>
                <div style={{
                  fontFamily: "var(--font-mono)", fontSize: 9, color: "var(--muted-dim)",
                  textTransform: "uppercase" as const, letterSpacing: "0.8px", marginBottom: 6,
                }}>
                  Company Overview
                </div>
                <div style={{ fontSize: 12, color: "var(--muted)", lineHeight: 1.6 }}>
                  {featured.companyDescription}
                </div>
              </div>
            </a>
          )}

          {/* ── Right Sidebar (like dash-trending) ── */}
          <div style={{
            background: "var(--card)", border: "1px solid var(--border)",
            padding: "14px 16px", display: "flex", flexDirection: "column",
          }}>
            <div style={{
              display: "flex", justifyContent: "space-between", alignItems: "center",
              marginBottom: 14, paddingBottom: 10, borderBottom: "1px solid var(--border)",
            }}>
              <span style={{
                fontFamily: "var(--font-heading)", fontSize: 12, fontWeight: 600,
                color: "var(--white)",
              }}>
                Vault Stats
              </span>
              <span style={{
                fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--green)", fontWeight: 600,
              }}>
                LIVE
              </span>
            </div>

            {/* Stat rows */}
            {[
              { label: "Deposit Cap", value: `$${(featured.depositCap / 1e6).toFixed(0)}M USDC` },
              { label: "Vault Fill", value: "60.0%", highlight: true },
              { label: "Total Deposited", value: "$1.80M" },
              { label: "Offer Price", value: featured.offerPrice },
              { label: "Market Cap", value: featured.marketCap },
              { label: "Mgmt Fee", value: `${featured.feeRateBps / 100}%` },
              { label: "Perf Fee", value: `${featured.performanceFeeBps / 100}%` },
              { label: "Settlement", value: "USDC on Solana" },
              { label: "Network", value: "Solana" },
              { label: "Audit", value: "Polynomial" },
            ].map((s) => (
              <div key={s.label} style={{
                display: "flex", justifyContent: "space-between", alignItems: "center",
                padding: "8px 0", borderBottom: "1px solid rgba(255,255,255,0.03)",
              }}>
                <span style={{
                  fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--muted-dim)",
                }}>
                  {s.label}
                </span>
                <span style={{
                  fontFamily: "var(--font-mono)", fontSize: 11, fontWeight: 500,
                  color: s.highlight ? "var(--green)" : "var(--white)",
                }}>
                  {s.value}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* ══ PRE-IPO PIPELINE + HOW IT WORKS — second hero row ══ */}
        <div style={{
          display: "grid",
          gridTemplateColumns: "1fr 280px",
          gap: 12,
          marginBottom: 24,
        }}>

          {/* ── How It Works (like dash-preipo card) ── */}
          <div style={{
            background: "var(--card)", border: "1px solid var(--border)",
            padding: "16px 20px",
          }}>
            <div style={{
              display: "flex", justifyContent: "space-between", alignItems: "center",
              marginBottom: 14, paddingBottom: 10, borderBottom: "1px solid var(--border)",
            }}>
              <span style={{
                fontFamily: "var(--font-heading)", fontSize: 12, fontWeight: 600,
                color: "var(--white)", display: "flex", alignItems: "center", gap: 8,
              }}>
                How It Works
                <span style={{
                  fontFamily: "var(--font-mono)", fontSize: 9, fontWeight: 600,
                  padding: "2px 6px", background: "rgba(74,222,128,0.12)",
                  color: "var(--green)", letterSpacing: "0.5px",
                }}>
                  3 STEPS
                </span>
              </span>
            </div>

            {[
              { n: "01", title: "Deposit USDC", desc: "Connect your Solana wallet. Deposit USDC into the vault during the funding window. First come, first served up to cap." },
              { n: "02", title: "IPO Subscription", desc: "Our licensed HK broker subscribes to the IPO on HKEX. Shares allocated on listing day, sold at market price." },
              { n: "03", title: "Redeem Proceeds", desc: "Proceeds converted to USDC and returned to the vault. Burn your shares, receive pro-rata settlement. ~2 week cycle." },
            ].map((step, i) => (
              <div key={step.n} style={{
                display: "flex", alignItems: "flex-start", padding: "10px 0",
                borderBottom: i < 2 ? "1px solid rgba(255,255,255,0.03)" : "none",
                gap: 12,
              }}>
                <span style={{
                  fontFamily: "var(--font-mono)", fontSize: 11, fontWeight: 600,
                  color: "var(--green)", minWidth: 20,
                }}>
                  {step.n}
                </span>
                <div>
                  <div style={{
                    fontFamily: "var(--font-heading)", fontSize: 13, fontWeight: 500,
                    color: "var(--white)", marginBottom: 3,
                  }}>
                    {step.title}
                  </div>
                  <div style={{ fontSize: 12, color: "var(--muted)", lineHeight: 1.6 }}>
                    {step.desc}
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* ── Comparable IPOs sidebar (like dash-social) ── */}
          <div style={{
            background: "var(--card)", border: "1px solid var(--border)",
            padding: "14px 16px", display: "flex", flexDirection: "column",
          }}>
            <div style={{
              display: "flex", justifyContent: "space-between", alignItems: "center",
              marginBottom: 14, paddingBottom: 10, borderBottom: "1px solid var(--border)",
            }}>
              <span style={{
                fontFamily: "var(--font-heading)", fontSize: 12, fontWeight: 600,
                color: "var(--white)",
              }}>
                Comparable IPOs
              </span>
            </div>

            <div style={{ flex: 1 }}>
              {featured.comparableIpos.map((c, i) => (
                <div key={c.ticker} style={{
                  padding: "9px 0",
                  borderBottom: i < featured.comparableIpos.length - 1
                    ? "1px solid rgba(255,255,255,0.03)" : "none",
                }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div>
                      <div style={{
                        fontFamily: "var(--font-heading)", fontSize: 13, fontWeight: 500,
                        color: "var(--white)",
                      }}>
                        {c.name}
                      </div>
                      <div style={{
                        fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--muted-dim)",
                      }}>
                        {c.ticker} · {c.exchange}
                      </div>
                    </div>
                    <span style={{
                      fontFamily: "var(--font-mono)", fontSize: 13, fontWeight: 500,
                      color: "var(--green)",
                    }}>
                      {c.return}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ══ INFRASTRUCTURE — 3-col movers-style cards ══ */}
        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, 1fr)",
          gap: 12,
          marginBottom: 16,
        }}>
          {[
            {
              title: "Solana",
              items: [
                { label: "Vault Contract", detail: "Anchor / Rust" },
                { label: "Share Tokens", detail: "SPL 1:1 mint" },
                { label: "Deposits", detail: "USDC (6 decimals)" },
              ],
            },
            {
              title: "Broker",
              items: [
                { label: "License", detail: "HKEX Member" },
                { label: "Subscription", detail: "Institutional-grade" },
                { label: "Settlement", detail: "T+2 standard" },
              ],
            },
            {
              title: "Security",
              items: [
                { label: "Audit", detail: "Polynomial" },
                { label: "Findings", detail: "7/7 addressed" },
                { label: "Lifecycle", detail: "5-phase gated" },
              ],
            },
          ].map((card) => (
            <div key={card.title} style={{
              background: "var(--card)", border: "1px solid var(--border)", padding: "12px 14px",
            }}>
              <div style={{
                display: "flex", justifyContent: "space-between", alignItems: "center",
                marginBottom: 10,
              }}>
                <h3 style={{
                  fontFamily: "var(--font-heading)", fontSize: 16, fontWeight: 600,
                  color: "var(--white)", margin: 0,
                }}>
                  {card.title}
                </h3>
              </div>
              {card.items.map((item, i) => (
                <div key={item.label} style={{
                  display: "flex", justifyContent: "space-between", alignItems: "center",
                  padding: "8px 0",
                  borderBottom: i < card.items.length - 1
                    ? "1px solid rgba(255,255,255,0.04)" : "none",
                }}>
                  <span style={{
                    fontFamily: "var(--font-body)", fontSize: 11, color: "var(--muted)",
                  }}>
                    {item.label}
                  </span>
                  <span style={{
                    fontFamily: "var(--font-mono)", fontSize: 11, fontWeight: 500,
                    color: "var(--white)",
                  }}>
                    {item.detail}
                  </span>
                </div>
              ))}
            </div>
          ))}
        </div>

        {/* ══ WAITLIST CTA — like community-cta section ══ */}
        <div style={{
          textAlign: "center" as const, padding: "48px 0 60px",
        }}>
          <h2 style={{
            fontFamily: "var(--font-heading)", fontSize: 32, fontWeight: 700,
            color: "var(--white)", marginBottom: 12,
          }}>
            Get early access to future vaults
          </h2>
          <p style={{
            fontSize: 15, color: "var(--muted)", marginBottom: 32,
            maxWidth: 460, marginLeft: "auto", marginRight: "auto", lineHeight: 1.7,
          }}>
            Early waitlist members earn priority access and higher allocation caps on every vault.
          </p>
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
            maxWidth: 400, margin: "0 auto",
          }}>
            <input
              type="email"
              placeholder="you@email.com"
              style={{
                flex: 1, padding: "12px 16px",
                background: "var(--card)", border: "1px solid var(--border)",
                color: "var(--white)", fontFamily: "var(--font-body)", fontSize: 14,
                outline: "none",
              }}
            />
            <button style={{
              display: "inline-flex", alignItems: "center",
              padding: "12px 28px", border: "none",
              background: "var(--white)", color: "#000",
              fontSize: 14, fontWeight: 600, letterSpacing: "0.3px",
              cursor: "pointer", transition: "all 0.25s",
            }}>
              Join Waitlist
            </button>
          </div>
        </div>
      </div>

      {/* ══ FOOTER ══ */}
      <footer style={{
        borderTop: "1px solid var(--border)", padding: "24px 0",
      }}>
        <div style={{
          maxWidth: 1200, margin: "0 auto", padding: "0 24px",
          display: "flex", justifyContent: "space-between", alignItems: "flex-start",
        }}>
          <p style={{
            fontSize: 11, color: "var(--muted-dim)", lineHeight: 1.7, maxWidth: 700,
          }}>
            Obsidian provides access to Hong Kong IPO subscriptions via on-chain vaults settled in USDC.
            IPO allocation is not guaranteed. Past IPO performance does not guarantee future results.
            Not financial advice. Qualified investors only.
          </p>
          <span style={{
            fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--muted-dim)",
            whiteSpace: "nowrap" as const,
          }}>
            Built on Solana
          </span>
        </div>
      </footer>
    </div>
  );
}
