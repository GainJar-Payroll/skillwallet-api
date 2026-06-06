import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type SpendReservationStatus = 'reserved' | 'confirmed' | 'released';

export type SpendReservationDocument = SpendReservation & Document;

@Schema({ timestamps: true, collection: 'spend_reservations' })
export class SpendReservation {
  @Prop({ required: true, index: true })
  installationId!: string;

  @Prop({ required: true, index: true })
  tokenAddress!: string;

  @Prop({ required: true, index: true })
  periodKey!: string;

  @Prop({ required: true })
  amount!: string;

  @Prop({ type: String, required: true, enum: ['reserved', 'confirmed', 'released'], index: true })
  status!: SpendReservationStatus;
}

export const SpendReservationSchema = SchemaFactory.createForClass(SpendReservation);

SpendReservationSchema.index({ installationId: 1, tokenAddress: 1, periodKey: 1, status: 1 });
