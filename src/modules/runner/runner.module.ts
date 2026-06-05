import { Module } from '@nestjs/common';
import { RunnerService } from './runner.service';
import { CronRunnerService } from './cron.runner.service';
import { EventRunnerService } from './event.runner.service';
import { SkillsModule } from '../skills/skills.module';
import { InstallationsModule } from '../installations/installations.module';

@Module({
  imports: [SkillsModule, InstallationsModule],
  providers: [RunnerService, CronRunnerService, EventRunnerService],
  exports: [RunnerService],
})
export class RunnerModule {}
