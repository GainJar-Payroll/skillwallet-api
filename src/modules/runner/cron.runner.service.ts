import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { parseExpression } from 'cron-parser';
import { RunnerService } from './runner.service';
import { InstallationsService } from '../installations/installations.service';
import { SkillsService } from '../skills/skills.service';
import { Installation } from '../installations/schemas/installation.schema';
import { Skill } from '../skills/schemas/skill.schema';

type WithId<T> = T & { _id: { toString(): string } };

@Injectable()
export class CronRunnerService {
  private readonly logger = new Logger(CronRunnerService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly runnerService: RunnerService,
    private readonly installationsService: InstallationsService,
    private readonly skillsService: SkillsService,
  ) {}

  @Cron('*/5 * * * *')
  async handleCron(): Promise<void> {
    if (!this.config.get<boolean>('runnerEnabled')) return;

    const due = await this.installationsService.findDueForExecution();
    this.logger.log(`Cron tick: ${due.length} installations due`);

    for (const instRaw of due) {
      const inst = instRaw as WithId<Installation>;
      const populatedSkill = inst.skillId as unknown as WithId<Skill>;
      if (populatedSkill?.runType && populatedSkill.runType !== 'cron') continue;

      const skillIdStr = populatedSkill?.skillId?.toString?.() ?? (inst.skillId as unknown as string);

      try {
        await this.runnerService.executeInstallation(inst._id.toString());
        const fresh = await this.skillsService.findById(skillIdStr);
        if (fresh.cronExpression) {
          const next = parseExpression(fresh.cronExpression, { currentDate: new Date() });
          await this.installationsService.updateNextExecution(
            inst._id.toString(),
            next.next().toDate(),
          );
        }
      } catch (err) {
        this.logger.error(
          `Execution failed for installation ${inst._id.toString()}: ${(err as Error).message}`,
        );
      }
    }
  }
}
