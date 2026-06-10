import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { SponsorService } from './sponsor.service';
import { SponsorState, SponsorStateSchema } from './schemas/sponsor-state.schema';
import { OneShotModule } from '../oneshot/oneshot.module';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: SponsorState.name, schema: SponsorStateSchema }]),
    OneShotModule,
  ],
  providers: [SponsorService],
  exports: [SponsorService],
})
export class SponsorModule {}
