import { Test } from '@nestjs/testing';
import { getChainConfig } from '../../config/chains.config';
import { InstallationsService } from '../installations/installations.service';
import { SpendReservationsService } from '../spend-reservations/spend-reservations.service';
import { SkillsService } from '../skills/skills.service';
import { buildInstallation, buildSkill } from '../../../test/helpers';
import { ProcessedEventService } from './processed-event.service';
import { RunnerService } from './runner.service';
import { SkillEventHandlerService } from './skill-event-handler.service';

describe('SkillEventHandlerService', () => {
  let service: SkillEventHandlerService;
  let skills: { findById: jest.Mock };
  let installations: { findActiveBySkillId: jest.Mock; appendExecution: jest.Mock };
  let runner: { executeInstallation: jest.Mock };
  let spendReservations: { reserveDailySpend: jest.Mock };
  let processedEvents: { tryMarkProcessed: jest.Mock };

  beforeEach(async () => {
    skills = { findById: jest.fn() };
    installations = {
      findActiveBySkillId: jest.fn(),
      appendExecution: jest.fn(),
    };
    runner = { executeInstallation: jest.fn() };
    spendReservations = { reserveDailySpend: jest.fn() };
    processedEvents = { tryMarkProcessed: jest.fn().mockResolvedValue(true) };

    const mod = await Test.createTestingModule({
      providers: [
        SkillEventHandlerService,
        { provide: SkillsService, useValue: skills },
        { provide: InstallationsService, useValue: installations },
        { provide: RunnerService, useValue: runner },
        { provide: SpendReservationsService, useValue: spendReservations },
        { provide: ProcessedEventService, useValue: processedEvents },
      ],
    }).compile();

    service = mod.get(SkillEventHandlerService);
  });

  function buildEventSkill() {
    const chainConfig = getChainConfig(84532);

    return buildSkill({
      name: 'USDC Inbound DCA',
      skillId: 'usdc-inbound-dca-84532',
      runType: 'event-trigger',
      trigger: {
        type: 'event-trigger',
        chainId: 84532,
        contractAddress: chainConfig.tokens.usdc,
        eventSignature: 'Transfer(address indexed from,address indexed to,uint256 value)',
        filterArgs: { to: { source: 'installation', path: 'smartAccountAddress' } },
        dedupeKey: 'txHash-logIndex',
      },
      execution: { kind: 'dca-uniswap-v3', defaultFeeTier: 3000 } as never,
      parameters: [
        {
          key: 'outputToken',
          label: 'Output',
          type: 'select',
          required: true,
          options: [
            { label: 'WETH', value: 'weth' },
            { label: 'cbBTC', value: 'cbBtc' },
          ],
          defaultValue: 'weth',
        },
      ] as never,
    });
  }

  it('matches installation-driven dynamic filters', () => {
    const installation = buildInstallation();

    const matched = service.matchesDynamicFilters(
      { to: { source: 'installation', path: 'smartAccountAddress' } },
      installation,
      { to: installation.smartAccountAddress },
    );

    expect(matched).toBe(true);
  });

  it('dedupes previously processed event tuples', async () => {
    const skill = buildEventSkill();
    const installation = buildInstallation({
      skillId: skill.skillId,
      executions: [
        {
          executedAt: new Date(),
          status: 'confirmed',
          trigger: {
            type: 'event-trigger',
            event: {
              chainId: 84532,
              contractAddress: getChainConfig(84532).tokens.usdc,
              eventSignature: 'Transfer(address indexed from,address indexed to,uint256 value)',
              txHash: '0x' + 'ab'.repeat(32),
              logIndex: 7,
            },
          },
        },
      ],
    });

    skills.findById.mockResolvedValue(skill);
    installations.findActiveBySkillId.mockResolvedValue([installation]);

    const result = await service.handleSkillEvent({
      skillId: skill.skillId,
      chainId: 84532,
      triggerType: 'event-trigger',
      event: {
        chainId: 84532,
        contractAddress: getChainConfig(84532).tokens.usdc,
        eventSignature: 'Transfer(address indexed from,address indexed to,uint256 value)',
        txHash: '0x' + 'ab'.repeat(32),
        logIndex: 7,
        args: { to: installation.smartAccountAddress, value: '1000000' },
      },
    });

    expect(result.dedupedInstallations).toBe(1);
    expect(runner.executeInstallation).not.toHaveBeenCalled();
  });

  it('dedupes atomically claimed event tuples before reserving spend', async () => {
    const skill = buildEventSkill();
    const installation = buildInstallation({ skillId: skill.skillId });

    skills.findById.mockResolvedValue(skill);
    installations.findActiveBySkillId.mockResolvedValue([installation]);
    processedEvents.tryMarkProcessed.mockResolvedValue(false);

    const result = await service.handleSkillEvent({
      skillId: skill.skillId,
      chainId: 84532,
      triggerType: 'event-trigger',
      event: {
        chainId: 84532,
        contractAddress: getChainConfig(84532).tokens.usdc,
        eventSignature: 'Transfer(address indexed from,address indexed to,uint256 value)',
        txHash: '0x' + 'aa'.repeat(32),
        logIndex: 3,
        args: { to: installation.smartAccountAddress, value: '1000000' },
      },
    });

    expect(result.dedupedInstallations).toBe(1);
    expect(processedEvents.tryMarkProcessed).toHaveBeenCalledWith({
      chainId: 84532,
      contractAddress: getChainConfig(84532).tokens.usdc,
      txHash: '0x' + 'aa'.repeat(32),
      logIndex: 3,
    });
    expect(spendReservations.reserveDailySpend).not.toHaveBeenCalled();
    expect(runner.executeInstallation).not.toHaveBeenCalled();
  });

  it('records skipped execution when daily limit is exhausted', async () => {
    const skill = buildEventSkill();
    const installation = buildInstallation({
      skillId: skill.skillId,
      parameters: {
        outputToken: 'weth',
        spendMode: 'fixed',
        amountPerRun: '100000',
        percentOfInboundBps: '5000',
        dailySpendLimit: '10000000',
      },
    });

    skills.findById.mockResolvedValue(skill);
    installations.findActiveBySkillId.mockResolvedValue([installation]);
    spendReservations.reserveDailySpend.mockResolvedValue({
      periodKey: '2026-06-06',
      dailyLimit: '10000000',
      requestedAmount: '100000',
      actualAmount: '0',
      remainingAmount: '0',
    });

    const result = await service.handleSkillEvent({
      skillId: skill.skillId,
      chainId: 84532,
      triggerType: 'event-trigger',
      event: {
        chainId: 84532,
        contractAddress: getChainConfig(84532).tokens.usdc,
        eventSignature: 'Transfer(address indexed from,address indexed to,uint256 value)',
        txHash: '0x' + 'cd'.repeat(32),
        logIndex: 1,
        args: { to: installation.smartAccountAddress, value: '1000000' },
      },
    });

    expect(result.skippedInstallations).toBe(1);
    expect(installations.appendExecution).toHaveBeenCalledWith(
      String((installation as { _id?: unknown })._id),
      expect.objectContaining({ status: 'skipped', skippedReason: 'daily-limit-exhausted' }),
    );
  });

  it('builds trigger and spend context for percent-of-inbound executions', async () => {
    const skill = buildEventSkill();
    const installation = buildInstallation({
      skillId: skill.skillId,
      parameters: {
        outputToken: 'weth',
        spendMode: 'percent-of-inbound',
        amountPerRun: '100000',
        percentOfInboundBps: '5000',
        dailySpendLimit: '900000',
      },
    });

    skills.findById.mockResolvedValue(skill);
    installations.findActiveBySkillId.mockResolvedValue([installation]);
    spendReservations.reserveDailySpend.mockResolvedValue({
      reservationId: 'res_1',
      periodKey: '2026-06-06',
      dailyLimit: '900000',
      requestedAmount: '500000',
      actualAmount: '500000',
      remainingAmount: '400000',
    });

    const result = await service.handleSkillEvent({
      skillId: skill.skillId,
      chainId: 84532,
      triggerType: 'event-trigger',
      event: {
        chainId: 84532,
        contractAddress: getChainConfig(84532).tokens.usdc,
        eventSignature: 'Transfer(address indexed from,address indexed to,uint256 value)',
        txHash: '0x' + 'ef'.repeat(32),
        logIndex: 9,
        blockNumber: '44',
        args: {
          from: '0x0000000000000000000000000000000000000001',
          to: installation.smartAccountAddress,
          value: '1000000',
        },
      },
    });

    expect(result.executedInstallations).toBe(1);
    expect(spendReservations.reserveDailySpend).toHaveBeenCalledWith(
      expect.objectContaining({
        installationId: String((installation as { _id?: unknown })._id),
        dailyLimit: 900000n,
        desiredAmount: 500000n,
        inboundAmount: 1000000n,
      }),
    );
    expect(runner.executeInstallation).toHaveBeenCalledWith(
      String((installation as { _id?: unknown })._id),
      expect.objectContaining({
        trigger: expect.objectContaining({
          type: 'event-trigger',
          event: expect.objectContaining({
            blockNumber: '44',
            args: expect.objectContaining({
              to: installation.smartAccountAddress,
              value: '1000000',
            }),
          }),
        }),
        spend: expect.objectContaining({
          tokenAddress: getChainConfig(84532).tokens.usdc,
          requestedAmount: '500000',
          actualAmount: '500000',
          dailyLimit: '900000',
          periodKey: '2026-06-06',
          reservationId: 'res_1',
        }),
      }),
    );
  });
});
