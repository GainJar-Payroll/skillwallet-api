import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { SkillsModule } from '../skills/skills.module';
import { RunnerModule } from '../runner/runner.module';

@Module({
  imports: [SkillsModule, RunnerModule],
  controllers: [AdminController],
})
export class AdminModule {}
