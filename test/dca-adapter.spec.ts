import { describe, it, expect } from 'bun:test';
import { DcaAdapter } from '../src/runtime/adapters/dca.adapter';
import type { SkillInstallation } from '../src/installations/schemas/skill-installation.schema';

const USDC = '0x4200000000000000000000000000000000000042';
const WETH = '0x420000000000000000000000000000000000000b';
const ROUTER = '0x4200000000000000000000000000000000000101';
const SMART_ACCOUNT = '0x2222222222222222222222222222222222222222';

interface DcaConfig {
  type: 'dca';
  tokenIn: { symbol: 'USDC'; address: string; decimals: 6 };
  tokenOut: { symbol: 'WETH'; address: string; decimals: 18 };
  amountPerRun: string;
  frequency: 'daily' | 'weekly' | 'monthly';
  maxSlippageBps: number;
  router: { name: 'uniswap' | 'aerodrome' | 'custom'; address: string };
  recipient: string;
  quoteMode: 'external-quote-required' | 'router-quote' | 'manual-min-out';
  minAmountOut?: string;
}

function buildDcaConfig(): DcaConfig {
  return {
    type: 'dca',
    tokenIn: { symbol: 'USDC', address: USDC, decimals: 6 },
    tokenOut: { symbol: 'WETH', address: WETH, decimals: 18 },
    amountPerRun: '100',
    frequency: 'weekly',
    maxSlippageBps: 50,
    router: { name: 'uniswap', address: ROUTER },
    recipient: SMART_ACCOUNT,
    quoteMode: 'external-quote-required',
  };
}

describe('DcaAdapter', () => {
  const adapter = new DcaAdapter();

  it('validates a correct DCA config', () => {
    expect(() => adapter.validateConfig(buildDcaConfig())).not.toThrow();
  });

  it('rejects manual-min-out without minAmountOut', () => {
    const cfg = { ...buildDcaConfig(), quoteMode: 'manual-min-out' as const };
    expect(() => adapter.validateConfig(cfg)).toThrow(/minAmountOut/);
  });

  it('rejects invalid maxSlippageBps', () => {
    const cfg = { ...buildDcaConfig(), maxSlippageBps: 1000 };
    expect(() => adapter.validateConfig(cfg)).toThrow(/maxSlippageBps/);
  });

  it('buildAction throws NOT_IMPLEMENTED until real router builder is wired', async () => {
    await expect(
      adapter.buildAction({
        installation: { config: buildDcaConfig() } as unknown as SkillInstallation,
        now: new Date(),
      }),
    ).rejects.toThrow(/not yet implemented/i);
  });

  it('checkTrigger blocks when status is not active', () => {
    const result = adapter.checkTrigger({
      installation: { status: 'paused', config: buildDcaConfig() } as unknown as SkillInstallation,
      now: new Date(),
    });
    expect(result.shouldRun).toBe(false);
  });

  it('checkTrigger blocks when no wallet grant', () => {
    const result = adapter.checkTrigger({
      installation: {
        status: 'active',
        config: buildDcaConfig(),
        walletPermissionGrant: undefined,
      } as unknown as SkillInstallation,
      now: new Date(),
    });
    expect(result.shouldRun).toBe(false);
  });
});
