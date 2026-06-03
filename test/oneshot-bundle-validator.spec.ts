import { describe, it, expect } from 'bun:test';
import { OneShotBundleValidator } from '../src/runtime/relayers/oneshot-bundle-validator';
import { ErrorCode } from '../src/common/errors/error-codes';

const VALID_DELEGATION = {
  delegate: '0x1111111111111111111111111111111111111111',
  delegator: '0x2222222222222222222222222222222222222222',
  authority: '0x3333333333333333333333333333333333333333',
  caveats: [],
  salt: '0x' + '0'.repeat(64),
  signature: '0xabcd',
};

const VALID_EXECUTION = {
  target: '0x4444444444444444444444444444444444444444',
  value: '0x0',
  data: '0xdeadbeef',
};

const VALID_BUNDLE = {
  chainId: 8453,
  transactions: [
    {
      permissionContext: [VALID_DELEGATION],
      executions: [VALID_EXECUTION],
    },
  ],
};

describe('OneShotBundleValidator', () => {
  it('accepts a well-formed bundle', () => {
    const v = new OneShotBundleValidator();
    expect(() => v.validateShape(VALID_BUNDLE)).not.toThrow();
  });

  it('rejects when chainId is missing or non-positive', () => {
    const v = new OneShotBundleValidator();
    const bad = { ...VALID_BUNDLE, chainId: 0 };
    try {
      v.validateShape(bad as never);
      expect.unreachable();
    } catch (err) {
      expect((err as { code: string }).code).toBe(ErrorCode.INVALID_ONESHOT_BUNDLE);
    }
  });

  it('rejects empty transactions array', () => {
    const v = new OneShotBundleValidator();
    const bad = { ...VALID_BUNDLE, transactions: [] };
    try {
      v.validateShape(bad as never);
      expect.unreachable();
    } catch (err) {
      expect((err as { code: string }).code).toBe(ErrorCode.INVALID_ONESHOT_BUNDLE);
    }
  });

  it('rejects empty permissionContext per transaction', () => {
    const v = new OneShotBundleValidator();
    const bad = {
      ...VALID_BUNDLE,
      transactions: [{ permissionContext: [], executions: [VALID_EXECUTION] }],
    };
    expect(() => v.validateShape(bad as never)).toThrow(/permissionContext is empty/);
  });

  it('rejects non-address delegate', () => {
    const v = new OneShotBundleValidator();
    const bad = {
      ...VALID_BUNDLE,
      transactions: [
        {
          permissionContext: [{ ...VALID_DELEGATION, delegate: 'not-an-address' }],
          executions: [VALID_EXECUTION],
        },
      ],
    };
    expect(() => v.validateShape(bad as never)).toThrow(/delegate is not a valid address/);
  });

  it('rejects non-hex data on execution', () => {
    const v = new OneShotBundleValidator();
    const bad = {
      ...VALID_BUNDLE,
      transactions: [
        {
          permissionContext: [VALID_DELEGATION],
          executions: [{ ...VALID_EXECUTION, data: '0xZZ' }],
        },
      ],
    };
    expect(() => v.validateShape(bad as never)).toThrow(/data is not valid hex/);
  });

  it('refuses bundles that contain a privateKey field anywhere', () => {
    const v = new OneShotBundleValidator();
    const bad = {
      ...VALID_BUNDLE,
      transactions: [
        {
          permissionContext: [VALID_DELEGATION],
          executions: [
            {
              target: '0x4444444444444444444444444444444444444444',
              value: '0x0',
              data: '0x',
            },
          ],
        },
      ],
      authorizationList: [
        {
          address: '0x4444444444444444444444444444444444444444',
          chainId: 8453,
          nonce: 0,
          r: '0x',
          s: '0x',
          yParity: 0,
          privateKey: '0xDEAD',
        },
      ],
    };
    try {
      v.validateShape(bad as never);
      expect.unreachable();
    } catch (err) {
      expect((err as { code: string }).code).toBe(ErrorCode.INVALID_ONESHOT_BUNDLE);
      expect((err as Error).message).toMatch(/privateKey/);
    }
  });

  it('validateContext rejects empty/missing context', () => {
    const v = new OneShotBundleValidator();
    try {
      v.validateContext('', 8453, '0xUSDC');
      expect.unreachable();
    } catch (err) {
      expect((err as { code: string }).code).toBe(ErrorCode.MISSING_ONESHOT_CONTEXT);
    }
  });

  it('validateContext rejects non-JSON context', () => {
    const v = new OneShotBundleValidator();
    try {
      v.validateContext('not-json', 8453, '0xUSDC');
      expect.unreachable();
    } catch (err) {
      expect((err as { code: string }).code).toBe(ErrorCode.EXPIRED_ONESHOT_CONTEXT);
    }
  });

  it('validateContext rejects expired context', () => {
    const v = new OneShotBundleValidator();
    const ctx = JSON.stringify({ expiry: Math.floor(Date.now() / 1000) - 60 });
    try {
      v.validateContext(ctx, 8453, '0xUSDC');
      expect.unreachable();
    } catch (err) {
      expect((err as { code: string }).code).toBe(ErrorCode.EXPIRED_ONESHOT_CONTEXT);
    }
  });

  it('validateContext rejects chainId mismatch', () => {
    const v = new OneShotBundleValidator();
    const ctx = JSON.stringify({
      expiry: Math.floor(Date.now() / 1000) + 60,
      chainId: 8453,
      paymentTokenAddress: '0xUSDC',
    });
    try {
      v.validateContext(ctx, 1, '0xUSDC');
      expect.unreachable();
    } catch (err) {
      expect((err as { code: string }).code).toBe(ErrorCode.SIGNATURE_REFRESH_REQUIRED);
    }
  });

  it('validateContext accepts a fresh matching context', () => {
    const v = new OneShotBundleValidator();
    const ctx = JSON.stringify({
      expiry: Math.floor(Date.now() / 1000) + 600,
      chainId: 8453,
      paymentTokenAddress: '0xUSDC',
    });
    expect(() => v.validateContext(ctx, 8453, '0xUSDC')).not.toThrow();
  });

  it('validateAgainstCapabilities rejects unsupported chain', async () => {
    const v = new OneShotBundleValidator();
    const fetchCaps = async () => ({
      chains: [
        {
          chainId: '8453',
          feeCollector: '0xFC',
          targetAddress: '0xTA',
          tokens: [{ address: '0xUSDC', decimals: 6, symbol: 'USDC' }],
        },
      ],
    });
    try {
      await v.validateAgainstCapabilities(
        VALID_BUNDLE,
        { chainId: 1, paymentTokenAddress: '0xUSDC' },
        fetchCaps,
      );
      expect.unreachable();
    } catch (err) {
      expect((err as { code: string }).code).toBe(ErrorCode.ONESHOT_CAPABILITY_UNSUPPORTED);
    }
  });

  it('validateAgainstCapabilities rejects token not in capabilities', async () => {
    const v = new OneShotBundleValidator();
    const fetchCaps = async () => ({
      chains: [
        {
          chainId: '8453',
          feeCollector: '0xFC',
          targetAddress: '0xTA',
          tokens: [{ address: '0xOTHER', decimals: 18, symbol: 'OTHER' }],
        },
      ],
    });
    try {
      await v.validateAgainstCapabilities(
        VALID_BUNDLE,
        { chainId: 8453, paymentTokenAddress: '0xUSDC' },
        fetchCaps,
      );
      expect.unreachable();
    } catch (err) {
      expect((err as { code: string }).code).toBe(ErrorCode.ONESHOT_PAYMENT_TOKEN_UNSUPPORTED);
    }
  });

  it('validateAgainstCapabilities accepts a matching chain+token', async () => {
    const v = new OneShotBundleValidator();
    const fetchCaps = async () => ({
      chains: [
        {
          chainId: '8453',
          feeCollector: '0xFC',
          targetAddress: '0xTA',
          tokens: [{ address: '0xUSDC', decimals: 6, symbol: 'USDC' }],
        },
      ],
    });
    await expect(
      v.validateAgainstCapabilities(
        VALID_BUNDLE,
        { chainId: 8453, paymentTokenAddress: '0xUSDC' },
        fetchCaps,
      ),
    ).resolves.toBeUndefined();
  });

  it('parsePermissionContextString parses a JSON array, returns [] otherwise', () => {
    const v = new OneShotBundleValidator();
    expect(v.parsePermissionContextString('')).toEqual([]);
    expect(v.parsePermissionContextString('0xabcd')).toEqual([]);
    expect(v.parsePermissionContextString('not-json')).toEqual([]);
    const arr = v.parsePermissionContextString(JSON.stringify([VALID_DELEGATION]));
    expect(arr).toHaveLength(1);
    expect(arr[0]?.delegate).toBe(VALID_DELEGATION.delegate);
  });
});
