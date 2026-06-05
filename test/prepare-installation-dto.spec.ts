import { describe, it, expect } from 'bun:test';
import { prepareInstallationSchema } from '../src/installations/dto/prepare-installation.dto';

const USDC = '0x036CbD53842c5426634e7929541eC2318f3dCF7e' as `0x${string}`;
const WETH = '0x4200000000000000000000000000000000000006' as `0x${string}`;
const SWAP = '0x94cC0AaC535CCDB3C01d6787D6413C739ae12bc4' as `0x${string}`;
const USER = ('0x' + '11'.repeat(20)) as `0x${string}`;
const SA = ('0x' + '22'.repeat(20)) as `0x${string}`;

const dcaBase = {
  userAddress: USER,
  smartAccountAddress: SA,
  chainId: 84532,
  skillId: 'direct-router-dca',
  config: {
    type: 'direct-router-dca' as const,
    router: { name: 'uniswap-v3' as const, address: SWAP },
    tokenIn: { address: USDC },
    tokenOut: { address: WETH },
    amountPerRun: '1000000',
    frequency: 'daily' as const,
    feeTier: 3000 as const,
    quoteMode: 'router-quote' as const,
    maxSlippageBps: 100,
  },
};

describe('prepareInstallationSchema', () => {
  it('accepts a valid direct-router-dca input', () => {
    expect(() => prepareInstallationSchema.parse(dcaBase)).not.toThrow();
  });

  it('accepts a valid gm-self-call input', () => {
    expect(() =>
      prepareInstallationSchema.parse({
        userAddress: USER,
        smartAccountAddress: SA,
        chainId: 84532,
        skillId: 'gm-self-call',
        config: {
          type: 'gm-self-call',
          frequency: 'weekly',
          note: 'gm',
        },
      }),
    ).not.toThrow();
  });

  it('rejects missing skillId', () => {
    const { skillId: _omit, ...rest } = dcaBase;
    void _omit;
    expect(() => prepareInstallationSchema.parse(rest)).toThrow(/skillId/);
  });

  it('rejects zero smartAccountAddress', () => {
    const b = { ...dcaBase, smartAccountAddress: '0x0000000000000000000000000000000000000000' };
    expect(() => prepareInstallationSchema.parse(b)).toThrow();
  });

  it('accepts manual-min-out when provided explicitly', () => {
    const b = {
      ...dcaBase,
      config: { ...dcaBase.config, quoteMode: 'manual-min-out' as const, minAmountOut: '900000' },
    };
    expect(() => prepareInstallationSchema.parse(b)).not.toThrow();
  });

  it('accepts generic legacy skillType compatibility field', () => {
    const b = { ...dcaBase, skillType: 'direct-router-dca' };
    expect(() => prepareInstallationSchema.parse(b)).not.toThrow();
  });
});
