import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type DelegationGrantDocument = HydratedDocument<DelegationGrant>;
export type DelegationGrantDoc = DelegationGrantDocument;

export type DelegationStandard = 'low-level-function-call';
export type DelegationStatus = 'redeemable' | 'revoked' | 'expired';

@Schema({ _id: false })
export class CaveatRecord {
  @Prop({ required: true }) enforcer!: string;
  @Prop({ required: true }) terms!: string;
  @Prop({ required: true }) args!: string;
}
export const CaveatRecordSchema = SchemaFactory.createForClass(CaveatRecord);

@Schema({
  timestamps: { createdAt: 'createdAt', updatedAt: false },
  collection: 'delegation_grants',
})
export class DelegationGrant {
  @Prop({ required: true, unique: true, index: true }) grantId!: string;
  @Prop({ required: true, index: true }) installationId!: string;
  @Prop({ required: true, type: String, enum: ['low-level-function-call'] })
  standard!: DelegationStandard;
  @Prop({
    required: true,
    type: String,
    enum: ['redeemable', 'revoked', 'expired'],
    index: true,
  })
  status!: DelegationStatus;
  @Prop({ required: true, index: true }) chainId!: number;
  @Prop({ required: true }) delegator!: string;
  @Prop({ required: true }) delegate!: string;
  @Prop({ type: [Object], required: true, default: [] })
  permissionContext!: Array<Record<string, unknown>>;
  @Prop({ type: [CaveatRecordSchema], default: [] }) caveats!: CaveatRecord[];
  @Prop({ type: Object }) delegationScope?: Record<string, unknown>;
  @Prop({ type: Object }) constraints?: Record<string, unknown>;
  @Prop() signature?: string;
  @Prop() authority?: string;
  @Prop({ type: Date }) expiresAt?: Date;
  @Prop({ type: Date, default: null }) revokedAt?: Date | null;
}

export const DelegationGrantSchema = SchemaFactory.createForClass(DelegationGrant);
DelegationGrantSchema.index({ installationId: 1, status: 1 });
DelegationGrantSchema.index({ delegator: 1, chainId: 1 });
DelegationGrantSchema.index({ delegate: 1, chainId: 1 });
