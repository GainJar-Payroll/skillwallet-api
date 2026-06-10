import { Module } from '@nestjs/common';
import { PimlicoService } from './pimlico.service';
import { PimlicoController } from './pimlico.controller';

@Module({
  controllers: [PimlicoController],
  providers: [PimlicoService],
  exports: [PimlicoService],
})
export class PimlicoModule {}
