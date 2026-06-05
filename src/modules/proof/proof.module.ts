import { Module } from '@nestjs/common';
import { ProofService } from './proof.service';
import { ProofController } from './proof.controller';
import { SkillsModule } from '../skills/skills.module';
import { DelegationModule } from '../delegation/delegation.module';
import { RunnerModule } from '../runner/runner.module';

@Module({
  imports: [SkillsModule, DelegationModule, RunnerModule],
  controllers: [ProofController],
  providers: [ProofService],
})
export class ProofModule {}
