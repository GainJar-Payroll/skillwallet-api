import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AbiEvent, parseAbiItem } from 'viem';
import { ExecutorService } from '../executor/executor.service';
import { SkillsService } from '../skills/skills.service';
import { InstallationsService } from '../installations/installations.service';
import { RunnerService } from './runner.service';
import { Installation } from '../installations/schemas/installation.schema';
import { Skill } from '../skills/schemas/skill.schema';

type WithId<T> = T & { _id: { toString(): string } };

@Injectable()
export class EventRunnerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(EventRunnerService.name);
  private unwatchFns: Array<() => void> = [];

  constructor(
    private readonly config: ConfigService,
    private readonly executorService: ExecutorService,
    private readonly skillsService: SkillsService,
    private readonly installationsService: InstallationsService,
    private readonly runnerService: RunnerService,
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
    const eventSkills = skills.filter((s) => s.runType === 'event-trigger');

    for (const skill of eventSkills) {
      const cfg = skill.eventTriggerConfig;
      if (!cfg?.contractAddress || !cfg.eventSignature) continue;

      try {
        const publicClient = this.executorService.getPublicClient(skill.chainId);
        const unwatch = publicClient.watchEvent({
          address: cfg.contractAddress as `0x${string}`,
          event: parseAbiItem(cfg.eventSignature) as AbiEvent,
          onLogs: async () => {
            this.logger.log(`Event trigger fired for skill ${skill.name}`);
            const installations = (await this.installationsService.findActiveBySkillId(
              skill.skillId,
            )) as Array<WithId<Installation>>;
            for (const inst of installations) {
              try {
                await this.runnerService.executeInstallation(inst._id.toString());
              } catch (err) {
                this.logger.error(
                  `Event-triggered execution failed: ${(err as Error).message}`,
                );
              }
            }
          },
        });
        this.unwatchFns.push(unwatch);
        this.logger.log(`Watching events for skill: ${skill.name}`);
      } catch (err) {
        this.logger.error(
          `Failed to start watcher for ${skill.name}: ${(err as Error).message}`,
        );
      }
    }
  }
}
