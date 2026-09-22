// Program ID — update after mainnet deployment
export const PROGRAM_ID = "Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS";

// USDC mint on Solana mainnet
export const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

// USDC mint on devnet (for testing)
export const USDC_MINT_DEVNET = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";

// Helius RPC endpoints
export const RPC_MAINNET = "https://mainnet.helius-rpc.com/?api-key=YOUR_KEY";
export const RPC_DEVNET = "https://devnet.helius-rpc.com/?api-key=YOUR_KEY";

// Vault configuration types
export interface VaultConfig {
  vaultId: string;
  companyName: string;
  ticker: string;
  companyDescription: string;
  ipoDate: string;
  exchange: string;
  offerPrice: string;
  marketCap: string;
  sector: string;
  depositCap: number;        // In USDC (not lamports)
  depositDeadline: number;    // Unix timestamp
  feeRateBps: number;         // Basis points (200 = 2%)
  performanceFeeBps: number;  // Basis points (1000 = 10%)
  status: VaultPhase;
  pitch: string;
  whyItMatters: string;
  riskFactors: string[];
  comparableIpos: { name: string; return: string; ticker: string; exchange: string; marketCap: string; evRevenue: string }[];
  // Extended fields
  founded: string;
  hq: string;
  ceo: string;
  strengths: string[];
  financials: { year: string; revenue: string; grossProfit: string; netProfit: string; netMargin: string }[];
  fundingHistory: { date: string; round: string; detail: string; raised?: string }[];
  quote?: { text: string; source: string };
  vaultAddress: string;       // Solana vault address
  settlement: string;         // Settlement chain
  auditBy: string;            // Audit firm
}

export type VaultPhase =
  | "FundingOpen"
  | "FundingClosed"
  | "AssetsDeployed"
  | "Settled"
  | "RedemptionOpen";

// Vault data — RobotPhoenix is a real HKEX IPO (6871.HK) used here as a simulated vault demo
export const EXAMPLE_VAULTS: VaultConfig[] = [
  {
    vaultId: "rbtx-ipo-may-2026",
    companyName: "RobotPhoenix",
    ticker: "6871",
    companyDescription: "The Zhejiang-based industrial robotics company behind the Bat (parallel), Camel (mobile AGV), Python (SCARA), Mantis (six-axis), and Lobster (wafer handling) robot series — plus Gorilla and Kingkong controllers — that factory operators deploy across consumer electronics, automotive, healthcare, FMCG, and semiconductor production lines worldwide.",
    ipoDate: "2026-05-18",
    exchange: "HKEX",
    offerPrice: "HK$30.50",
    marketCap: "HK$7.47B",
    sector: "Industrial Robotics",
    depositCap: 5_000_000,
    depositDeadline: Math.floor(Date.now() / 1000) + 86400 * 3,
    feeRateBps: 200,
    performanceFeeBps: 1000,
    status: "FundingOpen",
    pitch: "RobotPhoenix is the 4th largest domestic industrial robotics company in China, with RMB387M in 2025 revenue (+45% YoY). They build the \"Brain, Eyes, Hands, and Feet\" of factory automation — parallel robots for high-speed pick-and-place, mobile AGVs for warehouse logistics, SCARA and six-axis arms for precision assembly, and wafer handling robots for semiconductors. 286 granted patents, 227 R&D engineers, customers across consumer electronics, automotive, healthcare, FMCG and semis. The IPO raises ~HK$750M at a HK$7.47B market cap, listing under HKEX Chapter 18C as a specialist technology company.",
    whyItMatters: "China's industrial robot market is projected to hit RMB147B by 2030 (17.2% CAGR). RobotPhoenix is riding the wave of factory automation + AI integration, with revenue growing 93% from 2023 to 2025. Their robot body sales nearly quintupled in two years (RMB25.7M → RMB123.6M), showing the shift from low-margin solutions work to high-margin hardware. This is a ground-floor entry into China's robotics buildout at a sub-$1B USD market cap.",
    riskFactors: [
      "Company has never been profitable — net losses of RMB153M in 2025",
      "Cash burn rate of RMB19.2M/month",
      "Top 5 customers represent 46.8% of revenue",
      "Listing under Chapter 18C (specialist technology)",
      "IPO allocation is not guaranteed",
      "Currency conversion risk (USDC → HKD → USDC)",
    ],
    comparableIpos: [
      { name: "Siasun Robot & Automation", ticker: "300024", exchange: "SZSE", marketCap: "RMB 32B", evRevenue: "2.8×", return: "+12% day 1" },
      { name: "Estun Automation", ticker: "002747", exchange: "SZSE", marketCap: "RMB 18B", evRevenue: "3.2×", return: "+8% day 1" },
      { name: "Horizon Robotics", ticker: "9660", exchange: "HKEX", marketCap: "HK$68B", evRevenue: "5.1×", return: "+28% day 1" },
      { name: "CATL", ticker: "3750", exchange: "HKEX", marketCap: "HK$1.2T", evRevenue: "2.0×", return: "+4% day 1" },
    ],

    // Extended fields
    founded: "2012",
    hq: "Shaoxing, Zhejiang, China",
    ceo: "Dr. Zhang Sai",
    strengths: [
      "4th largest domestic industrial robotics company in China by 2025 revenue",
      "Revenue grew 93% in two years — RMB201M (2023) to RMB387M (2025)",
      "Robot body sales quintupled: RMB25.7M → RMB123.6M, shifting mix toward higher-margin hardware",
      "286 granted patents and 227 R&D engineers (36% of headcount)",
      "Full-stack robotics: proprietary controllers, vision systems, mobile platforms, and six robot series",
      "Global customer base across 25 countries — consumer electronics, auto, healthcare, semis, FMCG",
    ],
    financials: [
      { year: "2023", revenue: "RMB 201M", grossProfit: "RMB 37M", netProfit: "-RMB 111M", netMargin: "-55.0%" },
      { year: "2024", revenue: "RMB 268M", grossProfit: "RMB 71M", netProfit: "-RMB 71M", netMargin: "-26.7%" },
      { year: "2025", revenue: "RMB 387M", grossProfit: "RMB 96M", netProfit: "-RMB 153M", netMargin: "-39.5%" },
    ],
    fundingHistory: [
      { date: "Jun 2012", round: "Founded", detail: "Incorporated by Dr. Zhang Sai in Zhejiang as a limited liability company" },
      { date: "2020–2024", round: "Series A–E", detail: "Multiple pre-IPO investment rounds from institutional investors", raised: "RMB 234M+" },
      { date: "May 2026", round: "HKEX IPO", detail: "24,600,000 H Shares at HK$30.50 per share. ABCI Capital as Sole Sponsor.", raised: "~HK$750M" },
    ],
    quote: {
      text: "4th largest domestic company offering industrial robots and related robotics solutions in China by 2025 revenue.",
      source: "Frost & Sullivan, cited in HKEX Prospectus",
    },
    vaultAddress: "ObsVLT...rbtx26",
    settlement: "USDC on Solana",
    auditBy: "Polynomial Security",
  },
];

// Fee calculation helpers
export function calcManagementFee(depositAmount: number, feeRateBps: number): number {
  return (depositAmount * feeRateBps) / 10_000;
}

export function calcPerformanceFee(
  depositAmount: number,
  proceeds: number,
  performanceFeeBps: number
): number {
  if (proceeds <= depositAmount) return 0;
  const profit = proceeds - depositAmount;
  return (profit * performanceFeeBps) / 10_000;
}

export function calcNetProceeds(
  depositAmount: number,
  totalDeposits: number,
  settlementAmount: number,
  feeRateBps: number,
  performanceFeeBps: number
): { grossProceeds: number; mgmtFee: number; perfFee: number; netProceeds: number; returnPct: number } {
  const shareRatio = depositAmount / totalDeposits;
  const grossProceeds = settlementAmount * shareRatio;
  const mgmtFee = calcManagementFee(depositAmount, feeRateBps);
  const perfFee = calcPerformanceFee(depositAmount, grossProceeds, performanceFeeBps);
  const netProceeds = grossProceeds - mgmtFee - perfFee;
  const returnPct = ((netProceeds - depositAmount) / depositAmount) * 100;

  return { grossProceeds, mgmtFee, perfFee, netProceeds, returnPct };
}
