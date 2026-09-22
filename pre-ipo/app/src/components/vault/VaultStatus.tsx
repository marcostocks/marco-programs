"use client";

import type { VaultPhase } from "@/lib/constants";

interface VaultStatusProps {
  phase: VaultPhase;
}

const PHASE_MAP: Record<VaultPhase, { label: string; cssClass: string; live?: boolean }> = {
  FundingOpen:    { label: "LIVE",       cssClass: "open", live: true },
  FundingClosed:  { label: "CLOSED",     cssClass: "closed" },
  AssetsDeployed: { label: "DEPLOYED",   cssClass: "deployed" },
  Settled:        { label: "SETTLED",    cssClass: "settled" },
  RedemptionOpen: { label: "REDEEMABLE", cssClass: "redeemable" },
};

export default function VaultStatus({ phase }: VaultStatusProps) {
  const config = PHASE_MAP[phase];

  return (
    <span className={`vault-status ${config.cssClass}`}>
      <span style={{
        width: 6, height: 6, display: "inline-block",
        borderRadius: "50%",
        background: "currentColor",
        ...(config.live ? {
          boxShadow: "0 0 8px currentColor",
          animation: "pulse 1.5s ease infinite",
        } : {}),
      }} />
      {config.label}
    </span>
  );
}
