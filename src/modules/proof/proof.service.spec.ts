import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ServiceUnavailableException } from '@nestjs/common';
import { ProofService } from './proof.service';
import { SkillsService } from '../skills/skills.service';
import { DelegationService } from '../delegation/delegation.service';
import { OneShotService } from '../oneshot/oneshot.service';
import { X402Service } from '../x402/x402.service';
import { VeniceService } from '../venice/venice.service';
import { RunnerService } from '../runner/runner.service';
import { ExecutorService } from '../executor/executor.service';
import {
  buildMockExecutorService,
  buildSkill,
  TEST_DELEGATOR_PK,
  TEST_USER,
} from '../../../test/helpers';

jest.mock('@metamask/smart-accounts-kit', () => ({
  toMetaMaskSmartAccount: jest.fn().mockResolvedValue({
    signDelegation: jest.fn().mockImplementation(async ({ delegation }: { delegation: unknown }) => ({
      ...(delegation as Record<string, unknown>),
      signature: '0x' + '33'.repeat(65),
    })),
  }),
  Implementation: { Stateless7702: '0x7702' },
  getSmartAccountsEnvironment: jest.fn().mockReturnValue({}),
  ScopeType: { Erc20PeriodTransfer: 'Erc20PeriodTransfer' },
}));

jest.mock('viem/accounts', () => {
  const actual = jest.requireActual('viem/accounts');
  return {
    ...actual,
    privateKeyToAccount: actual.privateKeyToAccount,
  };
});

describe('ProofService', () => {
  let service: ProofService;
  let skills: { findAll: jest.Mock };
  let delegation: { generateSalt: jest.Mock; prepare: jest.Mock };
  let oneShot: { getCapabilities: jest.Mock; send7710Transaction: jest.Mock; poll: jest.Mock };
  let x402: { fetch: jest.Mock };
  let venice: { summariseMarketContext: jest.Mock };
  let runner: { buildDcaExecutions: jest.Mock; buildGmExecutions: jest.Mock; buildFeeTransfer: jest.Mock };
  let config: { get: jest.Mock };

  beforeEach(async () => {
    skills = { findAll: jest.fn() };
    delegation = {
      generateSalt: jest.fn().mockReturnValue('0x' + '11'.repeat(32)),
      prepare: jest.fn().mockReturnValue({ salt: '0x' + '11'.repeat(32) }),
    };
    oneShot = {
      getCapabilities: jest.fn().mockResolvedValue({ '84532': { feeCollector: '0xFee' } }),
      send7710Transaction: jest.fn().mockResolvedValue('0x' + 'ab'.repeat(32)),
      poll: jest.fn().mockResolvedValue({ status: 200, hash: '0xH' }),
    };
    x402 = { fetch: jest.fn().mockResolvedValue({ headlines: 'X' }) };
    venice = { summariseMarketContext: jest.fn().mockResolvedValue('ctx') };
    runner = {
      buildDcaExecutions: jest.fn().mockResolvedValue({
        executions: [{ target: '0xT', value: '0', data: '0x' }],
        aiContext: 'ctx',
        newsContext: 'X',
      }),
      buildGmExecutions: jest.fn().mockResolvedValue([
        { target: '0xGM', value: '0', data: '0x' },
      ]),
      buildFeeTransfer: jest.fn().mockReturnValue({
        target: '0xUSDC',
        value: '0',
        data: '0x',
      }),
    };
    config = {
      get: jest.fn().mockImplementation((k: string) => {
        const map: Record<string, unknown> = {
          proofDelegatorPrivateKey: TEST_DELEGATOR_PK,
          defaultChainId: 84532,
          ottoAiNewsUrl: 'https://news.test',
        };
        return map[k];
      }),
    };

    const mod = await Test.createTestingModule({
      providers: [
        ProofService,
        { provide: ConfigService, useValue: config },
        { provide: ExecutorService, useValue: buildMockExecutorService() },
        { provide: SkillsService, useValue: skills },
        { provide: DelegationService, useValue: delegation },
        { provide: OneShotService, useValue: oneShot },
        { provide: X402Service, useValue: x402 },
        { provide: VeniceService, useValue: venice },
        { provide: RunnerService, useValue: runner },
      ],
    }).compile();
    service = mod.get(ProofService);
  });

  it('throws when PROOF_DELEGATOR_PRIVATE_KEY missing', async () => {
    config.get.mockImplementation((k: string) => {
      if (k === 'defaultChainId') return 84532;
      return undefined;
    });
    const mod = await Test.createTestingModule({
      providers: [
        ProofService,
        { provide: ConfigService, useValue: config },
        { provide: ExecutorService, useValue: buildMockExecutorService() },
        { provide: SkillsService, useValue: skills },
        { provide: DelegationService, useValue: delegation },
        { provide: OneShotService, useValue: oneShot },
        { provide: X402Service, useValue: x402 },
        { provide: VeniceService, useValue: venice },
        { provide: RunnerService, useValue: runner },
      ],
    }).compile();
    const s = mod.get(ProofService);
    await expect(s.runProof()).rejects.toThrow(ServiceUnavailableException);
  });

  it('throws when no skill available', async () => {
    skills.findAll.mockResolvedValue([]);
    await expect(service.runProof()).rejects.toThrow(ServiceUnavailableException);
  });

  it('runs full proof flow for DCA Daily', async () => {
    skills.findAll.mockResolvedValue([buildSkill({ name: 'DCA Daily', chainId: 84532 })]);
    const out = await service.runProof();
    expect(out.skillName).toBe('DCA Daily');
    expect(out.oneShotTaskId).toBeDefined();
    expect(out.finalStatus.status).toBe(200);
  });

  it('runs proof flow for GM Everyday', async () => {
    skills.findAll.mockResolvedValue([buildSkill({ name: 'GM Everyday', chainId: 84532, delegationScope: { type: 'CustomScope' } as never })]);
    const out = await service.runProof();
    expect(out.skillName).toBe('GM Everyday');
  });

  it('falls back to first chain skill when DCA missing', async () => {
    skills.findAll.mockResolvedValue([buildSkill({ name: 'Other', chainId: 84532, delegationScope: { type: 'X' } as never })]);
    const out = await service.runProof();
    expect(out.skillName).toBe('Other');
  });

  it('continues proof when x402 enrichment fails (DCA path)', async () => {
    skills.findAll.mockResolvedValue([buildSkill({ name: 'DCA Daily', chainId: 84532 })]);
    x402.fetch.mockRejectedValue(new Error('news dead'));
    const out = await service.runProof();
    expect(out.aiContext).toBeUndefined();
  });

  it('throws when 1Shot does not support chain', async () => {
    skills.findAll.mockResolvedValue([buildSkill({ name: 'DCA Daily', chainId: 84532 })]);
    oneShot.getCapabilities.mockResolvedValue({ '84532': {} });
    await expect(service.runProof()).rejects.toThrow(ServiceUnavailableException);
  });

  it('uses defaultChainId from config', async () => {
    skills.findAll.mockResolvedValue([buildSkill({ name: 'DCA Daily', chainId: 84532 })]);
    const out = await service.runProof();
    expect(out.chainId).toBe(84532);
  });
});
