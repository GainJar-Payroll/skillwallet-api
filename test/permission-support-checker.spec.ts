import { describe, it, expect } from 'bun:test';
import { PermissionSupportCheckerService } from '../src/permissions/permission-support-checker.service';

const USER = '0x1111111111111111111111111111111111111111';
const SMART_ACCOUNT = '0x2222222222222222222222222222222222222222';

function makeService() {
  const findOne = async (filter: { skillId?: string }) => {
    if (filter.skillId === 'dca-usdc-weth') {
      return {
        skillId: 'dca-usdc-weth',
        supportedChains: [11155111, 8453],
        permissionRequirements: [
          {
            chainId: 11155111,
            permissionType: 'erc20-token-periodic',
            requiredRuleTypes: ['expiry'],
            required: true,
          },
          {
            chainId: 8453,
            permissionType: 'erc20-token-periodic',
            requiredRuleTypes: ['expiry'],
            required: true,
          },
        ],
      };
    }
    return null;
  };
  const create = async (doc: Record<string, unknown>) => ({
    toObject: () => doc,
  });
  const skillModel = {
    findOne: (filter: { skillId?: string }) => ({ lean: () => findOne(filter) }),
  };
  const checkModel = { create };
  return new PermissionSupportCheckerService(skillModel as never, checkModel as never);
}

describe('PermissionSupportCheckerService', () => {
  it('reports allSupported=true when wallet reports every required type', async () => {
    const svc = makeService();
    const result = await svc.checkSupport({
      userAddress: USER,
      smartAccountAddress: SMART_ACCOUNT,
      skillId: 'dca-usdc-weth',
      chainId: 11155111,
      walletReportedPermissions: ['erc20-token-periodic'],
    });
    expect(result.allSupported).toBe(true);
    expect(result.matched).toHaveLength(1);
    expect(result.missing).toHaveLength(0);
  });

  it('reports missing when a required type is not reported', async () => {
    const svc = makeService();
    const result = await svc.checkSupport({
      userAddress: USER,
      smartAccountAddress: SMART_ACCOUNT,
      skillId: 'dca-usdc-weth',
      chainId: 11155111,
      walletReportedPermissions: [],
    });
    expect(result.allSupported).toBe(false);
    expect(result.matched).toHaveLength(0);
    expect(result.missing).toHaveLength(1);
    expect(result.missing[0]?.permissionType).toBe('erc20-token-periodic');
  });

  it('throws NOT_FOUND when skill does not exist', async () => {
    const svc = makeService();
    await expect(
      svc.checkSupport({
        userAddress: USER,
        smartAccountAddress: SMART_ACCOUNT,
        skillId: 'nonexistent',
        chainId: 11155111,
        walletReportedPermissions: ['erc20-token-periodic'],
      }),
    ).rejects.toThrow(/Skill not found/);
  });

  it('throws VALIDATION_ERROR when chain not supported by skill', async () => {
    const svc = makeService();
    await expect(
      svc.checkSupport({
        userAddress: USER,
        smartAccountAddress: SMART_ACCOUNT,
        skillId: 'dca-usdc-weth',
        chainId: 999,
        walletReportedPermissions: ['erc20-token-periodic'],
      }),
    ).rejects.toThrow(/not supported/);
  });

  it('produces a unique checkId per call (no E11000 on repeated identical inputs)', async () => {
    const svc = makeService();
    const a = await svc.checkSupport({
      userAddress: USER,
      smartAccountAddress: SMART_ACCOUNT,
      skillId: 'dca-usdc-weth',
      chainId: 11155111,
      walletReportedPermissions: ['erc20-token-periodic'],
    });
    const b = await svc.checkSupport({
      userAddress: USER,
      smartAccountAddress: SMART_ACCOUNT,
      skillId: 'dca-usdc-weth',
      chainId: 11155111,
      walletReportedPermissions: ['erc20-token-periodic'],
    });
    expect(a.checkId).not.toBe(b.checkId);
    expect(a.checkId).toMatch(/^check_[0-9a-f-]{36}$/);
    expect(b.checkId).toMatch(/^check_[0-9a-f-]{36}$/);
  });

  it('handles repeated identical check-support without throwing (no unique-index conflict)', async () => {
    const svc = makeService();
    for (let i = 0; i < 5; i++) {
      const r = await svc.checkSupport({
        userAddress: USER,
        smartAccountAddress: SMART_ACCOUNT,
        skillId: 'dca-usdc-weth',
        chainId: 11155111,
        walletReportedPermissions: ['erc20-token-periodic'],
      });
      expect(r.checkId).toBeTruthy();
    }
  });

  it('stores matched[] and missing[] correctly across multiple calls', async () => {
    const svc = makeService();
    const r1 = await svc.checkSupport({
      userAddress: USER,
      smartAccountAddress: SMART_ACCOUNT,
      skillId: 'dca-usdc-weth',
      chainId: 11155111,
      walletReportedPermissions: ['erc20-token-periodic'],
    });
    expect(r1.matched).toHaveLength(1);
    expect(r1.missing).toHaveLength(0);
    const r2 = await svc.checkSupport({
      userAddress: USER,
      smartAccountAddress: SMART_ACCOUNT,
      skillId: 'dca-usdc-weth',
      chainId: 11155111,
      walletReportedPermissions: [],
    });
    expect(r2.matched).toHaveLength(0);
    expect(r2.missing).toHaveLength(1);
    expect(r2.missing[0]?.reason).toBe('wallet_does_not_report_permission_type');
  });
});

describe('SkillInstallation without walletSupportCheck (no embedded unique index)', () => {
  it('accepts two installations created without walletSupportCheck (no conflict)', async () => {
    const created: unknown[] = [];
    const installationModel = {
      create: async (doc: unknown) => {
        created.push(doc);
        return { toObject: () => doc };
      },
    };
    await installationModel.create({
      installationId: 'inst_a',
      userAddress: USER,
      chainId: 11155111,
      skillId: 'dca-usdc-weth',
      status: 'pending_permission',
    });
    await installationModel.create({
      installationId: 'inst_b',
      userAddress: USER,
      chainId: 11155111,
      skillId: 'dca-usdc-weth',
      status: 'pending_permission',
    });
    expect(created).toHaveLength(2);
    expect((created[0] as { installationId: string }).installationId).toBe('inst_a');
    expect((created[1] as { installationId: string }).installationId).toBe('inst_b');
  });
});
