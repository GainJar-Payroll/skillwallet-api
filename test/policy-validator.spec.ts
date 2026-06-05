import { describe, it, expect } from 'bun:test';
import {
  PolicyValidatorService,
  type PolicyCheckInput,
} from '../src/runtime/policy/policy-validator.service';
import type { PermissionManifestDoc } from '../src/common/permissions/permission-manifest.schema';

const USER = ('0x' + '11'.repeat(20)) as `0x${string}`;
const TARGET = ('0x' + '22'.repeat(20)) as `0x${string}`;
const APPROVED = ('0x' + '33'.repeat(20)) as `0x${string}`;
const DENIED = ('0x' + '44'.repeat(20)) as `0x${string}`;
const BURN = '0x0000000000000000000000000000000000000000' as `0x${string}`;

const APPROVED_SELECTOR = '0xaabbccdd' as `0x${string}`;
const DENIED_SELECTOR = '0xdeadbeef' as `0x${string}`;

function makeManifest(
  rules: PermissionManifestDoc['rules'] = [],
  status: PermissionManifestDoc['status'] = 'active',
): PermissionManifestDoc {
  return {
    manifestId: 'manifest_1',
    installationId: 'inst_1',
    version: 'v1',
    status,
    rules,
  } as unknown as PermissionManifestDoc;
}

function makeInput(overrides: Partial<PolicyCheckInput> = {}): PolicyCheckInput {
  return {
    chainId: 8453,
    userAddress: USER,
    manifest: null,
    execution: {
      description: 'test execution',
      actions: [
        {
          target: APPROVED,
          value: '0x0',
          callData: `${APPROVED_SELECTOR}00`,
        },
      ],
    },
    ...overrides,
  };
}

describe('PolicyValidatorService.evaluate', () => {
  const validator = new PolicyValidatorService();

  describe('structural checks', () => {
    it('rejects empty action list', () => {
      const verdict = validator.evaluate(
        makeInput({ execution: { description: 'x', actions: [] } }),
      );
      expect(verdict.allowed).toBe(false);
      expect(verdict.blockedBy).toBe('no-actions');
    });

    it('rejects malformed target address', () => {
      const verdict = validator.evaluate(
        makeInput({
          execution: {
            description: 'x',
            actions: [{ target: 'not-an-address', value: '0x0', callData: '0x12345678' }],
          },
        }),
      );
      expect(verdict.allowed).toBe(false);
      expect(verdict.blockedBy).toBe('bad-target');
    });

    it('rejects non-zero value transfers (no native value in MVP)', () => {
      const verdict = validator.evaluate(
        makeInput({
          execution: {
            description: 'x',
            actions: [{ target: APPROVED, value: '0x1', callData: '0x12345678' }],
          },
        }),
      );
      expect(verdict.allowed).toBe(false);
      expect(verdict.blockedBy).toBe('no-native-value');
    });

    it('passes structural check when no manifest is attached', () => {
      const verdict = validator.evaluate(makeInput());
      expect(verdict.allowed).toBe(true);
    });
  });

  describe('allow-target', () => {
    const manifest = makeManifest([
      {
        id: 'r-allow',
        enforcement: 'allow-target',
        source: 'backend-policy',
        value: { targets: [APPROVED] },
        description: 'only allow approved target',
      },
    ]);

    it('allows when target is in allowlist', () => {
      const verdict = validator.evaluate(makeInput({ manifest }));
      expect(verdict.allowed).toBe(true);
    });

    it('blocks when target is not in allowlist', () => {
      const verdict = validator.evaluate(
        makeInput({
          manifest,
          execution: {
            description: 'x',
            actions: [{ target: DENIED, value: '0x0', callData: '0x12345678' }],
          },
        }),
      );
      expect(verdict.allowed).toBe(false);
      expect(verdict.blockedBy).toBe('r-allow');
      expect(verdict.reason).toContain(DENIED);
    });
  });

  describe('deny-target', () => {
    const manifest = makeManifest([
      {
        id: 'r-deny',
        enforcement: 'deny-target',
        source: 'backend-policy',
        value: { targets: [BURN] },
        description: 'never call burn address',
      },
    ]);

    it('allows when target is not in denylist', () => {
      const verdict = validator.evaluate(makeInput({ manifest }));
      expect(verdict.allowed).toBe(true);
    });

    it('blocks when target is in denylist', () => {
      const verdict = validator.evaluate(
        makeInput({
          manifest,
          execution: {
            description: 'x',
            actions: [{ target: BURN, value: '0x0', callData: '0x12345678' }],
          },
        }),
      );
      expect(verdict.allowed).toBe(false);
      expect(verdict.blockedBy).toBe('r-deny');
    });
  });

  describe('deny-selector', () => {
    const manifest = makeManifest([
      {
        id: 'r-selector',
        enforcement: 'deny-selector',
        source: 'backend-policy',
        value: { selectors: [DENIED_SELECTOR] },
        description: 'never call deadbeef selector',
      },
    ]);

    it('allows when selector is not in denylist', () => {
      const verdict = validator.evaluate(makeInput({ manifest }));
      expect(verdict.allowed).toBe(true);
    });

    it('blocks when selector is in denylist', () => {
      const verdict = validator.evaluate(
        makeInput({
          manifest,
          execution: {
            description: 'x',
            actions: [{ target: APPROVED, value: '0x0', callData: `${DENIED_SELECTOR}00` }],
          },
        }),
      );
      expect(verdict.allowed).toBe(false);
      expect(verdict.blockedBy).toBe('r-selector');
    });
  });

  describe('manifest status', () => {
    it('blocks when manifest status is rejected', () => {
      const manifest = makeManifest([], 'rejected');
      const verdict = validator.evaluate(makeInput({ manifest }));
      expect(verdict.allowed).toBe(false);
      expect(verdict.blockedBy).toBe('manifest.rejected');
    });

    it('blocks when manifest status is expired', () => {
      const manifest = makeManifest([], 'expired');
      const verdict = validator.evaluate(makeInput({ manifest }));
      expect(verdict.allowed).toBe(false);
      expect(verdict.blockedBy).toBe('manifest.expired');
    });
  });

  describe('rule composition', () => {
    it('returns first failing rule when multiple rules are present', () => {
      const manifest = makeManifest([
        {
          id: 'r1',
          enforcement: 'allow-target',
          source: 'backend-policy',
          value: { targets: [APPROVED] },
          description: '',
        },
        {
          id: 'r2',
          enforcement: 'deny-selector',
          source: 'backend-policy',
          value: { selectors: [APPROVED_SELECTOR] },
          description: '',
        },
      ]);
      const verdict = validator.evaluate(makeInput({ manifest }));
      expect(verdict.allowed).toBe(false);
      expect(verdict.blockedBy).toBe('r2');
    });

    it('passes when all rules pass', () => {
      const manifest = makeManifest([
        {
          id: 'r1',
          enforcement: 'allow-target',
          source: 'backend-policy',
          value: { targets: [APPROVED] },
          description: '',
        },
        {
          id: 'r2',
          enforcement: 'deny-selector',
          source: 'backend-policy',
          value: { selectors: [DENIED_SELECTOR] },
          description: '',
        },
        {
          id: 'r3',
          enforcement: 'erc20-periodic-spend',
          source: 'backend-policy',
          value: {},
          description: '',
        },
      ]);
      const verdict = validator.evaluate(makeInput({ manifest }));
      expect(verdict.allowed).toBe(true);
    });
  });

  describe('unknown rule enforcement', () => {
    it('throws POLICY_RULE_UNKNOWN for an unknown enforcement', () => {
      const manifest = makeManifest([
        {
          id: 'r-bad',
          // @ts-expect-error: intentionally unknown enforcement
          enforcement: 'this-does-not-exist',
          source: 'backend-policy',
          value: {},
          description: '',
        },
      ]);
      expect(() => validator.evaluate(makeInput({ manifest }))).toThrow();
    });
  });

  describe('multi-action execution', () => {
    it('passes when every action in a multi-action execution passes', () => {
      const verdict = validator.evaluate(
        makeInput({
          execution: {
            description: 'swap',
            actions: [
              { target: TARGET, value: '0x0', callData: `${APPROVED_SELECTOR}00` },
              { target: APPROVED, value: '0x0', callData: `${APPROVED_SELECTOR}00` },
            ],
          },
        }),
      );
      expect(verdict.allowed).toBe(true);
    });

    it('blocks when any action in a multi-action execution fails structural check', () => {
      const verdict = validator.evaluate(
        makeInput({
          execution: {
            description: 'swap',
            actions: [
              { target: APPROVED, value: '0x0', callData: `${APPROVED_SELECTOR}00` },
              { target: '0xnope', value: '0x0', callData: `${APPROVED_SELECTOR}00` },
            ],
          },
        }),
      );
      expect(verdict.allowed).toBe(false);
      expect(verdict.blockedBy).toBe('bad-target');
    });
  });
});
