import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Installation, InstallationSchema } from './schemas/installation.schema';
import { InstallationsService } from './installations.service';
import { InstallationsController } from './installations.controller';
import { SkillsModule } from '../skills/skills.module';
import { DelegationModule } from '../delegation/delegation.module';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Installation.name, schema: InstallationSchema }]),
    SkillsModule,
    DelegationModule,
  ],
  controllers: [InstallationsController],
  providers: [InstallationsService],
  exports: [InstallationsService, MongooseModule],
})
export class InstallationsModule {}
