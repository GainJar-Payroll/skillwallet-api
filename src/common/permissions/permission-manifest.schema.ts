import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type PermissionManifestDoc = HydratedDocument<PermissionManifest>;

export const RuleEnforcementValues = [
  'allow-target',
  'deny-target',
  'deny-selector',
  'erc20-periodic-spend',
  'require-allow-target-or-deny-target',
] as const;
export type RuleEnforcement = (typeof RuleEnforcementValues)[number];

export const RuleSourceValues = [
  'backend-policy',
  'wallet-permission',
  'onchain-caveat',
  'ui-warning',
] as const;
export type RuleSource = (typeof RuleSourceValues)[number];

@Schema({ _id: false })
export class ManifestRule {
  @Prop({ required: true })
  id!: string;

  @Prop({ required: true, type: String, enum: RuleEnforcementValues })
  enforcement!: RuleEnforcement;

  @Prop({ required: true, type: String, enum: RuleSourceValues, default: 'backend-policy' })
  source!: RuleSource;

  @Prop({ required: true, type: Object })
  value!: {
    targets?: string[];
    selectors?: string[];
    token?: string;
    periodAmount?: string;
    periodDuration?: number;
  };

  @Prop({ type: String, default: '' })
  description!: string;
}

export const ManifestRuleSchema = SchemaFactory.createForClass(ManifestRule);

@Schema({
  collection: 'permission_manifests',
  timestamps: { createdAt: 'createdAt', updatedAt: false },
})
export class PermissionManifest {
  @Prop({ required: true, unique: true, index: true })
  manifestId!: string;

  @Prop({ required: true, index: true })
  installationId!: string;

  @Prop({ required: true })
  version!: string;

  @Prop({
    required: true,
    type: String,
    enum: ['active', 'revoked', 'rejected', 'expired'],
    default: 'active',
  })
  status!: 'active' | 'revoked' | 'rejected' | 'expired';

  @Prop({ required: true, type: [ManifestRuleSchema], default: [] })
  rules!: ManifestRule[];

  @Prop({ type: Object })
  raw?: Record<string, unknown>;
}

export const PermissionManifestSchema = SchemaFactory.createForClass(PermissionManifest);
PermissionManifestSchema.index({ installationId: 1, status: 1 });
