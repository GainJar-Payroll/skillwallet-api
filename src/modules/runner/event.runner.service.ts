import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ExecutorService } from '../executor/executor.service';
import { Skill } from '../skills/schemas/skill.schema';
import { SkillsService } from '../skills/skills.service';
import { parseTriggerEventAbi } from './event-abi';
import { SkillEventHandlerService } from './skill-event-handler.service';

type WithId<T> = T & { _id: { toString(): string } };

@Injectable()
export class EventRunnerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(EventRunnerService.name);
  private unwatchFns: Array<() => void> = [];

  constructor(
    private readonly config: ConfigService,
    private readonly executorService: ExecutorService,
    private readonly skillsService: SkillsService,
    private readonly skillEventHandlerService: SkillEventHandlerService,
  ) {}

  async onModuleInit(): Promise<void> {
    if (!this.config.get<boolean>('runnerEnabled')) return;
    await this.startWatchers();
  }

  async onModuleDestroy(): Promise<void> {
    for (const fn of this.unwatchFns) {
      try {
        fn();
      } catch (err) {
        this.logger.warn(`Unwatch failed: ${(err as Error).message}`);
      }
    }
    this.unwatchFns = [];
  }

  private async startWatchers(): Promise<void> {
    const skills = (await this.skillsService.findAll(true)) as Array<WithId<Skill>>;
    const eventSkills = skills.filter((skill) => skill.trigger?.type === 'event-trigger');
    const groupedWatchers = new Map<string, Array<WithId<Skill>>>();

    for (const skill of eventSkills) {
      const trigger = skill.trigger;
      if (!trigger || trigger.type !== 'event-trigger') continue;

      const key = `${trigger.chainId ?? skill.chainId}:${trigger.contractAddress.toLowerCase()}:${trigger.eventSignature}`;
      groupedWatchers.set(key, [...(groupedWatchers.get(key) ?? []), skill]);
    }

    for (const groupedSkills of groupedWatchers.values()) {
      const firstSkill = groupedSkills[0];
      const trigger = firstSkill.trigger;
      if (!trigger || trigger.type !== 'event-trigger') continue;

      try {
        const publicClient = this.executorService.getPublicClient(
          trigger.chainId ?? firstSkill.chainId,
        );
        const unwatch = publicClient.watchEvent({
          address: trigger.contractAddress as `0x${string}`,
          event: parseTriggerEventAbi(trigger.eventSignature),
          onLogs: async (logs: Array<Record<string, unknown>>) => {
            for (const log of logs) {
              const args = this.serializeArgs(log.args);

              for (const skill of groupedSkills) {
                try {
                  await this.skillEventHandlerService.handleSkillEvent({
                    skillId: skill.skillId,
                    chainId: trigger.chainId ?? skill.chainId,
                    triggerType: 'event-trigger',
                    event: {
                      chainId: trigger.chainId ?? skill.chainId,
                      contractAddress: trigger.contractAddress,
                      eventSignature: trigger.eventSignature,
                      txHash:
                        typeof log.transactionHash === 'string' ? log.transactionHash : undefined,
                      logIndex:
                        typeof log.logIndex === 'number'
                          ? log.logIndex
                          : log.logIndex !== undefined
                            ? Number(log.logIndex)
                            : undefined,
                      blockNumber:
                        typeof log.blockNumber === 'bigint'
                          ? log.blockNumber.toString()
                          : log.blockNumber !== undefined
                            ? String(log.blockNumber)
                            : undefined,
                      args,
                    },
                  });
                } catch (err) {
                  this.logger.error(
                    `Event-triggered execution failed for ${skill.name}: ${(err as Error).message}`,
                  );
                }
              }
            }
          },
        });

        this.unwatchFns.push(unwatch);
        this.logger.log(
          `Watching events for ${groupedSkills.length} skill(s): ${groupedSkills.map((skill) => skill.name).join(', ')}`,
        );
      } catch (err) {
        this.logger.error(
          `Failed to start watcher for ${groupedSkills.map((skill) => skill.name).join(', ')}: ${(err as Error).message}`,
        );
      }
    }
  }

  private serializeArgs(args: unknown): Record<string, unknown> {
    if (typeof args !== 'object' || args === null) {
      return {};
    }

    return Object.fromEntries(
      Object.entries(args as Record<string, unknown>).map(([key, value]) => [
        key,
        typeof value === 'bigint' ? value.toString() : value,
      ]),
    );
  }
}
