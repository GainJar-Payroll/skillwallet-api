import { describe, it, expect } from 'bun:test';
import { PolicyValidatorService } from '../src/runtime/policy/policy-validator.service';
import type { ProposedAction } from '../src/runtime/schemas/execution-attempt.schema';
import type { PolicyManifest } from '../src/runtime/policy/policy-types';
import type { SkillInstallation } from '../src/installations/schemas/skill-installation.schema';

const USDC = '0x4200000000000000000000000000000000000042';
const WETH = '0x420000000000000000000000000000000000000b';
const ROUTER = '0x4200000000000000000000000000000000000101';
const SMART_ACCOUNT = '0x2222222222222222222222222222222222222222';

function buildManifest(): PolicyManifest {
  return {
    allowedTargets: [ROUTER],
    allowedSelectors: [],
    allowedTokens: [USDC, WETH],
    validUntil: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    rules: [
      {
        id: 'r1',
        enforcement: 'backend-policy',
        source: 'skillwallet',
        kind: 'fixed-token-in',
        label: '',
        data: { token: USDC },
      },
      {
        id: 'r2',
        enforcement: 'backend-policy',
        source: 'skillwallet',
        kind: 'fixed-token-out',
        label: '',
        data: { token: WETH },
      },
      {
        id: 'r3',
        enforcement: 'backend-policy',
        source: 'skillwallet',
        kind: 'fixed-recipient',
        label: '',
        data: { recipient: SMART_ACCOUNT },
      },
      {
        id: 'r4',
        enforcement: 'backend-policy',
        source: 'skillwallet',
        kind: 'max-slippage',
        label: '',
        data: { maxSlippageBps: 50 },
      },
    ],
  };
}

function buildInstallation(): SkillInstallation {
  return {
    installationId: 'inst_1',
    userAddress: '0xaaaa',
    userAddressNormalized: '0xaaaa',
    smartAccountAddress: SMART_ACCOUNT,
    smartAccountAddressNormalized: SMART_ACCOUNT.toLowerCase(),
    chainId: 8453,
    skillId: 'dca-usdc-weth',
    adapter: 'dca',
    executorAddress: '0xbbbb',
    executorAddressNormalized: '0xbbbb',
    status: 'active',
    config: {},
    permissionManifest: {},
    budget: {},
    pricingPlan: {},
    schedule: {},
    runtime: {},
  } as unknown as SkillInstallation;
}

function buildSwapAction(overrides: Partial<ProposedAction> = {}): ProposedAction {
  return {
    chainId: 8453,
    target: ROUTER,
    value: '0x0',
    calldata: '0x12345678',
    selector: '0x12345678',
    decoded: {
      actionType: 'swap',
      summary: 'swap USDC->WETH',
      tokenIn: USDC,
      tokenOut: WETH,
      amountIn: '100000000',
      minAmountOut: '50000000000000000',
      recipient: SMART_ACCOUNT,
    },
    metadata: {},
    ...overrides,
  };
}

describe('PolicyValidatorService', () => {
  const validator = new PolicyValidatorService();
  const manifest = buildManifest();
  const installation = buildInstallation();

  it('allows a correct DCA swap action', () => {
    const result = validator.validate(installation, buildSwapAction(), manifest);
    expect(result.ok).toBe(true);
  });

  it('blocks unknown target', () => {
    const action = buildSwapAction({ target: '0xdead00000000000000000000000000000000dead' });
    const result = validator.validate(installation, action, manifest);
    expect(result.ok).toBe(false);
    expect(result.blockedReason).toBe('target not allowed');
  });

  it('blocks unknown selector when selectors are listed', () => {
    const m = { ...manifest, allowedSelectors: ['0xaabbccdd'] };
    const result = validator.validate(installation, buildSwapAction(), m);
    expect(result.ok).toBe(false);
    expect(result.blockedReason).toBe('selector not allowed');
  });

  it('blocks transfer action', () => {
    const action = buildSwapAction({
      decoded: { actionType: 'transfer', summary: 'transfer' },
    });
    const result = validator.validate(installation, action, manifest);
    expect(result.ok).toBe(false);
    expect(result.blockedReason).toBe('transfer actions blocked');
  });

  it('blocks unlimited approval', () => {
    const action = buildSwapAction({
      value: '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
      decoded: { actionType: 'approve', summary: 'approve', spender: ROUTER },
    });
    const result = validator.validate(installation, action, manifest);
    expect(result.ok).toBe(false);
    expect(result.blockedReason).toBe('unlimited approval blocked');
  });

  it('blocks tokenOut not matching WETH', () => {
    const action = buildSwapAction({
      decoded: {
        ...buildSwapAction().decoded,
        tokenOut: '0x4200000000000000000000000000000000000099',
      },
    });
    const result = validator.validate(installation, action, manifest);
    expect(result.ok).toBe(false);
  });

  it('blocks recipient not smart account', () => {
    const action = buildSwapAction({
      decoded: {
        ...buildSwapAction().decoded,
        recipient: '0x4200000000000000000000000000000000000099',
      },
    });
    const result = validator.validate(installation, action, manifest);
    expect(result.ok).toBe(false);
  });

  it('blocks amount above max (erc20-periodic-spend rule)', () => {
    const m: PolicyManifest = {
      ...manifest,
      rules: [
        ...manifest.rules,
        {
          id: 'r5',
          enforcement: 'backend-policy',
          source: 'skillwallet',
          kind: 'erc20-periodic-spend',
          label: '',
          data: { periodAmount: '10', tokenAddress: USDC },
        },
      ],
    };
    const action = buildSwapAction({
      decoded: { ...buildSwapAction().decoded, amountIn: '9999999999' },
    });
    const result = validator.validate(installation, action, m);
    expect(result.ok).toBe(false);
  });

  it('blocks when installation is not active', () => {
    const result = validator.validate(
      { ...installation, status: 'paused' },
      buildSwapAction(),
      manifest,
    );
    expect(result.ok).toBe(false);
    expect(result.blockedReason).toBe('installation not active');
  });

  it('blocks when manifest is expired', () => {
    const expired = { ...manifest, validUntil: new Date(Date.now() - 1000).toISOString() };
    const result = validator.validate(installation, buildSwapAction(), expired);
    expect(result.ok).toBe(false);
    expect(result.blockedReason).toBe('manifest expired');
  });
});
