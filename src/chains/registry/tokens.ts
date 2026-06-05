import type { Address } from '../../common/types/evm';

export type TokenTag = 'stablecoin' | 'wrapped-native' | 'btc' | 'testnet';

export interface TokenDescriptor {
  chainId: number;
  symbol: string;
  name: string;
  address: Address;
  decimals: number;
  tags: TokenTag[];
}

const STATIC_TOKENS: ReadonlyArray<TokenDescriptor> = [
  {
    chainId: 84532,
    symbol: 'USDC',
    name: 'USD Coin (Base Sepolia)',
    address: '0x036CbD53842c5426634e7929541eC2318f3dCF7e' as Address,
    decimals: 6,
    tags: ['stablecoin', 'testnet'],
  },
  {
    chainId: 84532,
    symbol: 'WETH',
    name: 'Wrapped Ether (Base Sepolia)',
    address: '0x4200000000000000000000000000000000000006' as Address,
    decimals: 18,
    tags: ['wrapped-native', 'testnet'],
  },
  {
    chainId: 8453,
    symbol: 'USDC',
    name: 'USD Coin (Base)',
    address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as Address,
    decimals: 6,
    tags: ['stablecoin'],
  },
  {
    chainId: 8453,
    symbol: 'WETH',
    name: 'Wrapped Ether (Base)',
    address: '0x4200000000000000000000000000000000000006' as Address,
    decimals: 18,
    tags: ['wrapped-native'],
  },
  {
    chainId: 8453,
    symbol: 'cbBTC',
    name: 'Coinbase Wrapped BTC (Base)',
    address: '0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf' as Address,
    decimals: 8,
    tags: ['btc'],
  },
];

export function listTokensForChain(chainId: number): TokenDescriptor[] {
  return STATIC_TOKENS.filter((t) => t.chainId === chainId).map((t) => ({ ...t }));
}

export function findToken(chainId: number, address: string): TokenDescriptor | null {
  const target = address.toLowerCase();
  const hit = STATIC_TOKENS.find(
    (t) => t.chainId === chainId && t.address.toLowerCase() === target,
  );
  return hit ? { ...hit } : null;
}

export function isTokenSupported(chainId: number, address: string): boolean {
  return findToken(chainId, address) !== null;
}

export function requireToken(chainId: number, address: string): TokenDescriptor {
  const t = findToken(chainId, address);
  if (!t) {
    throw new Error(
      `Token ${address} not in registry for chainId ${chainId}. Only registered MVP tokens are supported.`,
    );
  }
  return t;
}
