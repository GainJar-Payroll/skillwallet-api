import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type SkillInstallationDocument = HydratedDocument<SkillInstallation>;
export type SkillInstallationDoc = SkillInstallationDocument;

export type InstallationStatus =
  | 'draft'
  | 'pending_support_check'
  | 'support_checked'
  | 'pending_permission'
  | 'permission_granted'
  | 'dependencies_pending'
  | 'pending_delegation'
  | 'active'
  | 'paused'
  | 'revoked'
  | 'expired'
  | 'error';

@Schema({ _id: false })
export class InstallationBudget {
  @Prop() maxSpendPerRun?: string;
  @Prop() maxRunsPerWeek?: number;
}
export const InstallationBudgetSchema = SchemaFactory.createForClass(InstallationBudget);

@Schema({ _id: false })
export class PricingPlan {
  @Prop({ required: true, default: 'free' }) plan!: string;
  @Prop() label?: string;
  @Prop() durationDays?: number;
  @Prop() skillFeeUsdc?: string;
}
export const PricingPlanSchema = SchemaFactory.createForClass(PricingPlan);

@Schema({ _id: false })
export class InstallationSchedule {
  @Prop({ required: true, type: String, enum: ['daily', 'weekly', 'monthly'] })
  frequency!: 'daily' | 'weekly' | 'monthly';
  @Prop({ type: Date, default: null }) nextRunAt?: Date | null;
  @Prop({ type: Date, default: null }) lastRunAt?: Date | null;
  @Prop({ type: String, default: 'UTC' }) timezone?: string;
}
export const InstallationScheduleSchema = SchemaFactory.createForClass(InstallationSchedule);

@Schema({ _id: false })
export class InstallationRuntime {
  @Prop({ type: Date }) lastSuccessAt?: Date;
  @Prop({ type: Date }) lastFailureAt?: Date;
  @Prop() lastAttemptId?: string;
  @Prop() lastTxHash?: string;
  @Prop({ default: 0 }) successCount!: number;
  @Prop({ default: 0 }) failureCount!: number;
  @Prop() oneShotTargetAddress?: string;
  @Prop() oneShotFeeCollector?: string;
  @Prop() paymentToken?: string;
  @Prop() oneShotRequiredPaymentAmount?: string;
}
export const InstallationRuntimeSchema = SchemaFactory.createForClass(InstallationRuntime);

@Schema({ timestamps: true, collection: 'skill_installations' })
export class SkillInstallation {
  @Prop({ required: true, unique: true, index: true }) installationId!: string;
  @Prop({ required: true, index: true }) userAddress!: string;
  @Prop({ index: true }) userAddressNormalized?: string;
  @Prop({ required: true, index: true }) smartAccountAddress!: string;
  @Prop({ index: true }) smartAccountAddressNormalized?: string;
  @Prop({ required: true, index: true }) chainId!: number;
  @Prop({ index: true }) skillId?: string;
  @Prop({ index: true }) adapter?: string;
  @Prop() executorAddress?: string;
  @Prop({ index: true }) executorAddressNormalized?: string;
  @Prop({ required: true, index: true }) skillType!: string;
  @Prop({
    required: true,
    type: String,
    enum: [
      'draft',
      'pending_support_check',
      'support_checked',
      'pending_permission',
      'permission_granted',
      'dependencies_pending',
      'pending_delegation',
      'active',
      'paused',
      'revoked',
      'expired',
      'error',
    ],
    index: true,
  })
  status!: InstallationStatus;
  @Prop({ type: Object, required: true }) config!: Record<string, unknown>;
  @Prop({ type: Object }) permissionManifest?: Record<string, unknown>;
  @Prop({ type: Object }) walletSupportCheck?: Record<string, unknown>;
  @Prop({ type: Object }) walletPermissionRequest?: Record<string, unknown>;
  @Prop({ type: Object }) walletPermissionGrant?: Record<string, unknown>;
  @Prop({ type: [Object], default: [] }) dependencies?: Array<Record<string, unknown>>;
  @Prop({ type: Object }) delegation?: Record<string, unknown>;
  @Prop({ type: InstallationBudgetSchema }) budget?: InstallationBudget;
  @Prop({ type: PricingPlanSchema, required: true }) pricing!: PricingPlan;
  @Prop({ type: Object }) pricingPlan?: Record<string, unknown>;
  @Prop({ type: InstallationScheduleSchema, required: true }) schedule!: InstallationSchedule;
  @Prop({ type: InstallationRuntimeSchema, default: () => ({}) }) runtime?: InstallationRuntime;
  @Prop() tokenInSymbol?: string;
  @Prop() tokenOutSymbol?: string;
  @Prop() error?: string;
}

export const SkillInstallationSchema = SchemaFactory.createForClass(SkillInstallation);
SkillInstallationSchema.index({ userAddress: 1, chainId: 1 });
SkillInstallationSchema.index({ smartAccountAddress: 1, chainId: 1 });
SkillInstallationSchema.index({ skillId: 1, chainId: 1 });
SkillInstallationSchema.index({ status: 1, 'schedule.nextRunAt': 1 }, { sparse: true });
