import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type ActivityLogDocument = HydratedDocument<ActivityLog>;

@Schema({ timestamps: true, collection: 'activity_logs' })
export class ActivityLog {
  @Prop({ required: true, index: true }) activityId!: string;
  @Prop({ index: true }) installationId?: string;
  @Prop() attemptId?: string;
  @Prop() userAddress?: string;
  @Prop() chainId?: number;
  @Prop({ required: true, index: true }) type!: string;
  @Prop({ required: true }) message!: string;
  @Prop({ type: Object, default: {} }) metadata!: Record<string, unknown>;
}

export const ActivityLogSchema = SchemaFactory.createForClass(ActivityLog);
ActivityLogSchema.index({ installationId: 1, createdAt: -1 });
ActivityLogSchema.index({ type: 1, createdAt: -1 });
