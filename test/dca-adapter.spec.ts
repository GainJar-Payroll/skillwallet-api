import { describe, it, expect, mock, beforeEach, afterEach } from 'bun:test';
import { DcaAdapter } from '../src/runtime/adapters/dca.adapter';
import { ErrorCode } from '../src/common/errors/error-codes';

describe('DcaAdapter (fail-closed)', () => {
  it('validateConfig rejects bad config', () => {
    const a = new DcaAdapter();
    try {
      a.validateConfig(null);
      expect.unreachable();
    } catch (err) {
      expect((err as { code: string }).code).toBe(ErrorCode.VALIDATION_ERROR);
    }
    try {
      a.validateConfig({ type: 'other' });
      expect.unreachable();
    } catch (err) {
      expect((err as { code: string }).code).toBe(ErrorCode.VALIDATION_ERROR);
    }
    try {
      a.validateConfig({
        type: 'dca',
        tokenIn: { address: '0x' },
        tokenOut: { address: '0x' },
        amountPerRun: 'abc',
        router: { address: '0x' },
        recipient: '0x',
        maxSlippageBps: 10,
      });
      expect.unreachable();
    } catch (err) {
      expect((err as Error).message).toMatch(/amountPerRun/);
    }
  });

  it('validateConfig accepts a well-formed config', () => {
    const a = new DcaAdapter();
    expect(() =>
      a.validateConfig({
        type: 'dca',
        tokenIn: {
          symbol: 'USDC',
          address: '0x' + '1'.repeat(40),
          decimals: 6,
        },
        tokenOut: {
          symbol: 'WETH',
          address: '0x' + '2'.repeat(40),
          decimals: 18,
        },
        amountPerRun: '10.5',
        frequency: 'weekly',
        maxSlippageBps: 50,
        router: { name: 'aerodrome', address: '0x' + '3'.repeat(40) },
        recipient: '0x' + '4'.repeat(40),
        quoteMode: 'router-quote',
      }),
    ).not.toThrow();
  });

  it('checkTrigger returns shouldRun=false for non-active installation', () => {
    const a = new DcaAdapter();
    const result = a.checkTrigger({
      now: new Date(),
      installation: {
        installationId: 'i1',
        userAddress: '0x' + '1'.repeat(40),
        chainId: 8453,
        skillId: 'dca',
        adapter: 'dca',
        status: 'paused',
        config: {},
      } as never,
    });
    expect(result.shouldRun).toBe(false);
    expect(result.reason).toContain('paused');
  });

  it('checkTrigger returns shouldRun=true for an active installation past its schedule', () => {
    const a = new DcaAdapter();
    const result = a.checkTrigger({
      now: new Date('2026-01-01T00:00:00Z'),
      installation: {
        installationId: 'i1',
        userAddress: '0x' + '1'.repeat(40),
        chainId: 8453,
        skillId: 'dca',
        adapter: 'dca',
        status: 'active',
        walletPermissionGrant: { grantId: 'g1' },
        config: {},
      } as never,
    });
    expect(result.shouldRun).toBe(true);
  });

  it('buildAction throws NOT_IMPLEMENTED (no fake swap calldata)', async () => {
    const a = new DcaAdapter();
    try {
      await a.buildAction({
        now: new Date(),
        installation: {
          installationId: 'i1',
          userAddress: '0x' + '1'.repeat(40),
          chainId: 8453,
          skillId: 'dca',
          adapter: 'dca',
          status: 'active',
          config: {
            type: 'dca',
            tokenIn: { address: '0x' + '1'.repeat(40), symbol: 'USDC', decimals: 6 },
            tokenOut: { address: '0x' + '2'.repeat(40), symbol: 'WETH', decimals: 18 },
            amountPerRun: '10',
            router: { name: 'aerodrome', address: '0x' + '3'.repeat(40) },
            recipient: '0x' + '4'.repeat(40),
            maxSlippageBps: 50,
            quoteMode: 'router-quote',
            frequency: 'daily',
          },
        } as never,
      });
      expect.unreachable();
    } catch (err) {
      expect((err as { code: string }).code).toBe(ErrorCode.NOT_IMPLEMENTED);
    }
  });
});

// Import mock setup to silence unused warnings if needed.
describe('mock import smoke', () => {
  let originalFetch: typeof fetch;
  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });
  it('mock is callable', () => {
    const m = mock(() => 1);
    expect(m()).toBe(1);
  });
});
