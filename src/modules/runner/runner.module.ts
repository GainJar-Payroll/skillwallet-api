import { Module } from '@nestjs/common';
import { RunnerService } from './runner.service';
import { CronRunnerService } from './cron.runner.service';
import { EventRunnerService } from './event.runner.service';
import { SkillsModule } from '../skills/skills.module';
import { InstallationsModule } from '../installations/installations.module';
import { SpendReservationsModule } from '../spend-reservations/spend-reservations.module';
import { SkillEventHandlerService } from './skill-event-handler.service';

@Module({
  imports: [SkillsModule, InstallationsModule, SpendReservationsModule],
  providers: [RunnerService, CronRunnerService, EventRunnerService, SkillEventHandlerService],
  exports: [RunnerService, SkillEventHandlerService],
})
export class RunnerModule {}
