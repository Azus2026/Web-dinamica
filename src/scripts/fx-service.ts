export type CryptoToken = "USDC" | "USDT" | "ETH" | "ARB";
export type CryptoTokenSymbol = CryptoToken;

export interface ChainConfig {
  id: string;
  name: string;
  shortName: string;
  chainIdHex: string;
  chainIdDec: number;
  isEvm: boolean;
  isTestnet: boolean;
  nativeSymbol: string;
  rpcUrl: string;
  explorerUrl: string;
  explorerTxUrl: string;
  tokens: CryptoToken[];
  usdcAddress: string;
  usdtAddress: string;
  arbAddress: string;
}

export interface FxRatesSnapshot {
  usdToPen: number;
  tokensUsd: Record<CryptoTokenSymbol, number>;
  source?: string;
  updatedAt?: string;
}

// Única red habilitada y verificada on-chain: Arbitrum One (Chain ID 42161)
export const SUPPORTED_CHAINS: ChainConfig[] = [
  {
    id: "arbitrum",
    name: "Arbitrum One (Mainnet · L2 Oficial)",
    shortName: "Arbitrum One",
    chainIdHex: "0xa4b1",
    chainIdDec: 42161,
    isEvm: true,
    isTestnet: false,
    nativeSymbol: "ETH",
    rpcUrl: "https://arb1.arbitrum.io/rpc",
    explorerUrl: "https://arbiscan.io",
    explorerTxUrl: "https://arbiscan.io/tx/",
    tokens: ["USDC", "USDT", "ETH", "ARB"],
    usdcAddress: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
    usdtAddress: "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9",
    arbAddress: "0x912CE59144191C1204E64559FE8253a0e49E6548"
  }
];

let currentUsdToPenRate = 3.75;
let lastOracleSource = "fallback-init";
let lastOracleUpdatedAt = "";

const TOKEN_PRICES_USD: Record<CryptoToken, number> = {
  USDC: 1.0,
  USDT: 1.0,
  ETH: 2650.0,
  ARB: 0.85
};

export function applyServerFxOracle(oracle?: {
  usdToPen?: number;
  tokensUsd?: Partial<Record<CryptoTokenSymbol, number>>;
  source?: string;
  updatedAt?: string;
}) {
  if (!oracle) return;
  if (
    typeof oracle.usdToPen === "number" &&
    oracle.usdToPen > 2.0 &&
    oracle.usdToPen < 6.5
  ) {
    currentUsdToPenRate = oracle.usdToPen;
  }
  if (oracle.tokensUsd) {
    if (typeof oracle.tokensUsd.USDC === "number" && oracle.tokensUsd.USDC > 0) {
      TOKEN_PRICES_USD.USDC = oracle.tokensUsd.USDC;
    }
    if (typeof oracle.tokensUsd.USDT === "number" && oracle.tokensUsd.USDT > 0) {
      TOKEN_PRICES_USD.USDT = oracle.tokensUsd.USDT;
    }
    if (typeof oracle.tokensUsd.ETH === "number" && oracle.tokensUsd.ETH > 100) {
      TOKEN_PRICES_USD.ETH = oracle.tokensUsd.ETH;
    }
    if (typeof oracle.tokensUsd.ARB === "number" && oracle.tokensUsd.ARB > 0.01) {
      TOKEN_PRICES_USD.ARB = oracle.tokensUsd.ARB;
    }
  }
  if (oracle.source) lastOracleSource = oracle.source;
  if (oracle.updatedAt) lastOracleUpdatedAt = oracle.updatedAt;
}

export function getFxRatesSync(): FxRatesSnapshot {
  return {
    usdToPen: currentUsdToPenRate,
    tokensUsd: { ...TOKEN_PRICES_USD },
    source: lastOracleSource,
    updatedAt: lastOracleUpdatedAt
  };
}

export function getUsdToPenRate(): number {
  return currentUsdToPenRate;
}

export function convertUsdToPen(amountUsd: number, rate = currentUsdToPenRate): number {
  return Math.round(amountUsd * rate);
}

export function convertPenToUsd(amountPen: number, rate = currentUsdToPenRate): number {
  return Math.round(amountPen / rate);
}

export function convertUsdToToken(
  usdAmount: number,
  token: CryptoTokenSymbol,
  rates: FxRatesSnapshot = getFxRatesSync()
): number {
  const price = rates.tokensUsd[token] || 1.0;
  const raw = usdAmount / price;
  if (token === "USDC" || token === "USDT") {
    return Number(raw.toFixed(2));
  }
  if (token === "ARB") {
    return Number(raw.toFixed(4));
  }
  return Number(raw.toFixed(6));
}

export function formatUsd(amountUsd: number): string {
  return `$${amountUsd.toLocaleString("en-US", {
    minimumFractionDigits: amountUsd % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2
  })} USD`;
}

export function formatPen(amountPen: number): string {
  return `S/ ${amountPen.toLocaleString("es-PE", {
    minimumFractionDigits: amountPen % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2
  })}`;
}

export function getTokenPriceUsd(token: CryptoToken): number {
  return TOKEN_PRICES_USD[token] || 1.0;
}

export function calculateTokenAmount(usdAmount: number, token: CryptoToken): string {
  return String(convertUsdToToken(usdAmount, token));
}

function resolveSumacOracleEndpoint(): string {
  if (typeof window === "undefined") {
    return "http://127.0.0.1:3000/api/public-booking";
  }
  const host = window.location.hostname;
  const resolvedHost = !host || host === "localhost" ? "127.0.0.1" : host;
  return `http://${resolvedHost}:3000/api/public-booking`;
}

export async function refreshLiveFxRates(): Promise<FxRatesSnapshot> {
  try {
    const res = await fetch(`${resolveSumacOracleEndpoint()}?action=getFxOracle`, {
      method: "GET",
      cache: "no-store"
    });
    if (res.ok) {
      const data = await res.json();
      if (data?.ok && data?.fxOracle) {
        applyServerFxOracle(data.fxOracle);
      }
    }
  } catch {
    // Mantiene última tasa conocida si el servidor no responde
  }
  return getFxRatesSync();
}

export async function refreshLiveFxRate(): Promise<number> {
  const snapshot = await refreshLiveFxRates();
  return snapshot.usdToPen;
}
