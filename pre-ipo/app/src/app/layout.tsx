"use client";

import { useState, useEffect } from "react";
import "@/styles/globals.css";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState("dark");
  const [showThemeMenu, setShowThemeMenu] = useState(false);
  const [walletConnected, setWalletConnected] = useState(false);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  return (
    <html lang="en" data-theme="dark" suppressHydrationWarning>
      <head>
        <title>Marco — Pre-IPO Vaults</title>
        <meta name="description" content="Subscribe to Hong Kong IPOs using USDC on Solana" />
      </head>
      <body>
        {/* ══ NAV — matches Marco perps nav exactly ══ */}
        <nav className="nav">
          <div className="nav-left">
            <a href="/" className="nav-logo" style={{ textDecoration: "none" }}>MARCO</a>

            {/* Phase 1: Vaults + Research visible. Perps/Spot hidden until ready. */}
            <a href="/" className="nav-link active">Vaults</a>
            <a href="/research" className="nav-link">Research</a>
            {/* Uncomment when ready to launch:
            <a href="/perps" className="nav-link disabled">Perps</a>
            <a href="/spot" className="nav-link disabled">Spot</a>
            */}
          </div>

          <div className="nav-right">
            <button
              className={`btn-sm ${walletConnected ? "connected" : ""}`}
              onClick={() => setWalletConnected(!walletConnected)}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="2" y="6" width="20" height="14" rx="0" />
                <path d="M16 14h.01" />
                <path d="M2 10h20" />
              </svg>
              <span>{walletConnected ? "9xKm...4fDe" : "Connect Wallet"}</span>
            </button>

            {/* Theme toggle — dark / light / warm */}
            <div style={{ position: "relative" }}>
              <button className="theme-toggle" onClick={() => setShowThemeMenu(!showThemeMenu)}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="5" />
                  <line x1="12" y1="1" x2="12" y2="3" />
                  <line x1="12" y1="21" x2="12" y2="23" />
                  <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
                  <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
                  <line x1="1" y1="12" x2="3" y2="12" />
                  <line x1="21" y1="12" x2="23" y2="12" />
                  <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
                  <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
                </svg>
              </button>
              {showThemeMenu && (
                <div style={{
                  position: "absolute", top: "100%", right: 0, marginTop: 6,
                  background: "var(--card)", border: "1px solid var(--border)",
                  padding: "4px 0", minWidth: 130, zIndex: 9999,
                  boxShadow: "0 8px 24px rgba(0,0,0,0.3)",
                }}>
                  {(["dark", "light", "warm"] as const).map((t) => (
                    <button
                      key={t}
                      onClick={() => { setTheme(t); setShowThemeMenu(false); }}
                      style={{
                        display: "flex", alignItems: "center", gap: 8, width: "100%",
                        padding: "8px 14px", border: "none", background: "none",
                        color: theme === t ? "var(--white)" : "var(--muted)",
                        fontFamily: "var(--font-apple)", fontSize: 12, cursor: "pointer",
                      }}
                    >
                      <span style={{
                        width: 14, height: 14, border: "1px solid var(--border)",
                        background: t === "dark" ? "#080808" : t === "light" ? "#f8f9fa" : "#f5f1eb",
                      }} />
                      {t.charAt(0).toUpperCase() + t.slice(1)}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </nav>

        <main style={{ minHeight: "calc(100vh - 96px)" }}>{children}</main>

        <footer className="footer">
          <div style={{ maxWidth: 1200, margin: "0 auto", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span>Marco Trade Ltd (BVI)</span>
            <div style={{ display: "flex", gap: 16 }}>
              <a href="#" style={{ color: "var(--muted-dim)", textDecoration: "none" }}>Terms</a>
              <a href="#" style={{ color: "var(--muted-dim)", textDecoration: "none" }}>Risk Disclosure</a>
              <a href="#" style={{ color: "var(--muted-dim)", textDecoration: "none" }}>X</a>
              <a href="#" style={{ color: "var(--muted-dim)", textDecoration: "none" }}>Telegram</a>
              <a href="#" style={{ color: "var(--muted-dim)", textDecoration: "none" }}>Discord</a>
            </div>
          </div>
        </footer>
      </body>
    </html>
  );
}
