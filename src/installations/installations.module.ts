import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { SkillInstallation, SkillInstallationSchema } from './schemas/skill-installation.schema';
import {
  DelegationGrant,
  DelegationGrantSchema,
} from '../delegations/schemas/delegation-grant.schema';
import { InstallationsService } from './installations.service';
import { InstallationsController } from './installations.controller';
import { RuntimeModule } from '../runtime/runtime.module';
import { SkillsModule } from '../skills/skills.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: SkillInstallation.name, schema: SkillInstallationSchema },
      { name: DelegationGrant.name, schema: DelegationGrantSchema },
    ]),
    RuntimeModule,
    SkillsModule,
  ],
  providers: [InstallationsService],
  controllers: [InstallationsController],
  exports: [InstallationsService, MongooseModule],
})
export class InstallationsModule {}
