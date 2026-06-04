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

  it('produces a stable checkId for identical inputs', async () => {
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
    expect(a.checkId).toBe(b.checkId);
  });
});
