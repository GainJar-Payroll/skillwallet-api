import { describe, it, expect } from 'bun:test';
import { PermissionsService } from '../src/permissions/permissions.service';

const SMART_ACCOUNT = '0x2222222222222222222222222222222222222222';
const EXECUTOR = '0x3333333333333333333333333333333333333333';
const DELEGATION_MANAGER = '0xdb9B1e94B5b69Df7e401DDbedE43491141047dB3';

function makeService(opts: { installation: unknown; skill: unknown; executor: unknown }) {
  const installationModel = {
    findOne: async () => opts.installation,
    updateOne: async () => ({ modifiedCount: 1 }),
  };
  const skillModel = {
    findOne: () => ({ lean: () => Promise.resolve(opts.skill) }),
  };
  const executorModel = {
    findOne: () => ({ lean: () => Promise.resolve(opts.executor) }),
  };
  const installations = { findById: async () => opts.installation } as never;
  const compiler = {
    compileDca: () => ({ manifest: {}, walletRequest: { rawRequest: {} } }),
  } as never;
  const supportChecker = { checkSupport: async () => ({}) } as never;
  return new PermissionsService(
    { create: async () => ({}) } as never,
    { create: async () => ({}) } as never,
    { create: async () => ({ toObject: () => ({}) }) } as never,
    { create: async () => ({ toObject: () => ({}) }) } as never,
    installationModel as never,
    skillModel as never,
    executorModel as never,
    compiler,
    supportChecker,
    installations,
  );
}

function baseInstallation() {
  return {
    installationId: 'inst_test',
    chainId: 11155111,
    smartAccountAddress: SMART_ACCOUNT,
    smartAccountAddressNormalized: SMART_ACCOUNT.toLowerCase(),
    executorAddressNormalized: EXECUTOR.toLowerCase(),
    status: 'pending_permission',
    walletPermissionRequest: {
      requestId: 'req_test',
      rawRequest: {
        permission: {
          type: 'erc20-token-periodic',
          isAdjustmentAllowed: false,
          data: {
            tokenAddress: '0x4200000000000000000000000000000000000042',
            periodAmount: '10000000',
            periodDuration: 604800,
            startTime: 1700000000,
          },
        },
      },
    },
  };
}

async function expectThrows(fn: () => Promise<unknown>, pattern: RegExp): Promise<string> {
  let err: Error | null = null;
  try {
    await fn();
  } catch (e) {
    err = e as Error;
  }
  expect(err).not.toBeNull();
  if (!pattern.test((err as Error).message)) {
    throw new Error(`expected match ${pattern}, got: ${(err as Error).message}`);
  }
  return (err as Error).message;
}

describe('PermissionsService attenuation check', () => {
  it('rejects response that broadens periodAmount beyond requested', async () => {
    const installation = baseInstallation();
    const svc = makeService({
      installation,
      skill: {
        skillId: 'dca-usdc-weth',
        status: 'live',
        supportedChains: [11155111],
        adapter: 'dca',
      },
      executor: { chainId: 11155111, status: 'active', executorAddress: EXECUTOR },
    });
    const msg = await expectThrows(
      () =>
        svc.submitGrant({
          installationId: 'inst_test',
          permissionResponses: [
            {
              chainId: 11155111,
              from: SMART_ACCOUNT,
              permission: {
                type: 'erc20-token-periodic',
                isAdjustmentAllowed: false,
                data: {
                  tokenAddress: '0x4200000000000000000000000000000000000042',
                  periodAmount: '99999999',
                  periodDuration: 604800,
                  startTime: 1700000000,
                },
              },
              context: '0xdeadbeef',
              delegationManager: DELEGATION_MANAGER,
            },
          ],
        }),
      /exceeds requested/,
    );
    expect(msg).toContain('99999999');
  });

  it('rejects response with isAdjustmentAllowed=true', async () => {
    const installation = baseInstallation();
    const svc = makeService({
      installation,
      skill: {
        skillId: 'dca-usdc-weth',
        status: 'live',
        supportedChains: [11155111],
        adapter: 'dca',
      },
      executor: { chainId: 11155111, status: 'active', executorAddress: EXECUTOR },
    });
    await expectThrows(
      () =>
        svc.submitGrant({
          installationId: 'inst_test',
          permissionResponses: [
            {
              chainId: 11155111,
              from: SMART_ACCOUNT,
              permission: {
                type: 'erc20-token-periodic',
                isAdjustmentAllowed: true,
                data: { periodAmount: '10000000' },
              },
              context: '0xdeadbeef',
              delegationManager: DELEGATION_MANAGER,
            },
          ],
        }),
      /isAdjustmentAllowed=true/,
    );
  });

  it('rejects response with mismatched chainId', async () => {
    const installation = baseInstallation();
    const svc = makeService({
      installation,
      skill: {
        skillId: 'dca-usdc-weth',
        status: 'live',
        supportedChains: [11155111],
        adapter: 'dca',
      },
      executor: { chainId: 11155111, status: 'active', executorAddress: EXECUTOR },
    });
    await expectThrows(
      () =>
        svc.submitGrant({
          installationId: 'inst_test',
          permissionResponses: [
            {
              chainId: 8453,
              from: SMART_ACCOUNT,
              permission: {
                type: 'erc20-token-periodic',
                isAdjustmentAllowed: false,
                data: { periodAmount: '10000000' },
              },
              context: '0xdeadbeef',
              delegationManager: DELEGATION_MANAGER,
            },
          ],
        }),
      /chainId/,
    );
  });

  it('rejects response with mismatched permission type', async () => {
    const installation = baseInstallation();
    const svc = makeService({
      installation,
      skill: {
        skillId: 'dca-usdc-weth',
        status: 'live',
        supportedChains: [11155111],
        adapter: 'dca',
      },
      executor: { chainId: 11155111, status: 'active', executorAddress: EXECUTOR },
    });
    await expectThrows(
      () =>
        svc.submitGrant({
          installationId: 'inst_test',
          permissionResponses: [
            {
              chainId: 11155111,
              from: SMART_ACCOUNT,
              permission: {
                type: 'native-token-transfer',
                isAdjustmentAllowed: false,
                data: { periodAmount: '10000000' },
              },
              context: '0xdeadbeef',
              delegationManager: DELEGATION_MANAGER,
            },
          ],
        }),
      /does not match requested/,
    );
  });

  it('rejects when installation is in wrong state', async () => {
    const installation = { ...baseInstallation(), status: 'draft' };
    const svc = makeService({
      installation,
      skill: {
        skillId: 'dca-usdc-weth',
        status: 'live',
        supportedChains: [11155111],
        adapter: 'dca',
      },
      executor: { chainId: 11155111, status: 'active', executorAddress: EXECUTOR },
    });
    await expectThrows(
      () =>
        svc.submitGrant({
          installationId: 'inst_test',
          permissionResponses: [
            {
              chainId: 11155111,
              from: SMART_ACCOUNT,
              permission: {
                type: 'erc20-token-periodic',
                isAdjustmentAllowed: false,
                data: { periodAmount: '10000000' },
              },
              context: '0xdeadbeef',
              delegationManager: DELEGATION_MANAGER,
            },
          ],
        }),
      /not awaiting permission grant/,
    );
  });
});

describe('PermissionsService prepareRequest projection (ERC-7715 to field)', () => {
  const USER = '0x1111111111111111111111111111111111111111';

  function makePrepareService(opts: {
    skill: unknown;
    executor: unknown;
    compilerOutput: unknown;
  }) {
    const installationModel = {
      findOne: async () => null,
      updateOne: async () => ({ modifiedCount: 0 }),
    };
    const skillModel = {
      findOne: () => ({ lean: () => Promise.resolve(opts.skill) }),
    };
    const executorModel = {
      findOne: () => ({ lean: () => Promise.resolve(opts.executor) }),
    };
    const installations = {
      findById: async () => ({
        installationId: 'inst_test',
        chainId: 11155111,
        status: 'pending_permission',
      }),
      createDraft: async () => ({ installationId: 'inst_test' }),
      setPermissionRequest: async () => undefined,
    } as never;
    const compiler = {
      compileDca: () => opts.compilerOutput,
      compileAerodromeVote: () => opts.compilerOutput,
    } as never;
    const supportChecker = { checkSupport: async () => ({}) } as never;
    return new PermissionsService(
      {
        create: async () => ({
          manifestId: 'manifest_test',
          manifestHash: 'hash_test',
          title: 'T',
          summary: 'S',
          allowedActions: [],
          forbiddenActions: [],
          allowedTargets: [],
          allowedSelectors: [],
          allowedTokens: [],
          rules: [],
          validUntil: new Date(Date.now() + 7 * 86400_000),
          toObject: () => ({
            manifestId: 'manifest_test',
            manifestHash: 'hash_test',
            title: 'T',
            summary: 'S',
            allowedActions: [],
            forbiddenActions: [],
            allowedTargets: [],
            allowedSelectors: [],
            allowedTokens: [],
            rules: [],
            validUntil: new Date(Date.now() + 7 * 86400_000),
          }),
        }),
      } as never,
      {
        create: async () => ({
          requestId: 'req_test',
          toObject: () => ({ requestId: 'req_test' }),
        }),
      } as never,
      { create: async () => ({ toObject: () => ({}) }) } as never,
      { create: async () => ({ toObject: () => ({}) }) } as never,
      installationModel as never,
      skillModel as never,
      executorModel as never,
      compiler,
      supportChecker,
      installations,
    );
  }

  it('projects `to: executorAddress` and `from: smartAccountAddress` in permissionRequests[0]', async () => {
    const svc = makePrepareService({
      skill: {
        skillId: 'dca-usdc-weth',
        status: 'live',
        supportedChains: [11155111],
        adapter: 'dca',
      },
      executor: { chainId: 11155111, status: 'active', executorAddress: EXECUTOR },
      compilerOutput: {
        manifest: {},
        manifestHash: 'hash',
        walletRequest: {
          rawRequest: {
            permission: {
              type: 'erc20-token-periodic',
              isAdjustmentAllowed: false,
              data: { periodAmount: '10000000' },
            },
            rules: [{ type: 'expiry', data: {} }],
          },
        },
        requestHash: 'reqhash',
      },
    });
    const result = await svc.prepareRequest({
      userAddress: USER,
      smartAccountAddress: SMART_ACCOUNT,
      chainId: 11155111,
      skillId: 'dca-usdc-weth',
      config: {
        type: 'dca',
        tokenIn: {
          symbol: 'USDC',
          address: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
          decimals: 6,
        },
        tokenOut: {
          symbol: 'WETH',
          address: '0xfFf9976782d46CC05630D1F6eBAb18b2324d6B14',
          decimals: 18,
        },
        amountPerRun: '10',
        frequency: 'weekly',
        maxSlippageBps: 50,
        router: { name: 'uniswap', address: '0x0000000000000000000000000000000000000001' },
        recipient: SMART_ACCOUNT,
        quoteMode: 'router-quote',
      },
      pricingPlan: { id: 'p1', label: 'L', durationDays: 7, skillFeeUsdc: '1' },
    });
    expect(result.permissionRequests).toHaveLength(1);
    const pr = result.permissionRequests[0]!;
    expect(pr.from).toBe(SMART_ACCOUNT);
    expect(pr.to).toBe(EXECUTOR);
    expect(pr.chainId).toBe('0xaa36a7');
  });
});
