import { Global, Module } from '@nestjs/common';
import { ExecutorService } from './executor.service';
import { ExecutorController } from './executor.controller';

@Global()
@Module({
  controllers: [ExecutorController],
  providers: [ExecutorService],
  exports: [ExecutorService],
})
export class ExecutorModule {}
