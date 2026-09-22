"use client";

interface ProgressBarProps {
  current: number;    // Current fill in USDC
  cap: number;        // Total cap in USDC
  label?: string;
}

export default function ProgressBar({ current, cap, label }: ProgressBarProps) {
  const pct = Math.min((current / cap) * 100, 100);
  const filled = pct >= 100;

  return (
    <div style={{ width: "100%" }}>
      {label && (
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
          <span className="stat-label">{label}</span>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 11 }}>
            <span style={{ color: filled ? "var(--red)" : "var(--green)" }}>
              {pct.toFixed(1)}%
            </span>
            <span style={{ color: "var(--muted-dim)", marginLeft: 4 }}>filled</span>
          </span>
        </div>
      )}

      <div className="vault-progress-bar">
        <div
          className="vault-progress-fill"
          style={{
            width: `${pct}%`,
            background: filled ? "var(--red)" : "var(--green)",
          }}
        />
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6 }}>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--muted-dim)" }}>
          ${(current / 1e6).toFixed(2)}M
        </span>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--muted-dim)" }}>
          ${(cap / 1e6).toFixed(1)}M cap
        </span>
      </div>
    </div>
  );
}
