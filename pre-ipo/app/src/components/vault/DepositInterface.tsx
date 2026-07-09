"use client";

import { useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import ProgressBar from "./ProgressBar";
import Countdown from "./Countdown";

interface DepositInterfaceProps {
  vaultId: string;
  depositCap: number;
  totalDeposits: number;
  depositDeadline: number;
  userDeposit?: number;
  userUsdcBalance?: number;
  onDeposit: (amount: number) => Promise<void>;
}

export default function DepositInterface({
  vaultId,
  depositCap,
  totalDeposits,
  depositDeadline,
  userDeposit = 0,
  userUsdcBalance = 0,
  onDeposit,
}: DepositInterfaceProps) {
  const { connected } = useWallet();
  const [amount, setAmount] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const remaining = depositCap - totalDeposits;
  const maxDeposit = Math.min(remaining, userUsdcBalance);

  const handleDeposit = async () => {
    const value = parseFloat(amount);
    if (!value || value <= 0) {
      setError("Enter an amount");
      return;
    }
    if (value > userUsdcBalance) {
      setError("Insufficient USDC balance");
      return;
    }
    if (value > remaining) {
      setError(`Max deposit: $${remaining.toLocaleString()}`);
      return;
    }

    setError("");
    setLoading(true);
    try {
      await onDeposit(value);
      setAmount("");
    } catch (e: any) {
      setError(e.message || "Deposit failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ background: "var(--card)", padding: 24 }}>
      {/* Countdown */}
      <div style={{ marginBottom: 24 }}>
        <Countdown deadline={depositDeadline} />
      </div>

      {/* Progress bar */}
      <div style={{ marginBottom: 24 }}>
        <ProgressBar current={totalDeposits} cap={depositCap} label="Vault Fill" />
      </div>

      {/* Deposit input */}
      <div style={{ marginBottom: 16 }}>
        <label style={{
          display: "block",
          fontFamily: "var(--font-body)",
          fontSize: 11,
          color: "var(--muted)",
          textTransform: "uppercase",
          letterSpacing: "0.5px",
          marginBottom: 8,
        }}>
          Deposit Amount (USDC)
        </label>
        <div style={{ position: "relative" }}>
          <input
            type="number"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00"
            disabled={!connected || loading}
            style={{
              width: "100%",
              background: "var(--bg)",
              border: "1px solid var(--border)",
              color: "var(--white)",
              fontFamily: "var(--font-mono)",
              fontSize: 18,
              padding: "16px 72px 16px 16px",
              outline: "none",
              boxSizing: "border-box",
              opacity: (!connected || loading) ? 0.5 : 1,
            }}
          />
          <button
            onClick={() => setAmount(maxDeposit.toString())}
            style={{
              position: "absolute",
              right: 12,
              top: "50%",
              transform: "translateY(-50%)",
              color: "var(--green)",
              fontSize: 11,
              fontFamily: "var(--font-heading)",
              fontWeight: 600,
              background: "transparent",
              border: "1px solid rgba(74, 222, 128, 0.3)",
              padding: "4px 8px",
              cursor: "pointer",
            }}
          >
            MAX
          </button>
        </div>
        {connected && (
          <div style={{ textAlign: "right", marginTop: 4 }}>
            <span style={{ color: "var(--muted-dim)", fontSize: 11, fontFamily: "var(--font-mono)" }}>
              Balance: ${userUsdcBalance.toLocaleString()} USDC
            </span>
          </div>
        )}
      </div>

      {/* Error */}
      {error && (
        <div style={{ color: "var(--red)", fontSize: 13, marginBottom: 16, fontFamily: "var(--font-body)" }}>
          {error}
        </div>
      )}

      {/* Deposit button */}
      {connected ? (
        <button
          onClick={handleDeposit}
          disabled={loading || !amount}
          className="btn-deposit"
          style={{
            width: "100%",
            padding: 16,
            fontSize: 14,
            opacity: (loading || !amount) ? 0.4 : 1,
            cursor: (loading || !amount) ? "not-allowed" : "pointer",
          }}
        >
          {loading ? "Depositing..." : "Deposit USDC"}
        </button>
      ) : (
        <div style={{
          textAlign: "center",
          color: "var(--muted)",
          padding: 16,
          border: "1px solid var(--border)",
          fontFamily: "var(--font-body)",
          fontSize: 13,
        }}>
          Connect wallet to deposit
        </div>
      )}

      {/* User's deposit info */}
      {userDeposit > 0 && (
        <div style={{ marginTop: 16, paddingTop: 16, borderTop: "1px solid var(--border)" }}>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span style={{ color: "var(--muted)", fontSize: 13, fontFamily: "var(--font-body)" }}>
              Your deposit
            </span>
            <span style={{ fontFamily: "var(--font-mono)", color: "var(--green)", fontSize: 13 }}>
              ${userDeposit.toLocaleString()} USDC
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
