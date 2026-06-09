import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { RunnerService } from './runner.service';
import { CronRunnerService } from './cron.runner.service';
import { EventRunnerService } from './event.runner.service';
import { SkillEventHandlerService } from './skill-event-handler.service';
import { ProcessedEventService } from './processed-event.service';
import { ProcessedEvent, ProcessedEventSchema } from './schemas/processed-event.schema';
import { SkillsModule } from '../skills/skills.module';
import { InstallationsModule } from '../installations/installations.module';
import { SpendReservationsModule } from '../spend-reservations/spend-reservations.module';
import { SponsorModule } from '../sponsor/sponsor.module';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: ProcessedEvent.name, schema: ProcessedEventSchema }]),
    SkillsModule,
    InstallationsModule,
    SpendReservationsModule,
    SponsorModule,
  ],
  providers: [
    RunnerService,
    CronRunnerService,
    EventRunnerService,
    SkillEventHandlerService,
    ProcessedEventService,
  ],
  exports: [RunnerService, SkillEventHandlerService],
})
export class RunnerModule {}
