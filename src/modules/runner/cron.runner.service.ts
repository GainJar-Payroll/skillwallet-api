import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { parseExpression } from 'cron-parser';
import { RunnerService, ExecutionContext } from './runner.service';
import { InstallationsService } from '../installations/installations.service';
import { SkillsService } from '../skills/skills.service';
import { X402Service } from '../x402/x402.service';
import { VeniceService } from '../venice/venice.service';
import { Installation, ExecutionRecord } from '../installations/schemas/installation.schema';
import { Skill } from '../skills/schemas/skill.schema';
import { AISkillConfig, type CronSkillTriggerConfig } from '../skills/skill-config.types';
import { getChainConfig } from '../../config/chains.config';
import { createPublicClient, erc20Abi, http } from 'viem';

type WithId<T> = T & { _id: { toString(): string } };

@Injectable()
export class CronRunnerService {
  private readonly logger = new Logger(CronRunnerService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly runnerService: RunnerService,
    private readonly installationsService: InstallationsService,
    private readonly skillsService: SkillsService,
    private readonly x402Service: X402Service,
    private readonly veniceService: VeniceService,
  ) {}

  @Cron(process.env.CRON_INTERVAL ?? '*/5 * * * *')
  async handleCron(): Promise<void> {
    if (!this.config.get<boolean>('runnerEnabled')) return;

    const due = await this.installationsService.findDueForExecution();
    this.logger.log(`Cron tick: ${due.length} installations due`);

    for (const instRaw of due) {
      const inst = instRaw as WithId<Installation>;
      const populatedSkill = inst.skillId as unknown as WithId<Skill>;
      if (populatedSkill?.runType && populatedSkill.runType !== 'cron') continue;

      const skillIdStr =
        populatedSkill?.skillId?.toString?.() ?? (inst.skillId as unknown as string);

      try {
        // Build context from x402 services
        const context: Record<string, string> = {};

        if (Array.isArray(populatedSkill?.x402Services)) {
          for (const svc of populatedSkill.x402Services) {
            try {
              const result = await this.x402Service
                .fetch<unknown>(svc.endpoint, { method: svc.method ?? 'GET' })
                .then((r) => JSON.stringify(r))
                .catch(() => null);

              if (result) {
                context[svc.output] = result;
              }
            } catch (err) {
              this.logger.warn(
                `x402 fetch "${svc.key}" failed (${svc.endpoint}): ${(err as Error).message}`,
              );
              if (svc.required) throw err;
            }
          }
        }

        // AI decision if configured
        let aiDecision: { decision: string; reason?: string } | undefined;

        if (populatedSkill?.aiConfig) {
          try {
            const prompt = await this.buildAIPrompt(
              populatedSkill.aiConfig,
              inst.parameters,
              context,
              inst.executions ?? [],
              inst as WithId<Installation>,
            );
            const aiOutput = await this.veniceService.decide(prompt);
            aiDecision = aiOutput;

            if (aiOutput.decision === 'skip') {
              this.logger.log(`AI skipped installation ${inst._id.toString()}: ${aiOutput.reason}`);
              await this.recordSkipped(inst._id.toString(), aiOutput.reason, context);
              continue;
            }
          } catch (err) {
            this.logger.warn(`AI analysis failed (non-fatal): ${(err as Error).message}`);
          }
        }

        // Prepare execution context
        const execCtx: ExecutionContext = {
          aiContext: aiDecision ? JSON.stringify(aiDecision) : undefined,
          newsContext: context['newsContext'] ?? undefined,
        };

        await this.runnerService.executeInstallation(inst._id.toString(), execCtx);

        const skill = await this.skillsService.findById(skillIdStr);

        // Resolve cron expression: user's cronSchedule param > skill default
        const cronExpr =
          ((inst.parameters as Record<string, unknown>)?.cronSchedule as string | undefined) ??
          // default value
          (skill.trigger as CronSkillTriggerConfig).cronExpression;

        const parser = parseExpression(cronExpr, { currentDate: new Date() });
        const CHECK_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes, matches CRON_INTERVAL default
        const minNext = new Date(Date.now() + CHECK_INTERVAL_MS);
        let nextDate = parser.next().toDate();
        while (nextDate < minNext && parser.hasNext()) {
          nextDate = parser.next().toDate();
        }
        await this.installationsService.updateNextExecution(inst._id.toString(), nextDate);
      } catch (err) {
        this.logger.error(
          `Execution failed for installation ${inst._id.toString()}: ${(err as Error).message}`,
        );
        // Advance to prevent infinite retry — retry in 5 min
        await this.installationsService.updateNextExecution(
          inst._id.toString(),
          new Date(Date.now() + 5 * 60 * 1000),
        );
      }
    }
  }

  private async buildAIPrompt(
    aiConfig: AISkillConfig,
    params: Record<string, unknown>,
    context: Record<string, string>,
    history: ExecutionRecord[],
    inst: WithId<Installation>,
  ): Promise<string> {
    let prompt = aiConfig.promptTemplate;

    // ── Enrich prompt with real USDC balance and human-readable amounts ──
    const chainConfig = getChainConfig(inst.chainId);
    const rpcUrls = this.config.get<Record<number, string>>('rpc');
    const rpcUrl = rpcUrls?.[inst.chainId];

    // Convert amount atoms to human-readable USDC
    const rawAmount = String(params['amountUsdc'] ?? params['amountPerRun'] ?? '');
    const amountNum = rawAmount ? Number(rawAmount) / 1_000_000 : 0;
    const amountUsdcHuman = amountNum.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 6 });

    // Fetch USDC balance
    let usdcBalanceHuman = 'unknown';
    if (rpcUrl) {
      try {
        const client = createPublicClient({ transport: http(rpcUrl) });
        const balance = await client.readContract({
          address: chainConfig.tokens.usdc,
          abi: erc20Abi,
          functionName: 'balanceOf',
          args: [inst.smartAccountAddress as `0x${string}`],
        }) as bigint;
        const balNum = Number(balance) / 1_000_000;
        usdcBalanceHuman = balNum.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 6 });
      } catch (err) {
        this.logger.warn(`Failed to fetch USDC balance for AI prompt: ${(err as Error).message}`);
      }
    }

    // Resolve cron expression
    const cronExpr = String(params['cronSchedule'] ?? 'unknown');

    if (aiConfig.inputSources.includeParams && params) {
      for (const [key, value] of Object.entries(params)) {
        prompt = prompt.replace(`{{params.${key}}}`, String(value ?? ''));
      }
    }

    for (const outputKey of aiConfig.inputSources.fromX402) {
      prompt = prompt.replace(`{{${outputKey}}}`, context[outputKey] ?? '');
    }

    if (aiConfig.inputSources.includeHistory && history.length > 0) {
      const recentHistory = history
        .slice(0, 5)
        .map(
          (h) =>
            `- ${h.executedAt!.toISOString()}: ${h.status}${h.skippedReason ? ` (skipped: ${h.skippedReason})` : ''}`,
        )
        .join('\n');
      prompt = prompt.replace('{{history}}', recentHistory);
    } else {
      prompt = prompt.replace('{{history}}', 'No previous executions');
    }

    prompt = prompt.replace('{{amountUsdcHuman}}', amountUsdcHuman);
    prompt = prompt.replace('{{usdcBalanceHuman}}', usdcBalanceHuman);
    prompt = prompt.replace('{{cronExpression}}', cronExpr);

    return prompt;
  }

  private async recordSkipped(
    installationId: string,
    reason: string,
    context: Record<string, string>,
  ): Promise<void> {
    const { randomUUID } = await import('node:crypto');
    await this.installationsService.appendExecution(installationId, {
      executionId: randomUUID(),
      executedAt: new Date(),
      status: 'skipped',
      skippedReason: reason,
      aiContext: JSON.stringify({ decision: 'skip', reason }),
      newsContext: context['newsContext'],
    });
  }
}
