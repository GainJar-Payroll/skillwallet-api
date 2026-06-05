import type { Address } from '../../common/types/evm';

export type DexKind = 'uniswap-v3';
export type FeeTier = 100 | 500 | 3000 | 10000;

export interface DexRouter {
  chainId: number;
  routerName: DexKind;
  swapRouter02: Address;
  quoterV2?: Address;
  factory?: Address;
  feeTiers: FeeTier[];
  proofStatus: 'proven-on-base-sepolia' | 'target-production' | 'not-proven';
}

const ROUTERS: ReadonlyArray<DexRouter> = [
  {
    chainId: 84532,
    routerName: 'uniswap-v3',
    swapRouter02: '0x94cC0AaC535CCDB3C01d6787D6413C739ae12bc4' as Address,
    quoterV2: '0xC5290058841028F1614F3A6F0F5816cAd0df5E27' as Address,
    factory: '0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24' as Address,
    feeTiers: [500, 3000, 10000],
    proofStatus: 'proven-on-base-sepolia',
  },
  {
    chainId: 8453,
    routerName: 'uniswap-v3',
    swapRouter02: '0x2626664c2603336E57B271c5C0b26F421741e481' as Address,
    feeTiers: [100, 500, 3000, 10000],
    proofStatus: 'target-production',
  },
];

export function listDexForChain(chainId: number): DexRouter[] {
  return ROUTERS.filter((r) => r.chainId === chainId).map((r) => ({ ...r }));
}

export function findDexRouter(chainId: number, routerName: DexKind): DexRouter | null {
  const hit = ROUTERS.find((r) => r.chainId === chainId && r.routerName === routerName);
  return hit ? { ...hit } : null;
}

export function requireDexRouter(chainId: number, routerName: DexKind): DexRouter {
  const r = findDexRouter(chainId, routerName);
  if (!r) {
    throw new Error(
      `DEX ${routerName} not configured for chainId ${chainId}. Supported MVP chains: 84532 (Base Sepolia), 8453 (Base).`,
    );
  }
  return r;
}
