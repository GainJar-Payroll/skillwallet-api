import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { SkillInstallation, SkillInstallationSchema } from './schemas/skill-installation.schema';
import { InstallationsService } from './installations.service';
import { InstallationsController } from './installations.controller';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: SkillInstallation.name, schema: SkillInstallationSchema }]),
  ],
  providers: [InstallationsService],
  controllers: [InstallationsController],
  exports: [InstallationsService, MongooseModule],
})
export class InstallationsModule {}
