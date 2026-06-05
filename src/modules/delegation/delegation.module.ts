import { Module } from '@nestjs/common';
import { DelegationService } from './delegation.service';

@Module({
  providers: [DelegationService],
  exports: [DelegationService],
})
export class DelegationModule {}
