import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Skill, SkillSchema } from './schemas/skill.schema';
import { SkillsService } from './skills.service';
import { SkillsController } from './skills.controller';
import { Installation, InstallationSchema } from '../installations/schemas/installation.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Skill.name, schema: SkillSchema },
      { name: Installation.name, schema: InstallationSchema },
    ]),
  ],
  controllers: [SkillsController],
  providers: [SkillsService],
  exports: [SkillsService, MongooseModule],
})
export class SkillsModule {}
