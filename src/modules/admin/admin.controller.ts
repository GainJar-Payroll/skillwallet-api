import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Logger,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiParam, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { AdminApiKeyGuard } from '../../common/guards/admin-api-key.guard';
import { ExecutorService } from '../executor/executor.service';
import { SkillsService } from '../skills/skills.service';
import { SkillEventHandlerService } from '../runner/skill-event-handler.service';
import { RunnerService } from '../runner/runner.service';
import { CreateSkillDto } from '../skills/dto/create-skill.dto';
import { SimulateEventDto } from './dto/simulate-event.dto';

const GENERIC_DCA_TEMPLATE: CreateSkillDto = {
  name: 'Generic DCA',
  skillId: 'generic-dca-84532',
  description:
    'Dollar-cost average USDC into a selected Base token on a fixed schedule. The executor approves USDC, swaps through SwapRouter02, and records AI market context for each run.',
  iconUrl:
    'https://raw.githubusercontent.com/spothq/cryptocurrency-icons/master/128/color/usdc.png',
  runType: 'cron',
  cronExpression: '0 9 * * *',
  chainId: 84532,
  delegationScope: {
    type: 'FunctionCall',
    targets: [
      '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
      '0x94cC0AaC535CCDB3C01d6787D6413C739ae12bc4',
    ],
    selectors: [
      'transfer(address,uint256)',
      'approve(address,uint256)',
      'exactInputSingle((address,address,uint24,address,uint256,uint256,uint160))',
    ],
    valueLte: { maxValue: '0x0' },
  },
  parameters: [
    {
      key: 'outputToken',
      label: 'Output Token',
      type: 'select',
      required: true,
      options: ['weth', 'cbBtc'],
      defaultValue: 'weth',
      description: 'Token to accumulate with each DCA run',
    },
    {
      key: 'amountUsdc',
      label: 'Amount (USDC atoms)',
      type: 'number',
      required: true,
      defaultValue: '10000000',
      description: 'Amount of USDC to swap per run in base units. Default: 10 USDC = 10000000',
    },
  ],
  isActive: true,
  metadata: { category: 'DeFi', kind: 'dca', risk: 'medium', builtin: true },
};

const USDC_INBOUND_DCA_TEMPLATE: CreateSkillDto = {
  name: 'USDC Inbound DCA',
  skillId: 'usdc-inbound-dca-84532',
  description:
    'When USDC is transferred into the smart account, swap a bounded amount into the selected output token.',
  iconUrl:
    'https://raw.githubusercontent.com/spothq/cryptocurrency-icons/master/128/color/usdc.png',
  runType: 'event-trigger',
  chainId: 84532,
  eventTriggerConfig: {
    type: 'event-trigger',
    chainId: 84532,
    contractAddress: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
    eventSignature: 'Transfer(address indexed from,address indexed to,uint256 value)',
    filterArgs: {
      to: { source: 'installation', path: 'smartAccountAddress' },
    },
    confirmations: 1,
    dedupeKey: 'txHash-logIndex',
  },
  trigger: {
    type: 'event-trigger',
    chainId: 84532,
    contractAddress: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
    eventSignature: 'Transfer(address indexed from,address indexed to,uint256 value)',
    filterArgs: {
      to: { source: 'installation', path: 'smartAccountAddress' },
    },
    confirmations: 1,
    dedupeKey: 'txHash-logIndex',
  },
  execution: {
    kind: 'dca-uniswap-v3',
    tokenIn: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
    router: '0x94cC0AaC535CCDB3C01d6787D6413C739ae12bc4',
    defaultFeeTier: 3000,
  },
  delegationScope: {
    type: 'FunctionCall',
    targets: [
      '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
      '0x94cC0AaC535CCDB3C01d6787D6413C739ae12bc4',
    ],
    selectors: [
      'transfer(address,uint256)',
      'approve(address,uint256)',
      'exactInputSingle((address,address,uint24,address,uint256,uint256,uint160))',
    ],
    valueLte: { maxValue: '0x0' },
    erc20SpendLimit: {
      token: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
      period: 'day',
      maxAmountParam: 'dailySpendLimit',
    },
  },
  parameters: [
    {
      key: 'outputToken',
      label: 'Output Token',
      type: 'select',
      required: true,
      options: ['weth', 'cbBtc'],
      defaultValue: 'weth',
      description: 'Token to accumulate from inbound USDC',
    },
    {
      key: 'spendMode',
      label: 'Spend Mode',
      type: 'select',
      required: true,
      options: ['fixed', 'percent-of-inbound'],
      defaultValue: 'fixed',
      description: 'Spend a fixed amount or percent of inbound transfer amount',
    },
    {
      key: 'amountPerRun',
      label: 'Fixed Spend (USDC atoms)',
      type: 'number',
      required: true,
      defaultValue: '100000',
      description: 'Default fixed spend is 0.1 USDC in base units',
    },
    {
      key: 'percentOfInboundBps',
      label: 'Percent of Inbound (bps)',
      type: 'number',
      required: true,
      defaultValue: '5000',
      description: 'Default is 50% of the inbound amount',
    },
    {
      key: 'dailySpendLimit',
      label: 'Daily Spend Limit (USDC atoms)',
      type: 'number',
      required: true,
      defaultValue: '10000000',
      description: 'Default is 10 USDC in base units',
    },
  ],
  limits: {
    dailySpend: {
      tokenAddress: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
      period: 'day',
      maxAmountParam: 'dailySpendLimit',
    },
  },
  isActive: true,
  metadata: { category: 'DeFi', kind: 'dca', risk: 'medium', builtin: true },
};

@ApiTags('Admin')
@ApiSecurity('admin-api-key')
@Controller('admin')
@UseGuards(AdminApiKeyGuard)
export class AdminController {
  private readonly logger = new Logger(AdminController.name);

  constructor(
    private readonly config: ConfigService,
    private readonly executorService: ExecutorService,
    private readonly skillsService: SkillsService,
    private readonly skillEventHandlerService: SkillEventHandlerService,
    private readonly runnerService: RunnerService,
  ) {}

  @Get('executor')
  @ApiOperation({ summary: 'Admin view of the executor account' })
  @ApiOkResponse({
    description: 'Executor EVM address and configured default chain id',
    schema: {
      type: 'object',
      properties: {
        address: { type: 'string', example: '0x90F79bf6EB2c4f870365E785982E1f101E93b906' },
      },
    },
  })
  async executor() {
    return {
      address: this.executorService.getAddress(),
    };
  }

  @Post('skills/seed')
  @ApiOperation({
    summary: 'Seed built-in skills',
    description: 'Upserts the built-in Generic DCA skill. Safe to call repeatedly.',
  })
  @ApiOkResponse({
    description: 'List of skill names that were seeded',
    schema: {
      type: 'object',
      properties: {
        seeded: { type: 'array', items: { type: 'string' }, example: ['Generic DCA'] },
      },
    },
  })
  async seedSkills() {
    const seeded: string[] = [];
    await this.skillsService.upsertByName(GENERIC_DCA_TEMPLATE.name, GENERIC_DCA_TEMPLATE);
    seeded.push(GENERIC_DCA_TEMPLATE.name);
    await this.skillsService.upsertByName(USDC_INBOUND_DCA_TEMPLATE.name, USDC_INBOUND_DCA_TEMPLATE);
    seeded.push(USDC_INBOUND_DCA_TEMPLATE.name);
    return { seeded };
  }

  @Post('events/simulate')
  @ApiOperation({
    summary: 'Simulate an event-triggered skill event',
    description: 'Routes the payload through the same shared event handler used by live event watchers.',
  })
  @ApiOkResponse({ description: 'Shared event handler summary' })
  async simulateEvent(@Body() dto: SimulateEventDto) {
    try {
      return await this.skillEventHandlerService.handleSkillEvent({
        skillId: dto.skillId,
        chainId: dto.chainId,
        triggerType: 'event-trigger',
        event: {
          chainId: dto.chainId,
          contractAddress: String(dto.event['contractAddress']),
          eventSignature: String(dto.event['eventSignature']),
          txHash:
            dto.event['txHash'] !== undefined ? String(dto.event['txHash']) : undefined,
          logIndex:
            dto.event['logIndex'] !== undefined ? Number(dto.event['logIndex']) : undefined,
          blockNumber:
            dto.event['blockNumber'] !== undefined ? String(dto.event['blockNumber']) : undefined,
          args:
            typeof dto.event['args'] === 'object' && dto.event['args'] !== null
              ? (dto.event['args'] as Record<string, unknown>)
              : {},
        },
      });
    } catch (err) {
      this.logger.error(`Simulated event failed for ${dto.skillId}: ${(err as Error).message}`);
      throw new BadRequestException((err as Error).message);
    }
  }

  @Post('installations/:id/trigger')
  @ApiOperation({
    summary: 'Force-run an installation',
    description: 'Bypasses the cron/event trigger and runs the executor now.',
  })
  @ApiParam({ name: 'id', description: 'Installation Mongo ObjectId' })
  @ApiOkResponse({
    description: 'Trigger confirmation',
    schema: {
      type: 'object',
      properties: {
        message: { type: 'string', example: 'Execution triggered' },
        installationId: { type: 'string' },
      },
    },
  })
  async trigger(@Param('id') id: string) {
    try {
      await this.runnerService.executeInstallation(id);
    } catch (err) {
      this.logger.error(`Manual trigger failed for ${id}: ${(err as Error).message}`);
      throw new BadRequestException((err as Error).message);
    }
    return { message: 'Execution triggered', installationId: id };
  }
}
