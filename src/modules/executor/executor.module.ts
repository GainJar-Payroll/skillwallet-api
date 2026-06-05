import { Global, Module } from '@nestjs/common';
import { ExecutorService } from './executor.service';
import { ExecutorController } from './executor.controller';
import { HealthController } from './health.controller';

@Global()
@Module({
  controllers: [ExecutorController, HealthController],
  providers: [ExecutorService],
  exports: [ExecutorService],
})
export class ExecutorModule {}
