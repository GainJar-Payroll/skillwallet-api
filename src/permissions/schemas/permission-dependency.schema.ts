import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type PermissionDependencyDocument = HydratedDocument<PermissionDependencyRecord>;

@Schema({ _id: false })
export class PermissionDependencyRecord {
  @Prop({ required: true }) chainId!: number;
  @Prop() factory?: string;
  @Prop() factoryData?: string;
  @Prop({ required: true, default: '0x' }) deployedAddress?: string;
  @Prop({ required: true, default: '0x' }) txHash?: string;
  @Prop({
    required: true,
    enum: ['pending', 'deploying', 'deployed', 'failed', 'not_required'],
    default: 'pending',
  })
  status!: string;
  @Prop() deployTxHash?: string;
  @Prop() deployedAt?: Date;
  @Prop() error?: string;
}

export const PermissionDependencySchema = SchemaFactory.createForClass(PermissionDependencyRecord);
