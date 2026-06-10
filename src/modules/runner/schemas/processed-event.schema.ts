import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

@Schema({ timestamps: true, collection: 'processed_events' })
export class ProcessedEvent {
  @Prop({ required: true, type: Number, index: true })
  chainId!: number;

  @Prop({ required: true, lowercase: true, trim: true })
  contractAddress!: string;

  @Prop({ required: true, lowercase: true, trim: true })
  txHash!: string;

  @Prop({ required: true, type: Number })
  logIndex!: number;

  @Prop({ type: Date, default: () => new Date() })
  processedAt?: Date;
}

export type ProcessedEventDocument = ProcessedEvent & Document;

export const ProcessedEventSchema = SchemaFactory.createForClass(ProcessedEvent);

ProcessedEventSchema.index(
  {
    chainId: 1,
    contractAddress: 1,
    txHash: 1,
    logIndex: 1,
  },
  { unique: true, name: 'processed_events_unique_event_key' },
);

ProcessedEventSchema.index({ processedAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 30 });
