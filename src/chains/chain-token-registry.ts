export interface TokenDescriptor {
  symbol: string;
  address: string;
  decimals: number;
}

export const CHAIN_TOKEN_REGISTRY: Record<number, TokenDescriptor[]> = {
  11155111: [
    { symbol: 'USDC', address: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238', decimals: 6 },
    { symbol: 'WETH', address: '0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14', decimals: 18 },
  ],
};

export function getAllowedTokens(chainId: number): TokenDescriptor[] {
  return CHAIN_TOKEN_REGISTRY[chainId] ?? [];
}

export function isTokenAllowed(chainId: number, address: string): boolean {
  const allowed = CHAIN_TOKEN_REGISTRY[chainId];
  if (!allowed) return true;
  const target = address.toLowerCase();
  return allowed.some((t) => t.address.toLowerCase() === target);
}
