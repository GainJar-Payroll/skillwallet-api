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
import { InstallationsService } from '../installations/installations.service';
import { SkillsService } from '../skills/skills.service';
import { SkillEventHandlerService } from '../runner/skill-event-handler.service';
import { RunnerService } from '../runner/runner.service';
import { X402Service } from '../x402/x402.service';
import { VeniceService } from '../venice/venice.service';
import { CreateSkillDto } from '../skills/dto/create-skill.dto';
import { SimulateEventDto } from './dto/simulate-event.dto';
import { Skill } from '../skills/schemas/skill.schema';

const USDC_INBOUND_DCA_TEMPLATE: CreateSkillDto = {
  name: 'USDC Inbound DCA',
  skillId: 'usdc-inbound-dca-84532',
  description:
    'When USDC is transferred into the smart account, swap a bounded amount into the selected output token.',
  iconUrl:
    'https://raw.githubusercontent.com/spothq/cryptocurrency-icons/master/128/color/usdc.png',
  runType: 'event-trigger',
  chainId: 84532,
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
  delegationScopeMeta: [
    {
      target: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
      label: 'USDC Token',
      description: 'Let the agent transfer and approve USDC tokens for DCA swaps',
      contractUrl: 'https://sepolia.basescan.org/address/0x036CbD53842c5426634e7929541eC2318f3dCF7e',
      selectors: [
        { signature: 'transfer(address,uint256)', label: 'Transfer USDC', description: 'Let the agent transfer USDC out of your smart account to the fee collector and swap router' },
        { signature: 'approve(address,uint256)', label: 'Approve USDC', description: 'Let the agent approve the swap router to spend your USDC for DCA swaps' },
      ],
    },
    {
      target: '0x94cC0AaC535CCDB3C01d6787D6413C739ae12bc4',
      label: 'Uniswap V3 SwapRouter',
      description: 'Let the agent swap USDC for WETH via Uniswap V3',
      contractUrl: 'https://sepolia.basescan.org/address/0x94cC0AaC535CCDB3C01d6787D6413C739ae12bc4',
      selectors: [
        { signature: 'exactInputSingle((address,address,uint24,address,uint256,uint256,uint160))', label: 'Swap tokens', description: 'Execute a single-pair swap through Uniswap V3 — swaps USDC for the configured output token' },
      ],
    },
  ],
  parameters: [
    {
      key: 'outputToken',
      label: 'Output Token',
      type: 'select',
      required: true,
      options: [
        {
          label: 'WETH',
          value: 'weth',
          metadata: {
            address: '0x4200000000000000000000000000000000000006',
            symbol: 'WETH',
            decimals: 18,
          },
        },
        {
          label: 'cbBTC',
          value: 'cbBtc',
          metadata: { symbol: 'cbBTC', decimals: 8 },
        },
      ],
      defaultValue: 'weth',
      description: 'Token to accumulate from inbound USDC',
    },
    {
      key: 'spendMode',
      label: 'Spend Mode',
      type: 'select',
      required: true,
      options: [
        { label: 'Fixed amount', value: 'fixed' },
        { label: 'Percent of inbound', value: 'percent-of-inbound' },
      ],
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
  metadata: { category: 'DeFi' },
};

const VENICE_AI_DCA_TEMPLATE: CreateSkillDto = {
  name: 'AI-Powered DCA',
  skillId: 'ai-powered-dca-84532',
  description:
    'Dollar-cost average USDC into WETH — enhanced with Venice AI market analysis. Before each swap, fetches crypto news via x402 OttoAI and analyzes sentiment with Venice AI. The AI market context is stored alongside each execution so you can see how market conditions influenced your DCA.',
  iconUrl:
    'https://raw.githubusercontent.com/spothq/cryptocurrency-icons/master/128/color/usdc.png',
  runType: 'cron',
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
  delegationScopeMeta: [
    {
      target: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
      label: 'USDC Token',
      description: 'Let the agent transfer and approve USDC tokens for DCA swaps',
      contractUrl: 'https://sepolia.basescan.org/address/0x036CbD53842c5426634e7929541eC2318f3dCF7e',
      selectors: [
        { signature: 'transfer(address,uint256)', label: 'Transfer USDC', description: 'Let the agent transfer USDC out of your smart account to the fee collector and swap router' },
        { signature: 'approve(address,uint256)', label: 'Approve USDC', description: 'Let the agent approve the swap router to spend your USDC for DCA swaps' },
      ],
    },
    {
      target: '0x94cC0AaC535CCDB3C01d6787D6413C739ae12bc4',
      label: 'Uniswap V3 SwapRouter',
      description: 'Let the agent swap USDC for WETH via Uniswap V3',
      contractUrl: 'https://sepolia.basescan.org/address/0x94cC0AaC535CCDB3C01d6787D6413C739ae12bc4',
      selectors: [
        { signature: 'exactInputSingle((address,address,uint24,address,uint256,uint256,uint160))', label: 'Swap tokens', description: 'Execute a single-pair swap through Uniswap V3 — swaps USDC for the configured output token' },
      ],
    },
  ],
  parameters: [
    {
      key: 'cronSchedule',
      label: 'Cron Schedule',
      type: 'cron',
      required: true,
      defaultValue: '0 */6 * * *',
      description:
        'Cron expression for the DCA schedule. Default: every 6 hours.',
    },
    {
      key: 'outputToken',
      label: 'Output Token',
      type: 'select',
      required: true,
      options: [
        {
          label: 'WETH',
          value: 'weth',
          metadata: {
            address: '0x4200000000000000000000000000000000000006',
            symbol: 'WETH',
            decimals: 18,
          },
        },
      ],
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
  x402Services: [
    {
      key: 'crypto-news',
      endpoint: 'https://x402.ottoai.services/crypto-news',
      method: 'GET',
      output: 'newsContext',
      required: false,
    },
  ],
  aiConfig: {
    provider: 'venice',
    model: 'e2ee-gpt-oss-120b-p',
    promptTemplate: 'You manage a DCA strategy. Skill parameters: outputToken={{params.outputToken}}, amountUsdc={{params.amountUsdc}} atams, schedule={{cronExpression}}. Installation: total invested so far, current balance. Market news: {{newsContext}}. Previous executions: {{history}}. Decide if this DCA run should execute now. Consider market sentiment and DCA principles. Respond in JSON: {"decision":"execute"|"skip","reason":"...","sentiment":"bullish"|"bearish"|"neutral"}',
    inputSources: {
      fromX402: ['newsContext'],
      includeParams: true,
      includeHistory: true,
    },
    maxTokens: 500,
  },
  isActive: true,
  trigger: {
    type: 'cron',
    cronExpression: '0 */6 * * *',
  },
  metadata: { category: 'DeFi' },
};

const CUSTOM_CRON_DCA_TEMPLATE: CreateSkillDto = {
  name: 'Custom Cron DCA',
  skillId: 'custom-cron-dca-84532',
  description:
    'Dollar-cost average USDC into WETH on YOUR custom cron schedule. Set the cronSchedule parameter to any valid cron expression (e.g. "0 9 * * 1-5" for weekdays at 9am).',
  iconUrl:
    'https://raw.githubusercontent.com/spothq/cryptocurrency-icons/master/128/color/usdc.png',
  runType: 'cron',
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
  delegationScopeMeta: [
    {
      target: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
      label: 'USDC Token',
      description: 'Let the agent transfer and approve USDC tokens for DCA swaps',
      contractUrl: 'https://sepolia.basescan.org/address/0x036CbD53842c5426634e7929541eC2318f3dCF7e',
      selectors: [
        { signature: 'transfer(address,uint256)', label: 'Transfer USDC', description: 'Let the agent transfer USDC out of your smart account to the fee collector and swap router' },
        { signature: 'approve(address,uint256)', label: 'Approve USDC', description: 'Let the agent approve the swap router to spend your USDC for DCA swaps' },
      ],
    },
    {
      target: '0x94cC0AaC535CCDB3C01d6787D6413C739ae12bc4',
      label: 'Uniswap V3 SwapRouter',
      description: 'Let the agent swap USDC for WETH via Uniswap V3',
      contractUrl: 'https://sepolia.basescan.org/address/0x94cC0AaC535CCDB3C01d6787D6413C739ae12bc4',
      selectors: [
        { signature: 'exactInputSingle((address,address,uint24,address,uint256,uint256,uint160))', label: 'Swap tokens', description: 'Execute a single-pair swap through Uniswap V3 — swaps USDC for the configured output token' },
      ],
    },
  ],
  parameters: [
    {
      key: 'cronSchedule',
      label: 'Cron Schedule',
      type: 'cron',
      required: true,
      defaultValue: '0 9 * * *',
      description:
        'Cron expression for the DCA schedule. Use cron-parser format (5 or 6 fields). Example: "0 9 * * *" = daily at 9am UTC.',
    },
    {
      key: 'outputToken',
      label: 'Output Token',
      type: 'select',
      required: true,
      options: [
        {
          label: 'WETH',
          value: 'weth',
          metadata: {
            address: '0x4200000000000000000000000000000000000006',
            symbol: 'WETH',
            decimals: 18,
          },
        },
        {
          label: 'cbBTC',
          value: 'cbBtc',
          metadata: { symbol: 'cbBTC', decimals: 8 },
        },
      ],
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
  trigger: {
    type: 'cron',
    cronExpression: '0 */6 * * *', // Every 6 hours — fallback if user doesn't set cronSchedule
  },
  metadata: { category: 'DeFi' },
};

@ApiTags('Admin')
@ApiSecurity('admin-api-key')
@Controller('admin')
@UseGuards(AdminApiKeyGuard)
export class AdminController {
  private readonly logger = new Logger(AdminController.name);

  constructor(
    private readonly config: ConfigService,
    private readonly skillsService: SkillsService,
    private readonly installationsService: InstallationsService,
    private readonly skillEventHandlerService: SkillEventHandlerService,
    private readonly runnerService: RunnerService,
    private readonly x402Service: X402Service,
    private readonly veniceService: VeniceService,
  ) {}

  @Post('skills/seed')
  @ApiOperation({
    summary: 'Seed built-in skills',
    description: 'Upserts the built-in skills. Safe to call repeatedly.',
  })
  @ApiOkResponse({
    description: 'List of skill names that were seeded',
    schema: {
      type: 'object',
      properties: {
        seeded: { type: 'array', items: { type: 'string' }, example: ['USDC Inbound DCA'] },
      },
    },
  })
  async seedSkills() {
    const seeded: string[] = [];
    await this.skillsService.upsertByName(
      USDC_INBOUND_DCA_TEMPLATE.name,
      USDC_INBOUND_DCA_TEMPLATE,
    );
    seeded.push(USDC_INBOUND_DCA_TEMPLATE.name);
    await this.skillsService.upsertByName(
      CUSTOM_CRON_DCA_TEMPLATE.name,
      CUSTOM_CRON_DCA_TEMPLATE,
    );
    seeded.push(CUSTOM_CRON_DCA_TEMPLATE.name);
    await this.skillsService.upsertByName(
      VENICE_AI_DCA_TEMPLATE.name,
      VENICE_AI_DCA_TEMPLATE,
    );
    seeded.push(VENICE_AI_DCA_TEMPLATE.name);
    return { seeded };
  }

  @Post('events/simulate')
  @ApiOperation({
    summary: 'Simulate an event-triggered skill event',
    description:
      'Routes the payload through the same shared event handler used by live event watchers.',
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
          txHash: dto.event['txHash'] !== undefined ? String(dto.event['txHash']) : undefined,
          logIndex: dto.event['logIndex'] !== undefined ? Number(dto.event['logIndex']) : undefined,
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
    description:
      'Bypasses cron/event trigger and runs executor now. Respects skill-declared x402Services and aiConfig. Only fetches AI context if skill defines those configs.',
  })
  @ApiParam({ name: 'id', description: 'Installation Mongo ObjectId' })
  @ApiOkResponse({
    description: 'Trigger confirmation with AI reasoning context',
    schema: {
      type: 'object',
      properties: {
        message: { type: 'string', example: 'Execution triggered' },
        installationId: { type: 'string' },
        aiContext: { type: 'string', description: 'Venice AI analysis summary', nullable: true },
        newsContext: { type: 'string', description: 'Raw x402 fetch result', nullable: true },
      },
    },
  })
  async trigger(@Param('id') id: string) {
    const installation = await this.installationsService.findById(id);
    const skill =
      typeof installation.skillId === 'object' &&
      installation.skillId !== null &&
      'skillId' in (installation.skillId as object)
        ? (installation.skillId as unknown as Skill)
        : await this.skillsService.findById(String(installation.skillId));

    let aiContext: string | undefined;
    let newsContext: string | undefined;

    if (Array.isArray(skill.x402Services) && skill.x402Services.length > 0) {
      try {
        for (const svc of skill.x402Services) {
          const result = await this.x402Service
            .fetch<unknown>(svc.endpoint, { method: svc.method ?? 'GET' })
            .then((r) => JSON.stringify(r))
            .catch(() => null);

          if (result && svc.output === 'newsContext') {
            newsContext = result;
          }
        }
      } catch (err) {
        this.logger.warn(`x402 fetch failed (non-fatal): ${(err as Error).message}`);
      }
    }

    if (skill.aiConfig && newsContext) {
      try {
        let prompt = skill.aiConfig.promptTemplate
          .replace('{{newsContext}}', newsContext)
          .replace('{{history}}', 'No previous executions');
        if (skill.aiConfig.inputSources.includeParams && installation.parameters) {
          const params = installation.parameters as Record<string, unknown>;
          for (const [key, value] of Object.entries(params)) {
            prompt = prompt.replace(`{{params.${key}}}`, String(value ?? ''));
          }
        }
        const aiResult = await this.veniceService.decide(prompt);
        aiContext = JSON.stringify(aiResult);
      } catch (err) {
        this.logger.warn(`AI analysis failed (non-fatal): ${(err as Error).message}`);
      }
    }

    try {
      await this.runnerService.executeInstallation(id, { aiContext, newsContext });
      // Advance nextExecutionAt to prevent immediate cron re-execution
      await this.installationsService.updateNextExecution(
        id,
        new Date(Date.now() + 5 * 60 * 1000),
      );
    } catch (err) {
      this.logger.error(`Manual trigger failed for ${id}: ${(err as Error).message}`);
      throw new BadRequestException((err as Error).message);
    }
    return {
      message: 'Execution triggered',
      installationId: id,
      aiContext: aiContext ?? null,
      newsContext: newsContext ?? null,
    };
  }
}
