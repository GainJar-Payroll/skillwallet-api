import { Global, Module } from '@nestjs/common';
import { OneShotService } from './oneshot.service';

@Global()
@Module({
  providers: [OneShotService],
  exports: [OneShotService],
})
export class OneShotModule {}
