import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { OneShotRelayerService } from './relayers/oneshot-relayer.service';
import { OneShotBundleValidator } from './relayers/oneshot-bundle-validator';
import { AdapterRegistryService } from './adapters/adapter-registry.service';
import { DirectRouterDcaAdapter } from './adapters/direct-router-dca.adapter';
import { GmSelfCallAdapter } from './adapters/gm-self-call.adapter';
import { PolicyValidatorService } from './policy/policy-validator.service';
import { SchedulerService } from './scheduler/scheduler.service';
import { RunnerService } from './scheduler/runner.service';
import { QuoterV2Service } from './quoter/quoter-v2.service';
import { RuntimeController } from './runtime.controller';
import { ExecutionAttempt, ExecutionAttemptSchema } from './schemas/execution-attempt.schema';
import { ActivityLog, ActivityLogSchema } from './schemas/activity-log.schema';
import {
  PermissionManifest,
  PermissionManifestSchema,
} from '../common/permissions/permission-manifest.schema';
import {
  SkillInstallation,
  SkillInstallationSchema,
} from '../installations/schemas/skill-installation.schema';
import {
  DelegationGrant,
  DelegationGrantSchema,
} from '../delegations/schemas/delegation-grant.schema';
import { InstallationsService } from 'src/installations/installations.service';
import { ActivityLogService } from './activity-log.service';
import { SkillsModule } from 'src/skills/skills.module';
import { ExecutionAttemptsService } from './execution-attempts.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ExecutionAttempt.name, schema: ExecutionAttemptSchema },
      { name: ActivityLog.name, schema: ActivityLogSchema },
      { name: PermissionManifest.name, schema: PermissionManifestSchema },
      { name: SkillInstallation.name, schema: SkillInstallationSchema },
      { name: DelegationGrant.name, schema: DelegationGrantSchema },
    ]),
    SkillsModule,
  ],
  providers: [
    ExecutionAttemptsService,
    OneShotRelayerService,
    OneShotBundleValidator,
    AdapterRegistryService,
    DirectRouterDcaAdapter,
    GmSelfCallAdapter,
    PolicyValidatorService,
    SchedulerService,
    RunnerService,
    QuoterV2Service,
    InstallationsService,
    ActivityLogService,
  ],
  controllers: [RuntimeController],
  exports: [
    ExecutionAttemptsService,
    OneShotRelayerService,
    OneShotBundleValidator,
    AdapterRegistryService,
    DirectRouterDcaAdapter,
    GmSelfCallAdapter,
    PolicyValidatorService,
    SchedulerService,
    RunnerService,
    QuoterV2Service,
    MongooseModule,
    InstallationsService,
    ActivityLogService,
  ],
})
export class RuntimeModule {}
