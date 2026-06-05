export interface ChainTokens {
  usdc: `0x${string}`;
  weth: `0x${string}`;
  cbBtc: `0x${string}`;
}

export interface ChainDex {
  swapRouter02: `0x${string}`;
  quoterV2: `0x${string}`;
  uniswapV3Factory: `0x${string}`;
}

export interface ChainSkillContracts {
  gmContract: `0x${string}`;
}

export interface OneShotChainInfo {
  feeCollector: `0x${string}`;
  targetAddress: `0x${string}`;
}

export interface ChainConfig {
  chainId: number;
  name: string;
  tokens: ChainTokens;
  dex: ChainDex;
  skillContracts: ChainSkillContracts;
}

export const CHAIN_CONFIGS: Record<number, ChainConfig> = {
  84532: {
    chainId: 84532,
    name: 'base-sepolia',
    tokens: {
      usdc: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
      weth: '0x4200000000000000000000000000000000000006',
      cbBtc: '0x0000000000000000000000000000000000000000',
    },
    dex: {
      swapRouter02: '0x94cC0AaC535CCDB3C01d6787D6413C739ae12bc4',
      quoterV2: '0xC5290058841028F1614F3A6F0F5816cAd0df5E27',
      uniswapV3Factory: '0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24',
    },
    skillContracts: {
      gmContract: '0x0000000000000000000000000000000000000000',
    },
  },
  8453: {
    chainId: 8453,
    name: 'base-mainnet',
    tokens: {
      usdc: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
      weth: '0x4200000000000000000000000000000000000006',
      cbBtc: '0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf',
    },
    dex: {
      swapRouter02: '0x2626664c2603336E57B271c5C0b26F421741e481',
      quoterV2: '0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a',
      uniswapV3Factory: '0x33128a8fC17869897dcE68Ed026d694621f6FDfD',
    },
    skillContracts: {
      gmContract: '0x0000000000000000000000000000000000000000',
    },
  },
};

export function getChainConfig(chainId: number): ChainConfig {
  const cfg = CHAIN_CONFIGS[chainId];
  if (!cfg) throw new Error(`Unsupported chainId: ${chainId}`);
  return cfg;
}
