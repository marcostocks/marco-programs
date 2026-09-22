"use client";

import { useState, useEffect, useRef } from "react";
import { EXAMPLE_VAULTS } from "@/lib/constants";
import VaultStatus from "@/components/vault/VaultStatus";
import Countdown from "@/components/vault/Countdown";

const totalDeposits = 1_800_000;
const userUsdcBalance = 250_000;

const RECENT_ACTIVITY = [
  { addr: "9xKm...4fDe", amount: "$5,000", time: "2m ago" },
  { addr: "7bQr...8nWx", amount: "$12,000", time: "8m ago" },
  { addr: "3jFp...2kLs", amount: "$1,500", time: "14m ago" },
  { addr: "DwNx...9vRe", amount: "$25,000", time: "22m ago" },
  { addr: "5tHm...6aCz", amount: "$800", time: "31m ago" },
];

const NEWS_ITEMS = [
  {
    date: "May 16, 2026",
    source: "HKEX Filings",
    title: "RobotPhoenix files updated prospectus with revised offer price range",
    tag: "Filing",
  },
  {
    date: "May 14, 2026",
    source: "South China Morning Post",
    title: "Shenzhen robotics firm RobotPhoenix targets HK$7.5B valuation in HKEX debut",
    tag: "Press",
  },
  {
    date: "May 10, 2026",
    source: "Marco Research",
    title: "RobotPhoenix IPO Preview: Industrial robotics leader with strong unit economics",
    tag: "Report",
  },
  {
    date: "May 7, 2026",
    source: "Reuters",
    title: "China industrial robotics sector sees 34% YoY growth in Q1 2026 shipments",
    tag: "Industry",
  },
  {
    date: "May 3, 2026",
    source: "Bloomberg",
    title: "RobotPhoenix cornerstone investors include Sequoia China and Hillhouse Capital",
    tag: "Press",
  },
];

const REPORTS = [
  { title: "IPO Preview — RobotPhoenix (9608.HK)", author: "Marco Research", date: "May 10, 2026", pages: 24 },
  { title: "China Industrial Robotics Market Map 2026", author: "Marco Research", date: "Apr 28, 2026", pages: 18 },
  { title: "HKEX Prospectus — RobotPhoenix Ltd", author: "HKEX", date: "May 1, 2026", pages: 342 },
];

const IDEAS = [
  { addr: "DwNx...9vRe", text: "Strong fundamentals. The 34% gross margin in a hardware business is impressive. Reminds me of early DJI.", time: "3h ago", likes: 12 },
  { addr: "9xKm...4fDe", text: "Anyone know if cornerstone investors have a lock-up? Would be good to know the sell pressure timeline post-IPO.", time: "5h ago", likes: 8 },
  { addr: "Bk4r...wJ7n", text: "Deposited 50k. The risk/reward at this valuation vs comparable robotics IPOs is asymmetric. Day 1 pop potential is real.", time: "8h ago", likes: 24 },
  { addr: "7bQr...8nWx", text: "What happens if the IPO gets pulled? Has Marco handled that scenario in the vault contract?", time: "12h ago", likes: 5 },
];

const sf = "'Outfit', -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Helvetica Neue', Arial, sans-serif";

const NAV_ITEMS = [
  { label: "Overview", id: "overview" },
  { label: "Thesis", id: "thesis" },
  { label: "Strengths", id: "strengths" },
  { label: "Configuration", id: "config" },
  { label: "Financials", id: "financials" },
  { label: "Comparables", id: "comparables" },
  { label: "Timeline", id: "timeline" },
  { label: "Funding", id: "funding" },
  { label: "News", id: "news" },
  { label: "Reports", id: "reports" },
  { label: "Community", id: "community" },
];

function CountUp({ end, prefix = "", suffix = "", duration = 1.6, decimals = 0 }: {
  end: number; prefix?: string; suffix?: string; duration?: number; decimals?: number;
}) {
  const [value, setValue] = useState(0);
  const ref = useRef<HTMLSpanElement>(null);
  const started = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting && !started.current) {
        started.current = true;
        const start = performance.now();
        const tick = (now: number) => {
          const t = Math.min((now - start) / (duration * 1000), 1);
          const eased = 1 - Math.pow(1 - t, 3); // ease-out cubic
          setValue(eased * end);
          if (t < 1) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }
    }, { threshold: 0.3 });
    observer.observe(el);
    return () => observer.disconnect();
  }, [end, duration]);

  return (
    <span ref={ref} style={{ animation: "fadeInUp 0.6s ease-out both" }}>
      {prefix}{value.toFixed(decimals)}{suffix}
    </span>
  );
}

export default function VaultPage() {
  const vault = EXAMPLE_VAULTS[0];
  if (!vault) return <div style={{ textAlign: "center", padding: 80, color: "var(--muted)" }}>Vault not found</div>;

  const fillPct = ((totalDeposits / vault.depositCap) * 100).toFixed(1);
  const [depositAmount, setDepositAmount] = useState("");
  const [tradeMode, setTradeMode] = useState<"buy" | "sell">("buy");
  const [timelineOpen, setTimelineOpen] = useState(false);
  const [communityTab, setCommunityTab] = useState<"ideas" | "activity">("ideas");

  const offerPriceHKD = parseFloat(vault.offerPrice.replace(/[^0-9.]/g, "")) || 30.5;
  const hkdToUsd = 0.128;
  const tokenPriceUsd = offerPriceHKD * hkdToUsd;
  const inputVal = parseFloat(depositAmount) || 0;
  const tokensReceived = inputVal > 0 ? inputVal / tokenPriceUsd : 0;

  return (
    <div style={{ maxWidth: 1400, margin: "0 auto", padding: "0 48px 120px" }}>

      {/* ══ HERO ══ */}
      <div style={{ paddingTop: 64, marginBottom: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
          <VaultStatus phase={vault.status} />
          <span style={{ fontFamily: sf, fontSize: 12, color: "var(--muted-dim)" }}>
            {vault.ticker}.HK · {vault.sector} · IPO {vault.ipoDate}
          </span>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 32 }}>
          <div>
            <h1 style={{
              fontFamily: sf, fontSize: 44, fontWeight: 700,
              color: "var(--white)", letterSpacing: "-1.5px",
              margin: 0, lineHeight: 1.1,
            }}>
              {vault.companyName}
            </h1>
            {/* Quick links — tucked right under the title */}
            <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
              {[
                { label: "Prospectus", href: "#" },
                { label: "Website", href: "#" },
                { label: "Vault Contract", href: "#" },
                { label: "Audit Report", href: "#" },
              ].map(link => (
                <a key={link.label} href={link.href} target="_blank" rel="noopener noreferrer" style={{
                  fontFamily: sf, fontSize: 12, fontWeight: 500,
                  color: "var(--muted)", textDecoration: "none",
                  padding: "6px 14px",
                  border: "1px solid rgba(255,255,255,0.08)",
                  background: "rgba(255,255,255,0.02)",
                  transition: "all 0.15s",
                  cursor: "pointer",
                }}>
                  {link.label} ↗
                </a>
              ))}
            </div>
          </div>

          {/* Vault fill bar + countdown */}
          <div style={{ minWidth: 420, paddingBottom: 4 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <span style={{ fontFamily: sf, fontSize: 12, color: "var(--muted-dim)" }}>Vault Fill</span>
                <span style={{ fontFamily: sf, fontSize: 12 }}>
                  <span style={{ color: "var(--green)", fontWeight: 600 }}>{fillPct}%</span>
                  <span style={{ color: "var(--muted-dim)" }}> · ${(totalDeposits / 1e6).toFixed(2)}M / ${(vault.depositCap / 1e6).toFixed(0)}M</span>
                </span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontFamily: sf, fontSize: 11, color: "var(--muted-dim)" }}>
                  <span style={{
                    width: 5, height: 5, borderRadius: "50%",
                    background: "var(--green)",
                    boxShadow: "0 0 6px rgba(74,222,128,0.5)",
                    animation: "pulse 1.5s ease infinite",
                  }} />
                  47 active
                </span>
                <span style={{ color: "rgba(255,255,255,0.1)" }}>|</span>
                <span style={{ fontFamily: sf, fontSize: 11, color: "var(--muted-dim)" }}>Closes in</span>
                <Countdown deadline={vault.depositDeadline} size="sm" />
              </div>
            </div>
            <div className="glass-pill" style={{
              width: "100%", height: 8, background: "rgba(255,255,255,0.06)",
              overflow: "hidden", borderRadius: 999,
            }}>
              <div className="glass-pill" style={{
                width: `${fillPct}%`, height: "100%", borderRadius: 999,
                background: "linear-gradient(90deg, rgba(74,222,128,0.5), var(--green))",
                boxShadow: "0 0 16px rgba(74,222,128,0.25)",
                transition: "width 0.6s ease",
              }} />
            </div>

            {/* Live trades ticker — vertical VLT style */}
            <div style={{
              marginTop: 10, overflow: "hidden", height: 72,
              position: "relative",
            }}>
              <div style={{
                display: "flex", flexDirection: "column" as const,
                animation: "tickerScrollUp 12s linear infinite",
              }}>
                {[...RECENT_ACTIVITY, ...RECENT_ACTIVITY].map((a, i) => (
                  <div key={i} style={{
                    fontFamily: sf, fontSize: 11, display: "flex",
                    alignItems: "center", gap: 6, height: 24,
                  }}>
                    <span style={{
                      width: 5, height: 5, borderRadius: "50%",
                      background: "var(--green)",
                      boxShadow: "0 0 6px rgba(74,222,128,0.5)",
                      animation: "pulse 2s ease infinite",
                      animationDelay: `${i * 0.3}s`,
                    }} />
                    <span style={{ color: "var(--muted-dim)" }}>{a.addr}</span>
                    <span style={{ color: "var(--green)", fontWeight: 600 }}>{a.amount}</span>
                    <span style={{ color: "var(--muted-dim)", fontSize: 10 }}>{a.time}</span>
                  </div>
                ))}
              </div>
              {/* Fade top & bottom */}
              <div style={{
                position: "absolute", top: 0, left: 0, width: "100%", height: 20,
                background: "linear-gradient(180deg, var(--bg), transparent)",
                pointerEvents: "none",
              }} />
              <div style={{
                position: "absolute", bottom: 0, left: 0, width: "100%", height: 20,
                background: "linear-gradient(0deg, var(--bg), transparent)",
                pointerEvents: "none",
              }} />
            </div>
          </div>
        </div>

      </div>

      {/* ══ STATS ══ */}
      <div style={{
        display: "flex", gap: 56,
        paddingTop: 24, paddingBottom: 36,
        borderBottom: "1px solid rgba(255,255,255,0.06)",
        marginBottom: 0,
      }}>
        <div>
          <div style={{ fontFamily: sf, fontSize: 12, color: "var(--muted-dim)", marginBottom: 8, letterSpacing: "0.3px" }}>Total Deposits</div>
          <div style={{ fontFamily: sf, fontSize: 34, fontWeight: 500, color: "var(--white)", letterSpacing: "-0.5px" }}>
            <CountUp end={1.80} prefix="$" suffix="M" decimals={2} />
          </div>
        </div>
        <div>
          <div style={{ fontFamily: sf, fontSize: 12, color: "var(--muted-dim)", marginBottom: 8, letterSpacing: "0.3px" }}>Vault Cap</div>
          <div style={{ fontFamily: sf, fontSize: 34, fontWeight: 500, color: "var(--white)", letterSpacing: "-0.5px" }}>
            <CountUp end={vault.depositCap / 1e6} prefix="$" suffix="M" decimals={0} />
          </div>
        </div>
        <div>
          <div style={{ fontFamily: sf, fontSize: 12, color: "var(--muted-dim)", marginBottom: 8, letterSpacing: "0.3px" }}>Offer Price</div>
          <div style={{ fontFamily: sf, fontSize: 34, fontWeight: 500, color: "var(--white)", letterSpacing: "-0.5px" }}>
            <CountUp end={parseFloat(vault.offerPrice.replace(/[^0-9.]/g, "")) || 30.5} prefix="HK$" decimals={2} />
          </div>
        </div>
      </div>

      {/* ══ SECTION NAV ══ */}
      <div style={{
        display: "flex", gap: 0,
        borderBottom: "1px solid rgba(255,255,255,0.06)",
        marginBottom: 44,
        position: "sticky" as const, top: 48,
        background: "var(--bg)",
        zIndex: 50,
        paddingTop: 4,
      }}>
        {NAV_ITEMS.map(item => (
          <a
            key={item.id}
            href={`#${item.id}`}
            onClick={(e) => {
              e.preventDefault();
              document.getElementById(item.id)?.scrollIntoView({ behavior: "smooth", block: "start" });
            }}
            style={{
              fontFamily: sf, fontSize: 13, fontWeight: 500,
              color: "var(--muted-dim)", textDecoration: "none",
              padding: "12px 16px",
              transition: "color 0.15s",
              whiteSpace: "nowrap" as const,
              borderBottom: "2px solid transparent",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = "var(--white)";
              e.currentTarget.style.borderBottomColor = "var(--green)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = "var(--muted-dim)";
              e.currentTarget.style.borderBottomColor = "transparent";
            }}
          >
            {item.label}
          </a>
        ))}
      </div>

      {/* ══ MAIN GRID ══ */}
      <div style={{
        display: "grid", gridTemplateColumns: "1fr 320px", gap: 64,
        alignItems: "start",
      }}>

        {/* ──── LEFT ──── */}
        <div>

          {/* Overview */}
          <NotionSection title="Overview" id="overview">
            <p style={{
              fontFamily: sf, fontSize: 16, color: "var(--muted)", lineHeight: 1.8,
            }}>
              {vault.companyDescription}
            </p>
          </NotionSection>

          {/* Investment Thesis */}
          <NotionSection title="Investment Thesis" id="thesis">
            <p style={{ fontFamily: sf, fontSize: 15, color: "var(--muted)", lineHeight: 1.8 }}>
              {vault.pitch}
            </p>
            {vault.quote && (
              <div style={{
                borderLeft: "2px solid rgba(74,222,128,0.25)", paddingLeft: 20, marginTop: 24,
              }}>
                <p style={{
                  fontFamily: sf, fontSize: 15, color: "rgba(255,255,255,0.7)",
                  lineHeight: 1.7, fontStyle: "italic",
                }}>
                  &ldquo;{vault.quote.text}&rdquo;
                </p>
                <span style={{ fontFamily: sf, fontSize: 11, color: "var(--muted-dim)", marginTop: 6, display: "block" }}>
                  — {vault.quote.source}
                </span>
              </div>
            )}
          </NotionSection>

          {/* Key Strengths */}
          <NotionSection title="Key Strengths" id="strengths">
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px 28px" }}>
              {vault.strengths.map((s, i) => (
                <div key={i} style={{ display: "flex", gap: 10 }}>
                  <span style={{ fontFamily: sf, fontSize: 11, color: "var(--green)", opacity: 0.5, paddingTop: 2, flexShrink: 0 }}>
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <span style={{ fontFamily: sf, fontSize: 14, color: "var(--muted)", lineHeight: 1.55 }}>{s}</span>
                </div>
              ))}
            </div>
          </NotionSection>

          {/* Vault Configuration */}
          <NotionSection title="Vault Configuration" id="config">
            <NotionProps rows={[
              ["Type", "Pre-IPO Vault"], ["Settlement", "USDC on Solana"],
              ["Mgmt Fee", `${vault.feeRateBps / 100}%`], ["Perf Fee", `${vault.performanceFeeBps / 100}% on profits`],
              ["Broker", "Licensed HKEX Member"], ["Audit", vault.auditBy],
              ["Entity", "Marco Trade Ltd"], ["Network", "Solana"],
            ]} />
          </NotionSection>

          {/* Company Details */}
          <NotionSection title="Company Details" id="company">
            <NotionProps rows={[
              ["Founded", vault.founded], ["HQ", vault.hq],
              ["CEO", vault.ceo], ["Sector", vault.sector],
              ["Exchange", vault.exchange], ["IPO Date", vault.ipoDate],
              ["Offer Price", vault.offerPrice], ["Market Cap", vault.marketCap],
            ]} />
          </NotionSection>

          {/* Financials */}
          <NotionSection title="Financials" id="financials">
            <NotionTable
              headers={["Year", "Revenue", "Gross Profit", "Net Profit", "Margin"]}
              rows={vault.financials.map(f => [
                { text: f.year },
                { text: f.revenue },
                { text: f.grossProfit },
                { text: f.netProfit, color: f.netProfit.startsWith("-") ? "var(--red)" : "var(--green)" },
                { text: f.netMargin, color: f.netMargin.startsWith("-") ? "var(--red)" : "var(--green)" },
              ])}
            />
            <span style={{ fontFamily: sf, fontSize: 11, color: "var(--muted-dim)", marginTop: 8, display: "block" }}>
              Source: HKEX Prospectus, May 2026
            </span>
          </NotionSection>

          {/* Comparables */}
          <NotionSection title="Public Comparables" id="comparables">
            <NotionTable
              headers={["Company", "Ticker", "Exchange", "Mkt Cap", "EV/Rev", "Day 1"]}
              rows={vault.comparableIpos.map(c => [
                { text: c.name, color: "var(--white)", weight: 500 },
                { text: c.ticker },
                { text: c.exchange },
                { text: c.marketCap },
                { text: c.evRevenue },
                { text: c.return, color: "var(--green)", weight: 600 },
              ])}
            />
          </NotionSection>

          {/* Funding History */}
          {/* Vault Timeline — collapsible */}
          <div id="timeline" style={{ marginBottom: 44, scrollMarginTop: 120 }}>
            <button
              onClick={() => setTimelineOpen(!timelineOpen)}
              style={{
                display: "flex", alignItems: "center", justifyContent: "space-between",
                width: "100%", background: "none", border: "none", cursor: "pointer",
                padding: 0, marginBottom: timelineOpen ? 16 : 0,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <h2 style={{
                  fontFamily: sf, fontSize: 18, fontWeight: 600,
                  color: "var(--white)", letterSpacing: "-0.3px", margin: 0,
                }}>Vault Timeline</h2>
                <span style={{
                  fontFamily: sf, fontSize: 11, fontWeight: 500,
                  color: "var(--yellow)", padding: "2px 8px",
                  background: "rgba(251,191,36,0.1)",
                  border: "1px solid rgba(251,191,36,0.2)",
                }}>
                  Step 2 of 6 · Deposit Deadline
                </span>
              </div>
              <span style={{
                fontFamily: sf, fontSize: 12, color: "var(--muted-dim)",
                transition: "transform 0.2s",
                transform: timelineOpen ? "rotate(180deg)" : "rotate(0deg)",
                display: "inline-block",
              }}>▾</span>
            </button>

            {timelineOpen && (
              <div style={{ position: "relative", paddingLeft: 24 }}>
                <div style={{
                  position: "absolute", left: 5, top: 6, bottom: 6,
                  width: 1, background: "rgba(255,255,255,0.08)",
                }} />

                {[
                  { date: "May 1", title: "Vault Opens", desc: "Deposit window opens. Investors deposit USDC to reserve shares at the IPO offer price.", status: "complete" as const },
                  { date: "May 18", title: "Deposit Deadline", desc: "Final day to deposit. Vault closes to new deposits and funds are locked.", status: "active" as const },
                  { date: "May 20", title: "Capital Deployed", desc: "USDC converted to fiat, routed through licensed HKEX broker to subscribe for IPO shares.", status: "upcoming" as const },
                  { date: "May 25", title: "IPO Listing", desc: "RobotPhoenix lists on HKEX. Shares allocated to the vault at offer price.", status: "upcoming" as const },
                  { date: "May 25–Jun 1", title: "Lock-up", desc: "Shares held for settlement period. No withdrawals.", status: "upcoming" as const },
                  { date: "Jun 1", title: "Payout", desc: "Shares sold at market. Proceeds converted to USDC and distributed pro-rata.", status: "upcoming" as const },
                ].map((step, i) => (
                  <div key={i} style={{ display: "flex", gap: 16, padding: "12px 0", position: "relative" }}>
                    <div style={{
                      position: "absolute", left: -24, top: 16,
                      width: 11, height: 11, borderRadius: "50%",
                      background: step.status === "complete" ? "var(--green)" : step.status === "active" ? "var(--yellow)" : "rgba(255,255,255,0.1)",
                      border: step.status === "active" ? "2px solid rgba(251,191,36,0.3)" : "none",
                      boxShadow: step.status === "complete" ? "0 0 8px rgba(74,222,128,0.4)" : step.status === "active" ? "0 0 10px rgba(251,191,36,0.4)" : "none",
                    }} />
                    <div style={{ flex: 1 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ fontFamily: sf, fontSize: 13, color: "var(--white)", fontWeight: 500 }}>{step.title}</span>
                        <span style={{ fontFamily: sf, fontSize: 11, color: "var(--muted-dim)" }}>{step.date}</span>
                      </div>
                      <div style={{ fontFamily: sf, fontSize: 12, color: "var(--muted)", lineHeight: 1.5, marginTop: 3, opacity: step.status === "upcoming" ? 0.6 : 1 }}>
                        {step.desc}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <NotionSection title="Funding History" id="funding">
            {vault.fundingHistory.map((f, i) => (
              <div key={i} style={{
                display: "flex", gap: 20, padding: "12px 0",
                borderBottom: i < vault.fundingHistory.length - 1 ? "1px solid rgba(255,255,255,0.04)" : "none",
              }}>
                <span style={{ fontFamily: sf, fontSize: 12, color: "var(--green)", opacity: 0.7, minWidth: 72, flexShrink: 0 }}>{f.date}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontFamily: sf, fontSize: 13, color: "var(--white)", fontWeight: 500 }}>{f.round}</div>
                  <div style={{ fontFamily: sf, fontSize: 12, color: "var(--muted-dim)", lineHeight: 1.5, marginTop: 2 }}>{f.detail}</div>
                </div>
                {f.raised && <span style={{ fontFamily: sf, fontSize: 13, color: "var(--green)", fontWeight: 600, flexShrink: 0 }}>{f.raised}</span>}
              </div>
            ))}
          </NotionSection>

          {/* News */}
          <NotionSection title="News" id="news">
            {NEWS_ITEMS.map((item, i) => (
              <div key={i} style={{
                padding: "16px 0",
                borderBottom: i < NEWS_ITEMS.length - 1 ? "1px solid rgba(255,255,255,0.04)" : "none",
                cursor: "pointer",
                transition: "opacity 0.15s",
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
                  <span style={{
                    fontFamily: sf, fontSize: 10, fontWeight: 600,
                    color: item.tag === "Report" ? "var(--green)" : item.tag === "Filing" ? "var(--yellow)" : "var(--blue)",
                    textTransform: "uppercase" as const, letterSpacing: "0.5px",
                    padding: "2px 8px",
                    background: item.tag === "Report" ? "var(--green-dim)" : item.tag === "Filing" ? "rgba(251,191,36,0.1)" : "rgba(96,165,250,0.1)",
                    border: `1px solid ${item.tag === "Report" ? "rgba(74,222,128,0.2)" : item.tag === "Filing" ? "rgba(251,191,36,0.2)" : "rgba(96,165,250,0.2)"}`,
                  }}>
                    {item.tag}
                  </span>
                  <span style={{ fontFamily: sf, fontSize: 11, color: "var(--muted-dim)" }}>
                    {item.source} · {item.date}
                  </span>
                </div>
                <div style={{ fontFamily: sf, fontSize: 14, color: "var(--white)", fontWeight: 450, lineHeight: 1.5 }}>
                  {item.title}
                </div>
              </div>
            ))}
          </NotionSection>

          {/* Reports */}
          <NotionSection title="Reports & Research" id="reports">
            {REPORTS.map((r, i) => (
              <div key={i} style={{
                display: "flex", justifyContent: "space-between", alignItems: "center",
                padding: "14px 0",
                borderBottom: i < REPORTS.length - 1 ? "1px solid rgba(255,255,255,0.04)" : "none",
                cursor: "pointer",
              }}>
                <div>
                  <div style={{ fontFamily: sf, fontSize: 14, color: "var(--white)", fontWeight: 500, marginBottom: 3 }}>
                    {r.title}
                  </div>
                  <div style={{ fontFamily: sf, fontSize: 12, color: "var(--muted-dim)" }}>
                    {r.author} · {r.date} · {r.pages} pages
                  </div>
                </div>
                <span style={{
                  fontFamily: sf, fontSize: 12, fontWeight: 500,
                  color: "var(--muted)", padding: "6px 14px",
                  border: "1px solid rgba(255,255,255,0.08)",
                  background: "rgba(255,255,255,0.02)",
                  flexShrink: 0,
                  cursor: "pointer",
                }}>
                  View PDF ↗
                </span>
              </div>
            ))}
          </NotionSection>

          {/* Community — Ideas / Activity tabs */}
          <div id="community" style={{ marginBottom: 44, scrollMarginTop: 120 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
              <h2 style={{
                fontFamily: sf, fontSize: 18, fontWeight: 600,
                color: "var(--white)", letterSpacing: "-0.3px",
              }}>Community</h2>

              {/* Tab capsule toggle */}
              <div style={{
                display: "flex",
                background: "rgba(255,255,255,0.04)",
                border: "1px solid rgba(255,255,255,0.06)",
                padding: 3, gap: 3,
              }}>
                {(["ideas", "activity"] as const).map((tab) => (
                  <button
                    key={tab}
                    onClick={() => setCommunityTab(tab)}
                    style={{
                      fontFamily: sf, fontSize: 12, fontWeight: 600,
                      padding: "6px 16px", border: "none", cursor: "pointer",
                      textTransform: "uppercase", letterSpacing: "0.5px",
                      background: communityTab === tab ? "rgba(255,255,255,0.08)" : "transparent",
                      color: communityTab === tab ? "var(--white)" : "var(--muted-dim)",
                      transition: "all 0.15s",
                    }}
                  >{tab}</button>
                ))}
              </div>
            </div>

            {/* Ideas tab */}
            {communityTab === "ideas" && (
              <div>
                {/* Comment input */}
                <div style={{
                  display: "flex", gap: 10, marginBottom: 20,
                  padding: "12px 14px",
                  background: "rgba(255,255,255,0.02)",
                  border: "1px solid rgba(255,255,255,0.06)",
                }}>
                  <input
                    type="text"
                    placeholder="Share a thought..."
                    style={{
                      flex: 1, background: "transparent", border: "none",
                      color: "var(--white)", fontFamily: sf, fontSize: 13,
                      outline: "none", padding: 0,
                    }}
                  />
                  <button style={{
                    fontFamily: sf, fontSize: 12, fontWeight: 600,
                    color: "var(--green)", background: "transparent",
                    border: "none", cursor: "pointer",
                  }}>Post</button>
                </div>

                {/* Comments list */}
                {IDEAS.map((idea, i) => (
                  <div key={i} style={{
                    padding: "14px 0",
                    borderBottom: i < IDEAS.length - 1 ? "1px solid rgba(255,255,255,0.04)" : "none",
                  }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                      <span style={{ fontFamily: sf, fontSize: 12, color: "var(--green)", fontWeight: 500 }}>
                        {idea.addr}
                      </span>
                      <span style={{ fontFamily: sf, fontSize: 11, color: "var(--muted-dim)" }}>{idea.time}</span>
                    </div>
                    <div style={{ fontFamily: sf, fontSize: 13, color: "var(--muted)", lineHeight: 1.55, marginBottom: 8 }}>
                      {idea.text}
                    </div>
                    <button style={{
                      fontFamily: sf, fontSize: 11, color: "var(--muted-dim)",
                      background: "none", border: "none", cursor: "pointer",
                      display: "flex", alignItems: "center", gap: 4,
                    }}>
                      ▲ {idea.likes}
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Activity tab */}
            {communityTab === "activity" && (
              <div>
                {RECENT_ACTIVITY.map((a, i) => (
                  <div key={i} style={{
                    display: "flex", justifyContent: "space-between", alignItems: "center",
                    padding: "10px 0",
                    borderBottom: i < RECENT_ACTIVITY.length - 1 ? "1px solid rgba(255,255,255,0.04)" : "none",
                  }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <span style={{
                        fontFamily: sf, fontSize: 10, fontWeight: 600,
                        color: "var(--green)", textTransform: "uppercase" as const,
                        padding: "2px 6px", background: "var(--green-dim)",
                        border: "1px solid rgba(74,222,128,0.2)",
                      }}>Deposit</span>
                      <span style={{ fontFamily: sf, fontSize: 13, color: "var(--white)", fontWeight: 500 }}>{a.amount}</span>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                      <span style={{ fontFamily: sf, fontSize: 12, color: "var(--muted-dim)" }}>{a.addr}</span>
                      <span style={{ fontFamily: sf, fontSize: 11, color: "var(--muted-dim)" }}>{a.time}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ──── RIGHT — Deposit card ──── */}
        <div style={{ position: "sticky" as const, top: 120 }}>
          <div style={{
            background: "rgba(255, 255, 255, 0.03)",
            backdropFilter: "blur(40px)",
            WebkitBackdropFilter: "blur(40px)",
            border: "1px solid rgba(255, 255, 255, 0.07)",
            boxShadow: "0 8px 40px rgba(0,0,0,0.3), 0 0 80px rgba(74,222,128,0.03), inset 0 1px 0 rgba(255,255,255,0.06)",
            overflow: "hidden",
          }}>

            {/* Buy / Sell capsule toggle */}
            <div style={{
              display: "flex", margin: "16px 24px 0",
              background: "rgba(255,255,255,0.04)",
              border: "1px solid rgba(255,255,255,0.06)",
              padding: 3, gap: 3,
            }}>
              {(["buy", "sell"] as const).map(mode => (
                <button
                  key={mode}
                  onClick={() => { setTradeMode(mode); setDepositAmount(""); }}
                  style={{
                    flex: 1,
                    fontFamily: sf, fontSize: 13, fontWeight: 600,
                    color: tradeMode === mode
                      ? (mode === "buy" ? "#000" : "#000")
                      : "var(--muted-dim)",
                    background: tradeMode === mode
                      ? (mode === "buy" ? "var(--green)" : "var(--red)")
                      : "transparent",
                    border: "none",
                    padding: "8px 0",
                    cursor: "pointer",
                    transition: "all 0.2s ease",
                    textTransform: "capitalize" as const,
                  }}
                >
                  {mode}
                </button>
              ))}
            </div>

            {/* Input */}
            <div style={{ padding: "20px 24px" }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 12 }}>
                <input
                  type="text"
                  placeholder="0"
                  value={depositAmount}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v === "" || /^\d*\.?\d*$/.test(v)) setDepositAmount(v);
                  }}
                  style={{
                    flex: 1, background: "transparent", border: "none",
                    color: "var(--white)", fontFamily: sf,
                    fontSize: 36, fontWeight: 300, outline: "none",
                    padding: 0, letterSpacing: "-1px", minWidth: 0,
                  }}
                />
                <span style={{ fontFamily: sf, fontSize: 14, color: "var(--muted-dim)" }}>
                  {tradeMode === "buy" ? "USDC" : vault.ticker}
                </span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontFamily: sf, fontSize: 12, color: "var(--muted-dim)" }}>
                  {userUsdcBalance.toLocaleString()} available
                </span>
                <button
                  onClick={() => setDepositAmount(userUsdcBalance.toString())}
                  style={{
                    fontFamily: sf, fontSize: 11, fontWeight: 600,
                    color: "var(--green)", background: "transparent",
                    border: "none", padding: 0, cursor: "pointer",
                  }}>MAX</button>
              </div>
            </div>

            {/* Receive */}
            <div style={{
              margin: "0 24px", padding: "14px 0",
              borderTop: "1px solid rgba(255,255,255,0.06)",
              display: "flex", justifyContent: "space-between", alignItems: "center",
            }}>
              <span style={{ fontFamily: sf, fontSize: 12, color: "var(--muted-dim)" }}>
                {tradeMode === "buy" ? "You receive" : "You get back"}
              </span>
              <div style={{ textAlign: "right" }}>
                <span style={{
                  fontFamily: sf, fontSize: 16, fontWeight: 600,
                  color: inputVal > 0 ? "var(--white)" : "var(--muted-dim)",
                }}>
                  {inputVal > 0
                    ? tradeMode === "buy"
                      ? tokensReceived.toLocaleString(undefined, { maximumFractionDigits: 2 })
                      : `$${(inputVal * tokenPriceUsd).toLocaleString(undefined, { maximumFractionDigits: 2 })}`
                    : "—"}
                </span>
                <span style={{ fontFamily: sf, fontSize: 12, color: "var(--muted-dim)", marginLeft: 6 }}>
                  {tradeMode === "buy" ? vault.ticker : "USDC"}
                </span>
                {inputVal > 0 && (
                  <div style={{ fontFamily: sf, fontSize: 11, color: "var(--muted-dim)", marginTop: 1, opacity: 0.7 }}>
                    @ ${tokenPriceUsd.toFixed(2)} / share
                  </div>
                )}
              </div>
            </div>

            {/* CTA */}
            <div style={{ padding: "12px 24px 24px" }}>
              <button style={{
                width: "100%", padding: 16,
                fontFamily: sf, fontSize: 14, fontWeight: 600,
                color: inputVal > 0 ? "#000" : "var(--muted-dim)",
                background: inputVal > 0
                  ? tradeMode === "buy"
                    ? "linear-gradient(135deg, #4ade80, #22c55e)"
                    : "linear-gradient(135deg, #f87171, #ef4444)"
                  : "rgba(255,255,255,0.04)",
                border: inputVal > 0 ? "none" : "1px solid rgba(255,255,255,0.06)",
                cursor: inputVal > 0 ? "pointer" : "default",
                transition: "all 0.3s ease",
                boxShadow: inputVal > 0
                  ? tradeMode === "buy"
                    ? "0 4px 20px rgba(74,222,128,0.25), inset 0 1px 0 rgba(255,255,255,0.2)"
                    : "0 4px 20px rgba(248,113,113,0.25), inset 0 1px 0 rgba(255,255,255,0.2)"
                  : "none",
                animation: inputVal > 0 ? "ctaGlow 2.5s ease-in-out infinite" : "none",
              }}>
                {inputVal > 0
                  ? tradeMode === "buy"
                    ? `Reserve ${tokensReceived.toLocaleString(undefined, { maximumFractionDigits: 0 })} Shares`
                    : `Sell ${inputVal.toLocaleString()} Shares`
                  : "Enter an amount"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ═══ Components ═══ */

function NotionSection({ title, id, children }: { title: string; id?: string; children: React.ReactNode }) {
  return (
    <div id={id} style={{ marginBottom: 44, scrollMarginTop: 120 }}>
      <h2 style={{
        fontFamily: sf, fontSize: 18, fontWeight: 600,
        color: "var(--white)", letterSpacing: "-0.3px",
        marginBottom: 16,
      }}>{title}</h2>
      {children}
    </div>
  );
}

function NotionProps({ rows }: { rows: [string, string][] }) {
  return (
    <div>
      {rows.map(([label, value]) => (
        <div key={label} style={{
          display: "flex", justifyContent: "space-between",
          padding: "8px 0",
          borderBottom: "1px solid rgba(255,255,255,0.03)",
        }}>
          <span style={{ fontFamily: sf, fontSize: 13, color: "var(--muted-dim)" }}>{label}</span>
          <span style={{ fontFamily: sf, fontSize: 13, color: "var(--white)" }}>{value}</span>
        </div>
      ))}
    </div>
  );
}

function NotionTable({ headers, rows }: {
  headers: string[];
  rows: { text: string; color?: string; weight?: number }[][];
}) {
  return (
    <table style={{ width: "100%", borderCollapse: "collapse" }}>
      <thead>
        <tr>
          {headers.map(h => (
            <th key={h} style={{
              fontFamily: sf, fontSize: 12, fontWeight: 500,
              color: "var(--muted-dim)", textAlign: "left",
              padding: "8px 12px 8px 0",
              borderBottom: "1px solid rgba(255,255,255,0.06)",
            }}>{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => (
          <tr key={i}>
            {row.map((cell, j) => (
              <td key={j} style={{
                fontFamily: sf, fontSize: 13,
                color: cell.color || "var(--muted)",
                fontWeight: cell.weight || 400,
                padding: "10px 12px 10px 0",
                borderBottom: i < rows.length - 1 ? "1px solid rgba(255,255,255,0.03)" : "none",
              }}>{cell.text}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
