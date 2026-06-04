import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { PermissionManifest, PermissionManifestSchema } from './schemas/permission-manifest.schema';
import {
  WalletPermissionRequestRecord,
  WalletPermissionRequestSchema,
} from './schemas/wallet-permission-request.schema';
import {
  WalletPermissionGrantRecord,
  WalletPermissionGrantSchema,
} from './schemas/wallet-permission-grant.schema';
import { DelegationRecord, DelegationRecordSchema } from './schemas/delegation-record.schema';
import {
  WalletSupportCheckRecord,
  WalletSupportCheckSchema,
} from './schemas/wallet-support-check.schema';
import { PermissionCompilerService } from './permission-compiler.service';
import { PermissionSupportCheckerService } from './permission-support-checker.service';
import { PermissionsService } from './permissions.service';
import { PermissionsController } from './permissions.controller';
import { InstallationsModule } from '../installations/installations.module';
import { SkillsModule } from '../skills/skills.module';
import { ExecutorsModule } from '../executors/executors.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: PermissionManifest.name, schema: PermissionManifestSchema },
      { name: WalletPermissionRequestRecord.name, schema: WalletPermissionRequestSchema },
      { name: WalletPermissionGrantRecord.name, schema: WalletPermissionGrantSchema },
      { name: DelegationRecord.name, schema: DelegationRecordSchema },
      { name: WalletSupportCheckRecord.name, schema: WalletSupportCheckSchema },
    ]),
    InstallationsModule,
    SkillsModule,
    ExecutorsModule,
  ],
  providers: [PermissionCompilerService, PermissionSupportCheckerService, PermissionsService],
  controllers: [PermissionsController],
  exports: [PermissionCompilerService, PermissionsService, MongooseModule],
})
export class PermissionsModule {}
