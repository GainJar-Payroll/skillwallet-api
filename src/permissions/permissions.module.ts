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
import { PermissionCompilerService } from './permission-compiler.service';
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
    ]),
    InstallationsModule,
    SkillsModule,
    ExecutorsModule,
  ],
  providers: [PermissionCompilerService, PermissionsService],
  controllers: [PermissionsController],
  exports: [PermissionCompilerService, PermissionsService, MongooseModule],
})
export class PermissionsModule {}
