"use client";

import { useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { calcNetProceeds } from "@/lib/constants";

interface RedeemInterfaceProps {
  userDeposit: number;
  userShares: number;
  totalDeposits: number;
  settlementAmount: number;
  feeRateBps: number;
  performanceFeeBps: number;
  onRedeem: (shares: number) => Promise<void>;
}

export default function RedeemInterface({
  userDeposit,
  userShares,
  totalDeposits,
  settlementAmount,
  feeRateBps,
  performanceFeeBps,
  onRedeem,
}: RedeemInterfaceProps) {
  const { connected } = useWallet();
  const [loading, setLoading] = useState(false);

  const { grossProceeds, mgmtFee, perfFee, netProceeds, returnPct } =
    calcNetProceeds(userDeposit, totalDeposits, settlementAmount, feeRateBps, performanceFeeBps);

  const profitable = returnPct >= 0;

  const handleRedeem = async () => {
    setLoading(true);
    try {
      await onRedeem(userShares);
    } catch (e) {
      console.error("Redeem failed:", e);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ background: "var(--card)", padding: 24 }}>
      {/* Return headline */}
      <div style={{ textAlign: "center", marginBottom: 24 }}>
        <div style={{
          fontFamily: "var(--font-mono)",
          fontSize: 36,
          fontWeight: 600,
          color: profitable ? "var(--green)" : "var(--red)",
        }}>
          {profitable ? "+" : ""}{returnPct.toFixed(1)}% return
        </div>
        <div style={{ color: "var(--muted)", fontSize: 13, marginTop: 4, fontFamily: "var(--font-body)" }}>
          Settlement complete
        </div>
      </div>

      {/* Breakdown table */}
      <div style={{ display: "grid", gap: 12, marginBottom: 24 }}>
        <Row label="Your deposit" value={`$${userDeposit.toLocaleString()}`} />
        <Row label="Gross proceeds" value={`$${grossProceeds.toLocaleString(undefined, { maximumFractionDigits: 2 })}`} />

        <div style={{ borderTop: "1px solid var(--border)", paddingTop: 12, display: "grid", gap: 8 }}>
          <Row
            label={`Management fee (${(feeRateBps / 100).toFixed(1)}%)`}
            value={`-$${mgmtFee.toLocaleString(undefined, { maximumFractionDigits: 2 })}`}
            dim
          />
          <Row
            label={`Performance fee (${(performanceFeeBps / 100).toFixed(0)}%)`}
            value={perfFee > 0 ? `-$${perfFee.toLocaleString(undefined, { maximumFractionDigits: 2 })}` : "$0"}
            dim
          />
        </div>

        <div style={{ borderTop: "1px solid var(--border)", paddingTop: 12 }}>
          <Row
            label="Your net proceeds"
            value={`$${netProceeds.toLocaleString(undefined, { maximumFractionDigits: 2 })}`}
            highlight={profitable}
          />
        </div>
      </div>

      {/* Redeem button */}
      {connected && userShares > 0 ? (
        <button
          onClick={handleRedeem}
          disabled={loading}
          className="btn-redeem"
          style={{
            width: "100%",
            padding: 16,
            fontSize: 14,
            opacity: loading ? 0.4 : 1,
            cursor: loading ? "not-allowed" : "pointer",
          }}
        >
          {loading ? "Redeeming..." : `Redeem ${userShares.toLocaleString()} Shares`}
        </button>
      ) : userShares === 0 ? (
        <div style={{
          textAlign: "center",
          color: "var(--muted)",
          padding: 16,
          border: "1px solid var(--border)",
          fontFamily: "var(--font-body)",
          fontSize: 13,
        }}>
          Already redeemed
        </div>
      ) : (
        <div style={{
          textAlign: "center",
          color: "var(--muted)",
          padding: 16,
          border: "1px solid var(--border)",
          fontFamily: "var(--font-body)",
          fontSize: 13,
        }}>
          Connect wallet to redeem
        </div>
      )}
    </div>
  );
}

function Row({
  label,
  value,
  dim,
  highlight,
}: {
  label: string;
  value: string;
  dim?: boolean;
  highlight?: boolean;
}) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
      <span style={{
        fontSize: 13,
        fontFamily: "var(--font-body)",
        color: dim ? "var(--muted-dim)" : "var(--muted)",
      }}>
        {label}
      </span>
      <span style={{
        fontFamily: "var(--font-mono)",
        fontSize: 13,
        fontWeight: highlight ? 600 : 400,
        color: highlight ? "var(--green)" : dim ? "var(--muted-dim)" : "var(--white)",
      }}>
        {value}
      </span>
    </div>
  );
}
