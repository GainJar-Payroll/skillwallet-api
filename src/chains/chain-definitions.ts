import { ChainConfig } from './chain-config.schema';

export type ChainTier = 'mainnet' | 'mainnet-stable' | 'testnet-only' | 'newer-l1';

export interface BuiltInChainDefinition {
  chainId: number;
  name: string;
  slug: string;
  rpcUrl: string;
  delegationManagerAddress?: string;
  usdcAddress?: string;
  wethAddress?: string;
  swapRouterAddress?: string;
  metadata: {
    tier: ChainTier;
    nativeSymbol: string;
    blockExplorer?: string;
    notes?: string;
  };
}

function entry(
  input: Omit<BuiltInChainDefinition, 'metadata'> & {
    metadata: BuiltInChainDefinition['metadata'];
  },
): ChainConfig {
  return {
    chainId: input.chainId,
    name: input.name,
    rpcUrl: input.rpcUrl,
    delegationManagerAddress: input.delegationManagerAddress,
    usdcAddress: input.usdcAddress,
    wethAddress: input.wethAddress,
    swapRouterAddress: input.swapRouterAddress,
    metadata: input.metadata as unknown as Record<string, unknown>,
  };
}

export const builtInChains: ChainConfig[] = [
  entry({
    chainId: 1,
    name: 'Ethereum',
    slug: 'ethereum',
    rpcUrl: 'https://eth.llamarpc.com',
    usdcAddress: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    wethAddress: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
    swapRouterAddress: '0xE592427A0AEce92De3Edee1F18E0157C05861564',
    metadata: { tier: 'mainnet', nativeSymbol: 'ETH', blockExplorer: 'https://etherscan.io' },
  }),
  entry({
    chainId: 10,
    name: 'Optimism',
    slug: 'optimism',
    rpcUrl: 'https://mainnet.optimism.io',
    usdcAddress: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85',
    wethAddress: '0x4200000000000000000000000000000000000006',
    swapRouterAddress: '0xE592427A0AEce92De3Edee1F18E0157C05861564',
    metadata: {
      tier: 'mainnet',
      nativeSymbol: 'ETH',
      blockExplorer: 'https://optimistic.etherscan.io',
    },
  }),
  entry({
    chainId: 56,
    name: 'BNB Chain',
    slug: 'bnb-chain',
    rpcUrl: 'https://bsc-dataseed.binance.org',
    usdcAddress: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d',
    wethAddress: '0x2170Ed0880ac9A755fd29B2688956BD959F933F8',
    swapRouterAddress: '0xB97154d8F3EA0a3058A8E6964D7c3b98d0F77F4D',
    metadata: {
      tier: 'mainnet',
      nativeSymbol: 'BNB',
      blockExplorer: 'https://bscscan.com',
      notes: 'WBNB used as WETH analog',
    },
  }),
  entry({
    chainId: 130,
    name: 'Unichain',
    slug: 'unichain',
    rpcUrl: 'https://mainnet.unichain.org',
    usdcAddress: '0x078d782b760474a361dda0af3839290b0ef57ad6',
    wethAddress: '0x4200000000000000000000000000000000000006',
    metadata: { tier: 'newer-l1', nativeSymbol: 'ETH', blockExplorer: 'https://uniscan.xyz' },
  }),
  entry({
    chainId: 137,
    name: 'Polygon',
    slug: 'polygon',
    rpcUrl: 'https://polygon-rpc.com',
    usdcAddress: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359',
    wethAddress: '0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619',
    swapRouterAddress: '0xE592427A0AEce92De3Edee1F18E0157C05861564',
    metadata: { tier: 'mainnet', nativeSymbol: 'POL', blockExplorer: 'https://polygonscan.com' },
  }),
  entry({
    chainId: 143,
    name: 'Monad',
    slug: 'monad',
    rpcUrl: 'https://rpc.monad.xyz',
    metadata: {
      tier: 'testnet-only',
      nativeSymbol: 'MON',
      blockExplorer: 'https://monadexplorer.com',
      notes: 'Mainnet not yet live; USDC/WETH addresses to be set once contracts deploy',
    },
  }),
  entry({
    chainId: 146,
    name: 'Sonic',
    slug: 'sonic',
    rpcUrl: 'https://rpc.soniclabs.com',
    usdcAddress: '0x29219dd400f2Bf60E5a23d13Be72B49D941AB6A3',
    wethAddress: '0x50c42dEAcD8Fc9773493ED674b675bE577f2634b',
    swapRouterAddress: '0x9C5A7FbE10B1A9C76e4B23b59E45C8F0F3D2C5A4',
    metadata: {
      tier: 'newer-l1',
      nativeSymbol: 'S',
      blockExplorer: 'https://sonicscan.org',
      notes: 'USDC.e (bridged) and bridged WETH',
    },
  }),
  entry({
    chainId: 8453,
    name: 'Base',
    slug: 'base',
    rpcUrl: 'https://mainnet.base.org',
    usdcAddress: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    wethAddress: '0x4200000000000000000000000000000000000006',
    swapRouterAddress: '0x2626664c2603336E57B271c5C0b26F421741e481',
    metadata: { tier: 'mainnet', nativeSymbol: 'ETH', blockExplorer: 'https://basescan.org' },
  }),
  entry({
    chainId: 11155111,
    name: 'Ethereum Sepolia',
    slug: 'ethereum-sepolia',
    rpcUrl: 'https://eth-sepolia.g.alchemy.com/v2/demo',
    usdcAddress: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
    delegationManagerAddress: '0xdb9B1e94B5b69Df7e401DDbedE43491141047dB3',
    metadata: {
      tier: 'testnet-only',
      nativeSymbol: 'ETH',
      blockExplorer: 'https://sepolia.etherscan.io',
      notes: 'MetaMask Smart Accounts Kit testnet (v1.3.0 delegation framework)',
    },
  }),
  entry({
    chainId: 42161,
    name: 'Arbitrum One',
    slug: 'arbitrum-one',
    rpcUrl: 'https://arb1.arbitrum.io/rpc',
    usdcAddress: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
    wethAddress: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1',
    swapRouterAddress: '0xE592427A0AEce92De3Edee1F18E0157C05861564',
    metadata: { tier: 'mainnet', nativeSymbol: 'ETH', blockExplorer: 'https://arbiscan.io' },
  }),
  entry({
    chainId: 42220,
    name: 'Celo',
    slug: 'celo',
    rpcUrl: 'https://forno.celo.org',
    usdcAddress: '0xef4229c8c3250C675F06BCc719f7A6d91E26B587',
    swapRouterAddress: '0xE3B8D8B56E68b4D2C3F2F8e8b4b7F7D9e4f5A8c1',
    metadata: {
      tier: 'mainnet',
      nativeSymbol: 'CELO',
      blockExplorer: 'https://celoscan.io',
      notes: 'No native WETH; DCA falls back to USDC→cUSD or USDC→native swap',
    },
  }),
  entry({
    chainId: 59144,
    name: 'Linea',
    slug: 'linea',
    rpcUrl: 'https://rpc.linea.build',
    usdcAddress: '0x176211869cA2b568f2A7D4EE941E073a821EE1ff',
    wethAddress: '0xe5D7C2a44FfDDf6b295A15C148Efda3Af9a43845',
    swapRouterAddress: '0xB70407f4A9C2A1A2D62E76C3F9b3D3F2c8e0b4F5',
    metadata: { tier: 'mainnet', nativeSymbol: 'ETH', blockExplorer: 'https://lineascan.build' },
  }),
];

export const BUILT_IN_CHAIN_IDS = builtInChains.map((c) => c.chainId);
