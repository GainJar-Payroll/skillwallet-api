import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type DailySpendCounterDocument = DailySpendCounter & Document;

/**
 * Atomic per-day spend counter for an installation + token.
 *
 * `_id` is a composite key of the form
 *   `${installationId}:${tokenAddress.toLowerCase()}:${periodKey}`
 * which lets us do a single-document atomic `findOneAndUpdate` to check
 * and increment the daily held amount without read-then-write races.
 *
 * `used` is stored as a Number (Mongo $inc requires a numeric field).
 * Daily limit values in production are <= Number.MAX_SAFE_INTEGER (2^53 - 1).
 */
@Schema({ timestamps: true, collection: 'daily_spend_counters' })
export class DailySpendCounter {
  @Prop({ required: true })
  _id!: string;

  @Prop({ required: true, index: true })
  installationId!: string;

  @Prop({ required: true })
  tokenAddress!: string;

  @Prop({ required: true })
  periodKey!: string;

  @Prop({ required: true, type: Number, default: 0 })
  used!: number;
}

export const DailySpendCounterSchema = SchemaFactory.createForClass(DailySpendCounter);

DailySpendCounterSchema.index(
  { installationId: 1, tokenAddress: 1, periodKey: 1 },
  { unique: true, name: 'installationId_1_tokenAddress_1_periodKey_1' },
);

