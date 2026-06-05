export type ChainId = number;

export interface ChainInfo {
  chainId: ChainId;
  name: string;
  slug: string;
  tier: 'testnet' | 'mainnet' | 'mainnet-stable' | 'newer-l1';
  nativeSymbol: string;
  rpcUrl?: string;
  blockExplorer?: string;
}

const CHAINS: ReadonlyArray<ChainInfo> = [
  {
    chainId: 84532,
    name: 'Base Sepolia',
    slug: 'base-sepolia',
    tier: 'testnet',
    nativeSymbol: 'ETH',
    rpcUrl: 'https://sepolia.base.org',
    blockExplorer: 'https://sepolia.basescan.org',
  },
  {
    chainId: 8453,
    name: 'Base',
    slug: 'base',
    tier: 'mainnet',
    nativeSymbol: 'ETH',
    rpcUrl: 'https://mainnet.base.org',
    blockExplorer: 'https://basescan.org',
  },
];

export const SUPPORTED_CHAIN_IDS: ReadonlyArray<ChainId> = CHAINS.map((c) => c.chainId);

export function listChains(): ChainInfo[] {
  return CHAINS.map((c) => ({ ...c }));
}

export function findChain(chainId: ChainId): ChainInfo | null {
  return CHAINS.find((c) => c.chainId === chainId) ?? null;
}

export function isSupportedChain(chainId: ChainId): boolean {
  return SUPPORTED_CHAIN_IDS.includes(chainId);
}
