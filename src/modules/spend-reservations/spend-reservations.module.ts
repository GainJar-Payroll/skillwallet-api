import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { SpendReservationsService } from './spend-reservations.service';
import {
  SpendReservation,
  SpendReservationSchema,
} from './schemas/spend-reservation.schema';
import {
  DailySpendCounter,
  DailySpendCounterSchema,
} from './schemas/daily-spend-counter.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: SpendReservation.name, schema: SpendReservationSchema },
      { name: DailySpendCounter.name, schema: DailySpendCounterSchema },
    ]),
  ],
  providers: [SpendReservationsService],
  exports: [SpendReservationsService, MongooseModule],
})
export class SpendReservationsModule {}
