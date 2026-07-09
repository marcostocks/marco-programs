"use client";

import { EXAMPLE_VAULTS } from "@/lib/constants";

export default function ResearchPage() {
  return (
    <div style={{ maxWidth: 1200, margin: "0 auto", padding: "24px 16px" }}>

      <div className="panel-header" style={{ border: "none", padding: "0 0 16px 0" }}>
        Pre-IPO Research
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 1, background: "var(--border)" }}>
        {EXAMPLE_VAULTS.map((vault) => (
          <div key={vault.vaultId} className="research-card" style={{ padding: 24 }}>
            {/* Header row */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 }}>
              <div>
                <div style={{ fontFamily: "var(--font-heading)", fontSize: 20, fontWeight: 700, color: "var(--white)" }}>
                  {vault.companyName}
                </div>
                <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--muted-dim)", marginTop: 4 }}>
                  {vault.sector} · {vault.exchange} · IPO {vault.ipoDate}
                </div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, auto)", gap: 20 }}>
                <div className="stat-pair">
                  <span className="stat-label">Offer Price</span>
                  <span className="stat-value highlight">{vault.offerPrice}</span>
                </div>
                <div className="stat-pair">
                  <span className="stat-label">Market Cap</span>
                  <span className="stat-value">{vault.marketCap}</span>
                </div>
                <div className="stat-pair">
                  <span className="stat-label">Vault Cap</span>
                  <span className="stat-value">${(vault.depositCap / 1e6).toFixed(0)}M</span>
                </div>
              </div>
            </div>

            {/* The 30-Second Pitch */}
            <div style={{ marginBottom: 20 }}>
              <div style={{
                fontFamily: "var(--font-heading)", fontSize: 12, fontWeight: 600,
                color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.5px",
                marginBottom: 8,
              }}>
                The 30-Second Pitch
              </div>
              <p style={{ fontFamily: "var(--font-body)", fontSize: 13, color: "var(--white)", lineHeight: 1.7, opacity: 0.85 }}>
                {vault.pitch}
              </p>
            </div>

            {/* Why This IPO Matters */}
            <div style={{ marginBottom: 20 }}>
              <div style={{
                fontFamily: "var(--font-heading)", fontSize: 12, fontWeight: 600,
                color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.5px",
                marginBottom: 8,
              }}>
                Why This IPO Matters
              </div>
              <p style={{ fontFamily: "var(--font-body)", fontSize: 13, color: "var(--muted)", lineHeight: 1.7 }}>
                {vault.whyItMatters}
              </p>
            </div>

            {/* Comparable IPOs */}
            {vault.comparableIpos.length > 0 && (
              <div style={{ marginBottom: 20 }}>
                <div style={{
                  fontFamily: "var(--font-heading)", fontSize: 12, fontWeight: 600,
                  color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.5px",
                  marginBottom: 8,
                }}>
                  Comparable Recent IPOs
                </div>
                <div style={{ display: "flex", gap: 16 }}>
                  {vault.comparableIpos.map((ipo, i) => (
                    <div key={i} style={{
                      background: "var(--green-dim)", border: "1px solid var(--border)",
                      padding: "8px 14px", display: "flex", gap: 10, alignItems: "center",
                    }}>
                      <span style={{ fontFamily: "var(--font-body)", fontSize: 12, color: "var(--white)" }}>{ipo.name}</span>
                      <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--green)", fontWeight: 600 }}>{ipo.return}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Risk Factors */}
            <div style={{ borderTop: "1px solid var(--border)", paddingTop: 16 }}>
              <div style={{
                fontFamily: "var(--font-heading)", fontSize: 12, fontWeight: 600,
                color: "var(--red)", textTransform: "uppercase", letterSpacing: "0.5px",
                marginBottom: 8,
              }}>
                Risk Factors
              </div>
              <div style={{ display: "grid", gap: 6 }}>
                {vault.riskFactors.map((risk, i) => (
                  <div key={i} style={{ display: "flex", gap: 8, fontSize: 12 }}>
                    <span style={{ color: "var(--red)", flexShrink: 0 }}>-</span>
                    <span style={{ fontFamily: "var(--font-body)", color: "var(--muted)", lineHeight: 1.5 }}>{risk}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* CTA */}
            <div style={{ marginTop: 20, paddingTop: 16, borderTop: "1px solid var(--border)" }}>
              <a href="/vault" className="btn-primary" style={{
                display: "inline-block", padding: "10px 24px", fontSize: 13, textDecoration: "none",
              }}>
                View Vault
              </a>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
