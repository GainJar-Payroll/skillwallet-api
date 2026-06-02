import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type SkillInstallationDocument = HydratedDocument<SkillInstallation>;

@Schema({ timestamps: true, collection: 'skill_installations' })
export class SkillInstallation {
  @Prop({ required: true, unique: true, index: true }) installationId!: string;
  @Prop({ required: true }) userAddress!: string;
  @Prop({ required: true, index: true }) userAddressNormalized!: string;
  @Prop({ required: true }) smartAccountAddress!: string;
  @Prop({ required: true, index: true }) smartAccountAddressNormalized!: string;
  @Prop({ required: true, index: true }) chainId!: number;
  @Prop({ required: true, index: true }) skillId!: string;
  @Prop({ required: true, index: true }) adapter!: string;
  @Prop({ required: true }) executorAddress!: string;
  @Prop({ required: true, index: true }) executorAddressNormalized!: string;
  @Prop({ required: true, enum: ['draft', 'pending_permission', 'permission_granted', 'active', 'paused', 'revoked', 'expired', 'error'], index: true }) status!: string;
  @Prop({ required: true, type: Object }) config!: Record<string, unknown>;
  @Prop({ required: true, type: Object }) permissionManifest!: Record<string, unknown>;
  @Prop({ type: Object }) walletPermissionRequest?: Record<string, unknown>;
  @Prop({ type: Object }) walletPermissionGrant?: Record<string, unknown>;
  @Prop({ type: Object }) delegation?: Record<string, unknown>;
  @Prop({ required: true, type: Object }) budget!: Record<string, unknown>;
  @Prop({ required: true, type: Object }) pricingPlan!: Record<string, unknown>;
  @Prop({ required: true, type: Object }) schedule!: Record<string, unknown>;
  @Prop({ required: true, type: Object }) runtime!: Record<string, unknown>;
}

export const SkillInstallationSchema = SchemaFactory.createForClass(SkillInstallation);
SkillInstallationSchema.index({ userAddressNormalized: 1, chainId: 1 });
SkillInstallationSchema.index({ smartAccountAddressNormalized: 1, chainId: 1 });
SkillInstallationSchema.index({ status: 1, 'schedule.nextRunAt': 1 });
SkillInstallationSchema.index({ skillId: 1, chainId: 1, status: 1 });
SkillInstallationSchema.index({ executorAddressNormalized: 1, chainId: 1 });
