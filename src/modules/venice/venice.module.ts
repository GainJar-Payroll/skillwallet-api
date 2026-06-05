import { Global, Module } from '@nestjs/common';
import { VeniceService } from './venice.service';

@Global()
@Module({
  providers: [VeniceService],
  exports: [VeniceService],
})
export class VeniceModule {}
