import { describe, it, expect } from 'bun:test';
import { PermissionCompilerService } from '../src/permissions/permission-compiler.service';

const USER = '0x1111111111111111111111111111111111111111' as const;
const SMART_ACCOUNT = '0x2222222222222222222222222222222222222222' as const;
const EXECUTOR = '0x3333333333333333333333333333333333333333' as const;
const USDC = '0x4200000000000000000000000000000000000042' as const;
const WETH = '0x420000000000000000000000000000000000000b' as const;
const ROUTER = '0x4200000000000000000000000000000000000101' as const;

describe('PermissionCompilerService', () => {
  const compiler = new PermissionCompilerService();

  it('compiles a DCA permission manifest with the required rules', () => {
    const result = compiler.compileDca({
      skillId: 'dca-usdc-weth',
      chainId: 8453,
      userAddress: USER,
      smartAccountAddress: SMART_ACCOUNT,
      executorAddress: EXECUTOR,
      config: {
        type: 'dca',
        tokenIn: { symbol: 'USDC', address: USDC, decimals: 6 },
        tokenOut: { symbol: 'WETH', address: WETH, decimals: 18 },
        amountPerRun: '100',
        frequency: 'weekly',
        maxSlippageBps: 50,
        router: { name: 'uniswap', address: ROUTER },
        recipient: SMART_ACCOUNT,
        quoteMode: 'external-quote-required',
      },
      durationDays: 30,
    });

    expect(result.manifest.version).toBe('skillwallet.permission.v1');
    expect(result.manifest.skillId).toBe('dca-usdc-weth');
    expect(result.manifest.allowedTargets).toEqual([ROUTER]);
    const ruleKinds = (result.manifest.rules as Array<{ kind: string }>).map((r) => r.kind);
    expect(ruleKinds).toContain('erc20-periodic-spend');
    expect(ruleKinds).toContain('expiry');
    expect(ruleKinds).toContain('allowed-target');
    expect(ruleKinds).toContain('fixed-token-in');
    expect(ruleKinds).toContain('fixed-token-out');
    expect(ruleKinds).toContain('fixed-recipient');
    expect(ruleKinds).toContain('max-slippage');
    expect(ruleKinds).toContain('no-unlimited-approval');
    expect(result.manifestHash).toMatch(/^0x[a-f0-9]{64}$/);
  });

  it('compiles an ERC-7715 wallet request with correct base units and period', () => {
    const result = compiler.compileDca({
      skillId: 'dca-usdc-weth',
      chainId: 8453,
      userAddress: USER,
      smartAccountAddress: SMART_ACCOUNT,
      executorAddress: EXECUTOR,
      config: {
        type: 'dca',
        tokenIn: { symbol: 'USDC', address: USDC, decimals: 6 },
        tokenOut: { symbol: 'WETH', address: WETH, decimals: 18 },
        amountPerRun: '1.5',
        frequency: 'daily',
        maxSlippageBps: 30,
        router: { name: 'uniswap', address: ROUTER },
        recipient: SMART_ACCOUNT,
        quoteMode: 'external-quote-required',
      },
      durationDays: 7,
    });

    const raw = result.walletRequest.rawRequest as Record<string, unknown>;
    const permission = raw.permission as { type: string; data: Record<string, unknown> };
    expect(raw.chainId).toBe('0x2105');
    expect(raw.from).toBe(SMART_ACCOUNT);
    expect(raw.to).toBe(EXECUTOR);
    expect(permission.type).toBe('erc20-token-periodic');
    expect(permission.data.tokenAddress).toBe(USDC);
    expect(permission.data.periodAmount).toBe('1500000');
    expect(permission.data.periodDuration).toBe(24 * 60 * 60);
    expect((result.walletRequest as { method: string }).method).toBe(
      'wallet_requestExecutionPermissions',
    );
    expect(result.requestHash).toMatch(/^0x[a-f0-9]{64}$/);
  });

  it('produces a stable manifest hash for identical inputs', () => {
    const fixedNow = new Date('2026-01-15T00:00:00.000Z');
    const input = {
      skillId: 'dca-usdc-weth',
      chainId: 8453,
      userAddress: USER,
      smartAccountAddress: SMART_ACCOUNT,
      executorAddress: EXECUTOR,
      config: {
        type: 'dca' as const,
        tokenIn: { symbol: 'USDC' as const, address: USDC, decimals: 6 },
        tokenOut: { symbol: 'WETH' as const, address: WETH, decimals: 18 },
        amountPerRun: '100',
        frequency: 'weekly' as const,
        maxSlippageBps: 50,
        router: { name: 'uniswap' as const, address: ROUTER },
        recipient: SMART_ACCOUNT,
        quoteMode: 'external-quote-required' as const,
      },
      durationDays: 30,
      now: fixedNow,
    };
    const a = compiler.compileDca(input);
    const b = compiler.compileDca(input);
    expect(a.manifestHash).toBe(b.manifestHash);
  });

  it('compiles aerodrome-vote manifest', () => {
    const result = compiler.compileAerodromeVote({
      skillId: 'aerodrome-vote-optimizer',
      chainId: 8453,
      userAddress: USER,
      smartAccountAddress: SMART_ACCOUNT,
      executorAddress: EXECUTOR,
      config: {
        type: 'aerodrome-vote',
        veAeroTokenId: '12345',
        strategy: 'max-reward-density',
        maxPools: 4,
        allowAiExplanation: true,
      },
      durationDays: 30,
    });
    expect(result.manifest.version).toBe('skillwallet.permission.v1');
    const raw = result.walletRequest.rawRequest as Record<string, unknown>;
    const permission = raw.permission as { type: string; data: Record<string, unknown> };
    expect(permission.type).toBe('aerodrome-vote-optimizer');
    expect(permission.data.veAeroTokenId).toBe('12345');
  });
});
