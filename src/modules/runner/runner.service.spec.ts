import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { decodeFunctionData } from 'viem';
import { RunnerService } from './runner.service';
import { SWAP_ROUTER_02_ABI } from './abis';
import { SkillsService } from '../skills/skills.service';
import { InstallationsService } from '../installations/installations.service';
import { OneShotService } from '../oneshot/oneshot.service';
import { X402Service } from '../x402/x402.service';
import { VeniceService } from '../venice/venice.service';
import { getChainConfig } from '../../config/chains.config';
import {
  buildInstallation,
  buildMockExecutorService,
  buildSkill,
  TEST_EXECUTOR,
} from '../../../test/helpers';

describe('RunnerService', () => {
  let service: RunnerService;
  let skills: { findById: jest.Mock };
  let installations: {
    findById: jest.Mock;
    appendExecution: jest.Mock;
    updateLastExecution: jest.Mock;
  };
  let oneShot: { getCapabilities: jest.Mock; send7710Transaction: jest.Mock; poll: jest.Mock };
  let x402: { fetch: jest.Mock };
  let venice: { summariseMarketContext: jest.Mock };
  let config: { get: jest.Mock };

  const chainConfig = getChainConfig(84532);
  const FEE_COLLECTOR = '0x90F79bf6EB2c4f870365E785982E1f101E93b906' as `0x${string}`;

  beforeEach(async () => {
    skills = { findById: jest.fn() };
    installations = {
      findById: jest.fn(),
      appendExecution: jest.fn(),
      updateLastExecution: jest.fn(),
    };
    oneShot = {
      getCapabilities: jest.fn().mockResolvedValue({
        '84532': { feeCollector: FEE_COLLECTOR },
      }),
      send7710Transaction: jest.fn().mockResolvedValue('0x' + 'aa'.repeat(32)),
      poll: jest.fn().mockResolvedValue({ status: 200, hash: '0xH' }),
    };
    x402 = { fetch: jest.fn().mockResolvedValue({ headlines: 'BTC up' }) };
    venice = { summariseMarketContext: jest.fn().mockResolvedValue('AI summary') };
    config = { get: jest.fn().mockReturnValue('https://news.test/feed') };

    const mod = await Test.createTestingModule({
      providers: [
        RunnerService,
        { provide: ConfigService, useValue: config },
        { provide: SkillsService, useValue: skills },
        { provide: InstallationsService, useValue: installations },
        { provide: OneShotService, useValue: oneShot },
        { provide: X402Service, useValue: x402 },
        { provide: VeniceService, useValue: venice },
      ],
    }).compile();
    service = mod.get(RunnerService);
  });

  describe('buildFeeTransfer', () => {
    it('encodes USDC.transfer(feeCollector, 10000n)', () => {
      const out = service.buildFeeTransfer(chainConfig, FEE_COLLECTOR);
      expect(out.target).toBe(chainConfig.tokens.usdc);
      expect(out.value).toBe('0');
      expect(out.data).toMatch(/^0x/);
    });
  });

  describe('buildDcaExecutions', () => {
    it('returns approve + swap executions', async () => {
      const out = await service.buildDcaExecutions(
        buildInstallation({ parameters: { amountUsdc: '5000000', outputToken: 'weth' } }),
        chainConfig,
      );
      expect(out.executions).toHaveLength(2);
      expect(out.aiContext).toBe('AI summary');
      expect(out.newsContext).toBe('BTC up');
    });

    it('defaults amountUsdc to 10_000_000 and outputToken to weth', async () => {
      const out = await service.buildDcaExecutions(
        buildInstallation({ parameters: {} }),
        chainConfig,
      );
      expect(out.executions).toHaveLength(2);
    });

    it('handles x402 failure gracefully', async () => {
      x402.fetch.mockRejectedValue(new Error('news down'));
      const out = await service.buildDcaExecutions(
        buildInstallation(),
        chainConfig,
      );
      expect(out.executions).toHaveLength(2);
      expect(out.aiContext).toBe('');
      expect(out.newsContext).toBe('');
    });

    it('uses cbBtc when outputToken=cbBtc', async () => {
      const out = await service.buildDcaExecutions(
        buildInstallation({ parameters: { amountUsdc: '1000', outputToken: 'cbBtc' } }),
        chainConfig,
      );
      const swap = out.executions[1];
      expect(swap.target).toBe(chainConfig.dex.swapRouter02);
      const decoded = decodeFunctionData({ abi: SWAP_ROUTER_02_ABI, data: swap.data });
      const params = (decoded.args as Array<{ tokenOut: string }>)[0];
      expect(params.tokenOut.toLowerCase()).toBe(chainConfig.tokens.cbBtc.toLowerCase());
    });
  });

  describe('buildGmExecutions', () => {
    it('returns single gm() call to gmContract', async () => {
      const out = await service.buildGmExecutions(buildInstallation(), chainConfig);
      expect(out).toHaveLength(1);
      expect(out[0].target).toBe(chainConfig.skillContracts.gmContract);
    });
  });

  describe('executeInstallation', () => {
    it('skips non-active installations', async () => {
      installations.findById.mockResolvedValue(buildInstallation({ status: 'paused' }));
      await service.executeInstallation('id1');
      expect(skills.findById).not.toHaveBeenCalled();
    });

    it('runs DCA path successfully', async () => {
      const inst = buildInstallation();
      installations.findById.mockResolvedValue(inst);
      skills.findById.mockResolvedValue(buildSkill());
      await service.executeInstallation(String(inst._id));
      expect(oneShot.send7710Transaction).toHaveBeenCalled();
      expect(installations.appendExecution).toHaveBeenCalled();
    });

    it('runs GM path successfully', async () => {
      const inst = buildInstallation();
      installations.findById.mockResolvedValue(inst);
      skills.findById.mockResolvedValue(buildSkill({ name: 'GM Everyday' }));
      await service.executeInstallation(String(inst._id));
      expect(oneShot.send7710Transaction).toHaveBeenCalled();
    });

    it('throws on unknown skill', async () => {
      const inst = buildInstallation();
      installations.findById.mockResolvedValue(inst);
      skills.findById.mockResolvedValue(buildSkill({ name: 'Weird' }));
      await expect(service.executeInstallation(String(inst._id))).rejects.toThrow(
        /Unknown skill/,
      );
    });

    it('throws when 1Shot does not support chain', async () => {
      const inst = buildInstallation();
      installations.findById.mockResolvedValue(inst);
      skills.findById.mockResolvedValue(buildSkill());
      oneShot.getCapabilities.mockResolvedValue({ '84532': {} });
      await expect(service.executeInstallation(String(inst._id))).rejects.toThrow(
        /1Shot does not support/,
      );
    });

    it('records failure when send7710 throws', async () => {
      const inst = buildInstallation();
      installations.findById.mockResolvedValue(inst);
      skills.findById.mockResolvedValue(buildSkill());
      oneShot.send7710Transaction.mockRejectedValue(new Error('relayer down'));
      await service.executeInstallation(String(inst._id));
      expect(installations.appendExecution).toHaveBeenCalledWith(
        String(inst._id),
        expect.objectContaining({ status: 'failed', errorMessage: 'relayer down' }),
      );
    });
  });
});
