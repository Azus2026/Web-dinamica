import {
  SUPPORTED_CHAINS,
  convertUsdToToken,
  getFxRatesSync,
  type ChainConfig,
  type CryptoTokenSymbol
} from "./fx-service";

export type Web3PaymentMode = "arbitrum_micro" | "full_amount" | "sepolia_testnet";

export interface Web3PaymentExecutionResult {
  txHash: string;
  explorerUrl: string;
  chainName: string;
  token: CryptoTokenSymbol;
  chargedUsd: number;
  chargedTokenAmount: number;
  walletAddress: string;
  recipientAddress: string;
  modeLabel: string;
  isRealWalletTx: boolean;
  blockNumber?: number;
}

export interface ConnectedWalletState {
  connected: boolean;
  address: string | null;
  chainIdHex: string | null;
  chainConfig: ChainConfig | null;
  walletName: string;
  provider: any | null;
  balances: {
    nativeSymbol: string;
    nativeBalance: number;
    USDC: number;
    USDT: number;
    ARB: number;
  };
}

// Billetera receptora oficial del hotel en Arbitrum One (fija e inmutable)
export const HOTEL_TREASURY_EVM = "0xf6Bb92Ac612D814F2A1e67Bf713F2f732419AC87";

const ALLOWED_TOKENS: CryptoTokenSymbol[] = ["USDC", "USDT", "ETH", "ARB"];

interface TokenContractInfo {
  address: string;
  decimals: number;
  fallbackAddress?: string;
}

const ERC20_CONTRACTS_BY_CHAIN: Record<
  string,
  Partial<Record<CryptoTokenSymbol, TokenContractInfo>>
> = {
  arbitrum: {
    USDC: {
      address: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
      fallbackAddress: "0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8",
      decimals: 6
    },
    USDT: {
      address: "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9",
      decimals: 6
    },
    ARB: {
      address: "0x912CE59144191C1204E64559FE8253a0e49E6548",
      decimals: 18
    }
  }
};

const CHAIN_RPC_PARAMS: Record<
  string,
  {
    chainId: string;
    chainName: string;
    nativeCurrency: { name: string; symbol: string; decimals: number };
    rpcUrls: string[];
    blockExplorerUrls: string[];
  }
> = {
  arbitrum: {
    chainId: "0xa4b1",
    chainName: "Arbitrum One",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: ["https://arb1.arbitrum.io/rpc"],
    blockExplorerUrls: ["https://arbiscan.io"]
  }
};

interface DiscoveredProvider {
  name: string;
  rdns: string;
  provider: any;
}

const discoveredProviders: DiscoveredProvider[] = [];
let activeWalletState: ConnectedWalletState = {
  connected: false,
  address: null,
  chainIdHex: null,
  chainConfig: null,
  walletName: "",
  provider: null,
  balances: {
    nativeSymbol: "ETH",
    nativeBalance: 0,
    USDC: 0,
    USDT: 0,
    ARB: 0
  }
};

export function initEip6963Discovery() {
  if (typeof window === "undefined") return;
  window.addEventListener("eip6963:announceProvider", (event: any) => {
    const detail = event?.detail;
    if (detail?.provider && detail?.info) {
      const exists = discoveredProviders.some((p) => p.rdns === detail.info.rdns);
      if (!exists) {
        discoveredProviders.push({
          name: detail.info.name || "Wallet Web3",
          rdns: detail.info.rdns || "unknown",
          provider: detail.provider
        });
      }
    }
  });
  window.dispatchEvent(new Event("eip6963:requestProvider"));
}

export function resolveBestEvmProvider(): { provider: any | null; name: string } {
  if (typeof window === "undefined") return { provider: null, name: "" };

  if (discoveredProviders.length > 0) {
    const preferred =
      discoveredProviders.find((p) => p.name.toLowerCase().includes("rabby")) ||
      discoveredProviders.find((p) => p.name.toLowerCase().includes("metamask")) ||
      discoveredProviders[0];
    return { provider: preferred.provider, name: preferred.name };
  }

  const eth = (window as any).ethereum;
  if (!eth) return { provider: null, name: "" };

  if (Array.isArray(eth.providers) && eth.providers.length > 0) {
    const rabbyOrMm =
      eth.providers.find((p: any) => p.isRabby) ||
      eth.providers.find((p: any) => p.isMetaMask) ||
      eth.providers[0];
    const name = rabbyOrMm.isRabby
      ? "Rabby Wallet"
      : rabbyOrMm.isMetaMask
        ? "MetaMask"
        : "EVM Wallet";
    return { provider: rabbyOrMm, name };
  }

  const name = eth.isRabby
    ? "Rabby Wallet"
    : eth.isMetaMask
      ? "MetaMask"
      : eth.isPhantom
        ? "Phantom EVM"
        : "Web3 Wallet";
  return { provider: eth, name };
}

export function getChainById(chainId: string): ChainConfig {
  const found = SUPPORTED_CHAINS.find((c) => c.id === chainId);
  if (!found) {
    throw new Error(`La red seleccionada (${chainId}) no está habilitada. Solo se admite Arbitrum One.`);
  }
  return found;
}

export function getChainByHexId(chainIdHex: string): ChainConfig | null {
  const norm = chainIdHex.toLowerCase();
  return (
    SUPPORTED_CHAINS.find((c) => c.chainIdHex?.toLowerCase() === norm) || null
  );
}

export function getConnectedWalletState(): ConnectedWalletState {
  return { ...activeWalletState };
}

async function readErc20BalanceUnits(
  provider: any,
  tokenAddress: string,
  walletAddress: string
): Promise<bigint> {
  try {
    const cleanAddr = walletAddress.toLowerCase().replace(/^0x/, "").padStart(64, "0");
    const data = `0x70a08231${cleanAddr}`;
    const resultHex = await provider.request({
      method: "eth_call",
      params: [{ to: tokenAddress, data }, "latest"]
    });
    if (!resultHex || resultHex === "0x") return 0n;
    return BigInt(resultHex);
  } catch {
    return 0n;
  }
}

export async function refreshWalletBalances(targetChainId = "arbitrum"): Promise<ConnectedWalletState> {
  if (!activeWalletState.provider || !activeWalletState.address) {
    return activeWalletState;
  }

  const provider = activeWalletState.provider;
  const addr = activeWalletState.address;

  try {
    const chainIdHex: string = await provider.request({ method: "eth_chainId" });
    activeWalletState.chainIdHex = chainIdHex;
    activeWalletState.chainConfig = getChainByHexId(chainIdHex);

    const chainKey = targetChainId === "arbitrum" ? "arbitrum" : "arbitrum";
    const chainCfg = getChainById(chainKey);

    const nativeHex: string = await provider.request({
      method: "eth_getBalance",
      params: [addr, "latest"]
    });
    const nativeWei = nativeHex ? BigInt(nativeHex) : 0n;
    const nativeBalance = Number(nativeWei) / 1e18;

    const contracts = ERC20_CONTRACTS_BY_CHAIN[chainKey] || {};
    let usdcBal = 0;
    let usdtBal = 0;
    let arbBal = 0;

    if (contracts.USDC) {
      const unitsPrimary = await readErc20BalanceUnits(provider, contracts.USDC.address, addr);
      let units = unitsPrimary;
      if (units === 0n && contracts.USDC.fallbackAddress) {
        units = await readErc20BalanceUnits(provider, contracts.USDC.fallbackAddress, addr);
      }
      usdcBal = Number(units) / 10 ** contracts.USDC.decimals;
    }

    if (contracts.USDT) {
      const units = await readErc20BalanceUnits(provider, contracts.USDT.address, addr);
      usdtBal = Number(units) / 10 ** contracts.USDT.decimals;
    }

    if (contracts.ARB) {
      const units = await readErc20BalanceUnits(provider, contracts.ARB.address, addr);
      arbBal = Number(units) / 10 ** contracts.ARB.decimals;
    }

    activeWalletState.balances = {
      nativeSymbol: chainCfg.nativeSymbol || "ETH",
      nativeBalance: Number(nativeBalance.toFixed(6)),
      USDC: Number(usdcBal.toFixed(2)),
      USDT: Number(usdtBal.toFixed(2)),
      ARB: Number(arbBal.toFixed(4))
    };
  } catch {
    // Ignorar error de lectura RPC
  }

  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent("wallet:Updated", { detail: { ...activeWalletState } })
    );
  }
  return { ...activeWalletState };
}

export async function connectWeb3Wallet(targetChainId = "arbitrum"): Promise<ConnectedWalletState> {
  const chainCfg = getChainById(targetChainId);
  if (!chainCfg.isEvm || !chainCfg.chainIdHex) {
    throw new Error(`La red ${targetChainId} no es una red EVM soportada.`);
  }

  initEip6963Discovery();
  const { provider, name } = resolveBestEvmProvider();

  if (!provider) {
    throw new Error(
      "No se detectó ninguna extensión de wallet (MetaMask, Rabby, Phantom, Coinbase) en este navegador."
    );
  }

  const accounts: string[] = await provider.request({
    method: "eth_requestAccounts"
  });
  const address = accounts?.[0];
  if (!address) {
    throw new Error("No se autorizó ninguna cuenta en la wallet.");
  }

  await switchEvmChainIfNeeded(provider, targetChainId);

  const chainIdHex: string = await provider.request({ method: "eth_chainId" });
  activeWalletState = {
    connected: true,
    address,
    chainIdHex,
    chainConfig: getChainByHexId(chainIdHex),
    walletName: name,
    provider,
    balances: {
      nativeSymbol: "ETH",
      nativeBalance: 0,
      USDC: 0,
      USDT: 0,
      ARB: 0
    }
  };

  if (provider.on && !provider._nomadListenersAttached) {
    provider._nomadListenersAttached = true;
    provider.on("accountsChanged", (accs: string[]) => {
      activeWalletState.address = accs?.[0] || null;
      activeWalletState.connected = Boolean(activeWalletState.address);
      refreshWalletBalances().catch(() => undefined);
    });
    provider.on("chainChanged", () => {
      refreshWalletBalances().catch(() => undefined);
    });
  }

  return await refreshWalletBalances(targetChainId);
}

export function computeCheckoutAmounts(
  fullReservationUsd: number,
  mode: Web3PaymentMode,
  token: CryptoTokenSymbol
): {
  effectiveUsd: number;
  tokenAmount: number;
  modeLabel: string;
} {
  const rates = getFxRatesSync();
  if (mode === "arbitrum_micro") {
    const microUsd = 0.02;
    const tokenAmount =
      token === "ETH"
        ? Number((microUsd / (rates.tokensUsd.ETH || 2650)).toFixed(6))
        : convertUsdToToken(microUsd, token, rates);
    return {
      effectiveUsd: microUsd,
      tokenAmount,
      modeLabel: "MICRO-TEST ARBITRUM ($0.02 USD)"
    };
  }
  return {
    effectiveUsd: fullReservationUsd,
    tokenAmount: convertUsdToToken(fullReservationUsd, token, rates),
    modeLabel: "PAGO DIRECTO ARBITRUM ONE ($ USD)"
  };
}

function encodeErc20TransferData(recipientAddress: string, amountUnits: bigint): string {
  const cleanAddress = recipientAddress.toLowerCase().replace(/^0x/, "").padStart(64, "0");
  const hexAmount = amountUnits.toString(16).padStart(64, "0");
  return `0xa9059cbb${cleanAddress}${hexAmount}`;
}

export async function switchEvmChainIfNeeded(ethereum: any, targetChainId: string): Promise<void> {
  const chainConfig = getChainById(targetChainId);
  if (!chainConfig.isEvm || !chainConfig.chainIdHex) {
    throw new Error(`La red ${targetChainId} no soporta cambio de cadena EVM.`);
  }

  const currentHex: string = await ethereum.request({ method: "eth_chainId" });
  if (currentHex && currentHex.toLowerCase() === chainConfig.chainIdHex.toLowerCase()) {
    return;
  }

  try {
    await ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: chainConfig.chainIdHex }]
    });
  } catch (err: any) {
    if ((err?.code === 4902 || err?.data?.originalError?.code === 4902) && CHAIN_RPC_PARAMS[targetChainId]) {
      await ethereum.request({
        method: "wallet_addEthereumChain",
        params: [CHAIN_RPC_PARAMS[targetChainId]]
      });
    } else {
      throw err;
    }
  }
}

async function waitForOnChainReceipt(
  provider: any,
  txHash: string,
  maxWaitMs = 45000
): Promise<{ confirmed: boolean; blockNumber?: number }> {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    try {
      const receipt = await provider.request({
        method: "eth_getTransactionReceipt",
        params: [txHash]
      });
      if (receipt) {
        if (receipt.status === "0x0") {
          throw new Error("La transacción fue revertida on-chain (status 0x0).");
        }
        if (receipt.status === "0x1") {
          const blockNumber = receipt.blockNumber ? parseInt(receipt.blockNumber, 16) : undefined;
          return { confirmed: true, blockNumber };
        }
      }
    } catch (e: any) {
      if (e?.message?.includes("revertida")) throw e;
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  // Nunca confirmar por timeout (corrección P0)
  return { confirmed: false };
}

export async function executeWeb3WalletPayment(params: {
  fullReservationUsd: number;
  chainId: string;
  token: CryptoTokenSymbol;
  mode: Web3PaymentMode;
  recipientAddress?: string;
  onStatusUpdate?: (statusText: string, txHash?: string) => void;
}): Promise<Web3PaymentExecutionResult> {
  // 1. Validar estrictamente red Arbitrum One y tokens permitidos antes de tocar la wallet
  if (params.chainId !== "arbitrum") {
    throw new Error(
      `Red no soportada (${params.chainId}). Los pagos están habilitados exclusivamente en Arbitrum One.`
    );
  }
  if (!ALLOWED_TOKENS.includes(params.token)) {
    throw new Error(
      `Token no soportado (${params.token}). Solo se aceptan USDC, USDT, ETH y ARB en Arbitrum One.`
    );
  }

  const effectiveChainId = "arbitrum";
  const chainConfig = getChainById(effectiveChainId);

  params.onStatusUpdate?.("Conectando con tu Wallet en Arbitrum One...");
  const wallet = await connectWeb3Wallet(effectiveChainId);
  const provider = wallet.provider;
  const sender = wallet.address!;

  // Destinatario bloqueado exclusivamente a la billetera oficial del hotel
  const recipient = HOTEL_TREASURY_EVM;

  params.onStatusUpdate?.(`Verificando red ${chainConfig.name}...`);
  await switchEvmChainIfNeeded(provider, effectiveChainId);
  await refreshWalletBalances(effectiveChainId);

  const chosenToken = params.token;
  const { effectiveUsd, tokenAmount, modeLabel } = computeCheckoutAmounts(
    params.fullReservationUsd,
    params.mode,
    chosenToken
  );

  const chainContracts = ERC20_CONTRACTS_BY_CHAIN[effectiveChainId] || {};
  const tokenContract = chosenToken !== "ETH" ? chainContracts[chosenToken] : undefined;

  let txHash = "";

  if (tokenContract && chosenToken !== "ETH") {
    const requiredUnits = BigInt(
      Math.max(1, Math.round(tokenAmount * 10 ** tokenContract.decimals))
    );
    const primaryBalance = await readErc20BalanceUnits(
      provider,
      tokenContract.address,
      sender
    );
    let targetContractAddress = tokenContract.address;
    let availableUnits = primaryBalance;

    if (primaryBalance < requiredUnits && tokenContract.fallbackAddress) {
      const fallbackBalance = await readErc20BalanceUnits(
        provider,
        tokenContract.fallbackAddress,
        sender
      );
      if (fallbackBalance >= requiredUnits) {
        targetContractAddress = tokenContract.fallbackAddress;
        availableUnits = fallbackBalance;
      }
    }

    if (availableUnits < requiredUnits) {
      throw new Error(
        `Saldo de ${chosenToken} insuficiente en tu wallet (${sender.slice(0, 6)}...${sender.slice(-4)}) en Arbitrum One: necesitas ${tokenAmount} ${chosenToken}.`
      );
    }

    params.onStatusUpdate?.(
      `Confirma en tu wallet el pago de ${tokenAmount} ${chosenToken} hacia el hotel en ${chainConfig.name}...`
    );
    const data = encodeErc20TransferData(recipient, requiredUnits);
    txHash = await provider.request({
      method: "eth_sendTransaction",
      params: [
        {
          from: sender,
          to: targetContractAddress,
          value: "0x0",
          data
        }
      ]
    });
  } else {
    const ethRates = getFxRatesSync();
    const ethValue = effectiveUsd / (ethRates.tokensUsd.ETH || 2650);
    const weiBigInt = BigInt(Math.max(1000000000000, Math.round(ethValue * 1e18)));
    const valueHex = "0x" + weiBigInt.toString(16);

    params.onStatusUpdate?.(
      `Confirma en tu wallet el envío de ${ethValue.toFixed(6)} ETH ($${effectiveUsd.toFixed(2)} USD) en ${chainConfig.name}...`
    );

    txHash = await provider.request({
      method: "eth_sendTransaction",
      params: [
        {
          from: sender,
          to: recipient,
          value: valueHex
        }
      ]
    });
  }

  params.onStatusUpdate?.(
    `⏳ Transacción enviada (${txHash.slice(0, 10)}...). Esperando confirmación de bloque en Arbitrum One...`,
    txHash
  );

  const receiptInfo = await waitForOnChainReceipt(provider, txHash);
  if (!receiptInfo.confirmed) {
    throw new Error(
      "La transacción aún sigue pendiente y no fue confirmada dentro del tiempo de espera. Revisa Arbiscan antes de reintentar."
    );
  }

  return {
    txHash,
    explorerUrl: `${chainConfig.explorerTxUrl}${txHash}`,
    chainName: chainConfig.name,
    token: chosenToken,
    chargedUsd: effectiveUsd,
    chargedTokenAmount: tokenAmount,
    walletAddress: sender,
    recipientAddress: recipient,
    modeLabel,
    isRealWalletTx: true,
    blockNumber: receiptInfo.blockNumber
  };
}

export function simulateVerifiedWeb3Payment(params: {
  fullReservationUsd: number;
  chainId: string;
  token: CryptoTokenSymbol;
  mode: Web3PaymentMode;
}): Web3PaymentExecutionResult {
  const chainConfig = SUPPORTED_CHAINS[0];
  const { effectiveUsd, tokenAmount, modeLabel } = computeCheckoutAmounts(
    params.fullReservationUsd,
    params.mode,
    params.token
  );

  const randomHex = Array.from({ length: 64 }, () =>
    Math.floor(Math.random() * 16).toString(16)
  ).join("");
  const txHash = `0x${randomHex}`;

  return {
    txHash,
    explorerUrl: `${chainConfig.explorerTxUrl}${txHash}`,
    chainName: chainConfig.name,
    token: params.token,
    chargedUsd: effectiveUsd,
    chargedTokenAmount: tokenAmount,
    walletAddress: "0x0000...0000 (Simulación Local)",
    recipientAddress: HOTEL_TREASURY_EVM,
    modeLabel: `${modeLabel} [SIMULACIÓN SIN BLOCKCHAIN]`,
    isRealWalletTx: false
  };
}
