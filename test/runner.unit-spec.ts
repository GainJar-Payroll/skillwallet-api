import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { RunnerService } from '../src/modules/runner/runner.service';
import { SkillsService } from '../src/modules/skills/skills.service';
import { InstallationsService } from '../src/modules/installations/installations.service';
import { OneShotService } from '../src/modules/oneshot/oneshot.service';
import { SponsorService } from '../src/modules/sponsor/sponsor.service';
import { SpendReservationsService } from '../src/modules/spend-reservations/spend-reservations.service';
import { buildMockConfig, buildMockSkillModel, buildMockInstallationModel, TEST_SMART_ACCOUNT, TEST_USER } from './helpers';

describe('RunnerService', () => {
  let runner: RunnerService;
  let installations: ReturnType<typeof buildMockInstallationModel>;
  let skills: ReturnType<typeof buildMockSkillModel>;

  beforeEach(async () => {
    installations = buildMockInstallationModel();
    skills = buildMockSkillModel();

    const mod = await Test.createTestingModule({
      providers: [
        RunnerService,
        { provide: ConfigService, useValue: buildMockConfig({ rpc: { 84532: 'https://rpc.example.com' } }) },
        { provide: SkillsService, useValue: skills },
        { provide: InstallationsService, useValue: installations },
        {
          provide: OneShotService,
          useValue: {
            getCapabilities: jest.fn().mockResolvedValue({ '84532': { feeCollector: TEST_USER } }),
            send7710Transaction: jest.fn().mockResolvedValue('0x' + 'ab'.repeat(32)),
            poll: jest.fn().mockResolvedValue({ status: 200, hash: '0xH' }),
          },
        },
        { provide: SponsorService, useValue: { getSponsorContext: jest.fn().mockResolvedValue(null) } },
        { provide: SpendReservationsService, useValue: { releaseReservation: jest.fn() } },
      ],
    }).compile();

    runner = mod.get<RunnerService>(RunnerService);
  });

  describe('deploy-status guard', () => {
    it('should skip execution when smart account is undeployed in manual-delegation mode', async () => {
      const installation = installations.__seed({
        _id: undefined,
        userAddress: TEST_USER,
        smartAccountAddress: TEST_SMART_ACCOUNT,
        skillId: 'custom-cron-dca-84532',
        signedDelegation: {
          delegate: '0x' + '11'.repeat(20),
          delegator: TEST_SMART_ACCOUNT,
          salt: '0x' + '22'.repeat(32),
          signature: '0x' + '33'.repeat(65),
        },
        delegationSalt: '0x' + '22'.repeat(32),
        chainId: 84532,
        parameters: { amountUsdc: '10000000', outputToken: 'weth' },
        status: 'active',
        mode: 'manual-delegation',
        permissionContext: [],
        executions: [],
      });

      const appendSpy = jest.spyOn(installations, 'appendExecution');

      const result = runner.executeInstallation(installation._id.toString());
      await expect(result).resolves.not.toThrow();

      expect(appendSpy).toHaveBeenCalledWith(
        installation._id.toString(),
        expect.objectContaining({
          status: 'skipped',
          skippedReason: 'needs_smart_account_deployment',
        }),
      );
    });

    it('should not check deployment status for advanced-permission mode', async () => {
      const installation = installations.__seed({
        _id: undefined,
        userAddress: TEST_USER,
        smartAccountAddress: TEST_SMART_ACCOUNT,
        skillId: 'custom-cron-dca-84532',
        signedDelegation: undefined,
        delegationSalt: '0x' + '22'.repeat(32),
        chainId: 84532,
        parameters: { amountUsdc: '10000000', outputToken: 'weth' },
        status: 'active',
        mode: 'advanced-permission',
        permissionContext: [{ type: 'permission', data: '0xabc' }],
        executions: [],
      });

      skills.findById = jest.fn().mockReturnValue({
        lean: () => ({
          exec: jest.fn().mockResolvedValue({
            skillId: 'custom-cron-dca-84532',
            isActive: true,
            parameters: [],
            chainId: 84532,
          }),
        }),
      });

      const appendSpy = jest.spyOn(installations, 'appendExecution');

      await runner.executeInstallation(installation._id.toString());
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(appendSpy).toHaveBeenCalledWith(
        installation._id.toString(),
        expect.objectContaining({
          status: 'submitted',
        }),
      );
    });
  });
});
