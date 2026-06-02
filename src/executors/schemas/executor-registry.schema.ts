import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type ExecutorRegistryDocument = HydratedDocument<ExecutorRegistry>;

@Schema({ timestamps: true, collection: 'executor_registry' })
export class ExecutorRegistry {
  @Prop({ required: true, index: true }) adapter!: string;
  @Prop({ required: true, index: true }) chainId!: number;
  @Prop({ required: true }) executorAddress!: string;
  @Prop({ required: true, index: true }) executorAddressNormalized!: string;
  @Prop({ required: true, enum: ['active', 'disabled'], default: 'active' }) status!: string;
  @Prop() delegationManagerAddress?: string;
  @Prop({ type: Object, default: {} }) metadata!: Record<string, unknown>;
}

export const ExecutorRegistrySchema = SchemaFactory.createForClass(ExecutorRegistry);
ExecutorRegistrySchema.index({ chainId: 1 }, { unique: true });
ExecutorRegistrySchema.index({ executorAddressNormalized: 1, chainId: 1 });
