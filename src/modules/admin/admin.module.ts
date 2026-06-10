import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { SkillsModule } from '../skills/skills.module';
import { RunnerModule } from '../runner/runner.module';
import { InstallationsModule } from '../installations/installations.module';

@Module({
  imports: [SkillsModule, RunnerModule, InstallationsModule],
  controllers: [AdminController],
})
export class AdminModule {}
