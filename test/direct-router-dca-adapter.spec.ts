import { describe, it, expect } from 'bun:test';
import { ConfigService } from '@nestjs/config';
import { DirectRouterDcaAdapter } from '../src/runtime/adapters/direct-router-dca.adapter';

const USDC = '0x036CbD53842c5426634e7929541eC2318f3dCF7e';
const WETH = '0x4200000000000000000000000000000000000006';
const SWAP = '0x94cC0AaC535CCDB3C01d6787D6413C739ae12bc4';
const RECIPIENT = '0x' + 'aa'.repeat(20);
const DELEGATE = '0x' + 'bb'.repeat(20);
const FEE_COLLECTOR = '0x' + 'cc'.repeat(20);

const VALID_CONFIG = {
  type: 'direct-router-dca' as const,
  router: { name: 'uniswap-v3' as const, address: SWAP },
  tokenIn: { address: USDC },
  tokenOut: { address: WETH },
  amountPerRun: '1000000',
  frequency: 'daily' as const,
  feeTier: 3000 as const,
  quoteMode: 'router-quote' as const,
  maxSlippageBps: 100,
  recipient: RECIPIENT,
};

function makeAdapter(quotedAmountOut = 880000000000000n): DirectRouterDcaAdapter {
  const mockConfig = {
    get: () => undefined,
  } as unknown as ConfigService;
  const mockQuoter = {
    quoteExactInputSingle: async () => quotedAmountOut,
  } as const;
  return new DirectRouterDcaAdapter(mockConfig, mockQuoter as never);
}

describe('DirectRouterDcaAdapter', () => {
  it('exposes a stable kind', () => {
    const a = makeAdapter();
    expect(a.kind).toBe('direct-router-dca');
  });

  describe('parseConfig — happy path', () => {
    const a = makeAdapter();

    it('accepts router-quote with maxSlippageBps', () => {
      expect(() => a.parseConfig(VALID_CONFIG)).not.toThrow();
    });

    it('accepts manual-min-out with minAmountOut', () => {
      expect(() =>
        a.parseConfig({ ...VALID_CONFIG, quoteMode: 'manual-min-out', minAmountOut: '500000' }),
      ).not.toThrow();
    });
  });

  describe('parseConfig — failure cases', () => {
    const a = makeAdapter();

    it('rejects wrong type', () => {
      expect(() => a.parseConfig({ ...VALID_CONFIG, type: 'aerodrome' as never })).toThrow();
    });

    it('rejects manual-min-out without minAmountOut', () => {
      expect(() =>
        a.parseConfig({ ...VALID_CONFIG, quoteMode: 'manual-min-out', minAmountOut: undefined }),
      ).toThrow(/minAmountOut/);
    });

    it('rejects missing recipient', () => {
      const { recipient: _omit, ...rest } = VALID_CONFIG;
      void _omit;
      expect(() => a.parseConfig(rest)).toThrow(/recipient/);
    });
  });

  it('prepare computes router-quote output units and locks recipient', async () => {
    const a = makeAdapter(500000n);
    const prepared = await a.prepare({
      skillId: 'direct-router-dca',
      userAddress: RECIPIENT as `0x${string}`,
      smartAccountAddress: RECIPIENT as `0x${string}`,
      chainId: 84532,
      now: new Date('2026-06-05T00:00:00.000Z'),
      config: VALID_CONFIG,
      relay: {
        delegate: DELEGATE as `0x${string}`,
        feeCollector: FEE_COLLECTOR as `0x${string}`,
        paymentToken: USDC as `0x${string}`,
        requiredPaymentAmount: '10000',
      },
      expiresAt: new Date('2026-07-05T00:00:00.000Z'),
    });

    expect(prepared.review?.amountOut).toBe('500000');
    expect(prepared.review?.minAmountOut).toBe('495000');
    expect(prepared.configSnapshot.recipient).toBe(RECIPIENT);
    expect(prepared.configSnapshot.minAmountOut).toBe('495000');
    expect(prepared.previewCalls[1].target).toBe(USDC);
  });

  it('buildAction approves tokenIn instead of the fee payment token alias', async () => {
    const a = makeAdapter();
    const built = await a.buildAction(
      {
        installationId: 'inst_1',
        userAddress: RECIPIENT as `0x${string}`,
        smartAccountAddress: RECIPIENT as `0x${string}`,
        chainId: 84532,
        now: new Date('2026-06-05T00:00:00.000Z'),
        config: {
          ...VALID_CONFIG,
          minAmountOut: '495000',
          quotedAmountOut: '500000',
        },
        relay: {
          delegate: DELEGATE as `0x${string}`,
          feeCollector: FEE_COLLECTOR as `0x${string}`,
          paymentToken: USDC as `0x${string}`,
          requiredPaymentAmount: '10000',
        },
        grant: {
          grantId: 'grant_1',
          chainId: 84532,
          delegator: RECIPIENT as `0x${string}`,
          delegate: DELEGATE as `0x${string}`,
          permissionContext: [],
        },
      },
      {
        ...VALID_CONFIG,
        minAmountOut: '495000',
        quotedAmountOut: '500000',
      },
    );

    expect(built.executions).toHaveLength(3);
    expect(built.executions[1].actions[0].target).toBe(USDC);
    expect(built.executions[2].actions[0].target).toBe(SWAP);
  });
});
