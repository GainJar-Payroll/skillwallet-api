import { Module } from '@nestjs/common';
import { DelegationService } from './delegation.service';
import { ExecutorModule } from '../executor/executor.module';
import { OneShotModule } from '../oneshot/oneshot.module';

@Module({
  imports: [ExecutorModule, OneShotModule],
  providers: [DelegationService],
  exports: [DelegationService],
})
export class DelegationModule {}
