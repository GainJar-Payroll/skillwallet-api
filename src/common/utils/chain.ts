export function toChainIdHex(chainId: number): `0x${string}` {
  return `0x${chainId.toString(16)}` as `0x${string}`;
}

export function chainIdFromHex(hex: string): number {
  return Number.parseInt(hex, 16);
}
