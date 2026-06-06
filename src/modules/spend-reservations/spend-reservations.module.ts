import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { SpendReservationsService } from './spend-reservations.service';
import {
  SpendReservation,
  SpendReservationSchema,
} from './schemas/spend-reservation.schema';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: SpendReservation.name, schema: SpendReservationSchema }]),
  ],
  providers: [SpendReservationsService],
  exports: [SpendReservationsService, MongooseModule],
})
export class SpendReservationsModule {}
