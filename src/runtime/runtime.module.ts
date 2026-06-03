import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ExecutionAttempt, ExecutionAttemptSchema } from './schemas/execution-attempt.schema';
import { ActivityLog, ActivityLogSchema } from './schemas/activity-log.schema';
import { ExecutionAttemptsService } from './execution-attempts.service';
import { ActivityLogService } from './activity-log.service';
import { AdapterRegistryService } from './adapters/adapter-registry.service';
import { DcaAdapter } from './adapters/dca.adapter';
import { AerodromeVoteAdapter } from './adapters/aerodrome-vote.adapter';
import { PolicyValidatorService } from './policy/policy-validator.service';
import { OneShotRelayerService } from './relayers/oneshot-relayer.service';
import { WebhookSignatureVerifier } from './relayers/webhook-signature-verifier.service';
import { OneShotBundleValidator } from './relayers/oneshot-bundle-validator';
import { OneshotWebhookController } from './relayers/oneshot-webhook.controller';
import { RunnerService } from './scheduler/runner.service';
import { SchedulerService } from './scheduler/scheduler.service';
import { RuntimeController } from './runtime.controller';
import { InstallationsModule } from '../installations/installations.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ExecutionAttempt.name, schema: ExecutionAttemptSchema },
      { name: ActivityLog.name, schema: ActivityLogSchema },
    ]),
    InstallationsModule,
  ],
  providers: [
    ExecutionAttemptsService,
    ActivityLogService,
    DcaAdapter,
    AerodromeVoteAdapter,
    AdapterRegistryService,
    PolicyValidatorService,
    OneShotRelayerService,
    WebhookSignatureVerifier,
    OneShotBundleValidator,
    RunnerService,
    SchedulerService,
  ],
  controllers: [RuntimeController, OneshotWebhookController],
  exports: [
    AdapterRegistryService,
    PolicyValidatorService,
    OneShotRelayerService,
    WebhookSignatureVerifier,
    OneShotBundleValidator,
    RunnerService,
    SchedulerService,
  ],
})
export class RuntimeModule {}
