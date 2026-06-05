import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type SkillDefinitionDocument = HydratedDocument<SkillDefinition>;
export type SkillDefinitionDoc = SkillDefinitionDocument;

export type SkillStatus = 'live' | 'adapter-ready' | 'coming-soon' | 'disabled' | 'internal';
export type PermissionPath = 'low-level-function-call-delegation';
export type SkillAdapterKind =
  | 'direct-router-dca'
  | 'gm-self-call'
  | 'dca'
  | 'aerodrome-vote'
  | 'lp-keeper'
  | 'x402-research'
  | 'internal-native-transfer-proof';
export type ExecutionMode = SkillAdapterKind;
export type ProofStatus = 'proven-on-base-sepolia' | 'not-proven' | 'target-production';

@Schema({ _id: false })
export class SupportedPair {
  @Prop({ required: true }) chainId!: number;
  @Prop({ required: true }) tokenIn!: string;
  @Prop({ required: true }) tokenOut!: string;
}
export const SupportedPairSchema = SchemaFactory.createForClass(SupportedPair);

@Schema({ _id: false })
export class SkillPricing {
  @Prop({ required: true, type: String, enum: ['free', 'fixed-duration'] })
  kind!: 'free' | 'fixed-duration';
  @Prop({ type: [Object], default: [] }) options?: Array<Record<string, unknown>>;
}
export const SkillPricingSchema = SchemaFactory.createForClass(SkillPricing);

@Schema({ _id: false })
export class SkillSchedule {
  @Prop({ type: [String], default: [] })
  supportedFrequencies!: string[];
}
export const SkillScheduleSchema = SchemaFactory.createForClass(SkillSchedule);

@Schema({ _id: false })
export class SkillMetadata {
  @Prop() proofTxHash?: string;
  @Prop({ type: Number }) proofChainId?: number;
  @Prop() proofRelayer?: string;
  @Prop() icon?: string;
  @Prop({ type: [String], default: [] }) tags?: string[];
  @Prop({ type: String, enum: ['low', 'medium', 'high'] })
  riskLevel?: 'low' | 'medium' | 'high';
}
export const SkillMetadataSchema = SchemaFactory.createForClass(SkillMetadata);

@Schema({ _id: false })
export class PermissionRequirement {
  @Prop({ required: true }) chainId!: number;
  @Prop({ required: true }) permissionType!: string;
  @Prop({ type: [String], required: true, default: [] }) requiredRuleTypes!: string[];
  @Prop({ default: true }) required?: boolean;
  @Prop() description?: string;
}
export const PermissionRequirementSchema = SchemaFactory.createForClass(PermissionRequirement);

@Schema({ timestamps: true, collection: 'skill_definitions' })
export class SkillDefinition {
  @Prop({ required: true, unique: true, index: true }) skillId!: string;
  @Prop({ required: true, index: true }) slug!: string;
  @Prop({ required: true }) name!: string;
  @Prop() description?: string;
  @Prop({
    required: true,
    type: String,
    enum: ['live', 'adapter-ready', 'coming-soon', 'disabled', 'internal'],
  })
  status!: SkillStatus;
  @Prop({ required: true, type: String, enum: ['low-level-function-call-delegation'] })
  permissionPath!: PermissionPath;
  @Prop({
    required: true,
    type: String,
    enum: [
      'direct-router-dca',
      'gm-self-call',
      'dca',
      'aerodrome-vote',
      'lp-keeper',
      'x402-research',
      'internal-native-transfer-proof',
    ],
  })
  adapter!: SkillAdapterKind;
  @Prop({
    type: String,
    enum: [
      'direct-router-dca',
      'gm-self-call',
      'dca',
      'aerodrome-vote',
      'lp-keeper',
      'x402-research',
      'internal-native-transfer-proof',
    ],
  })
  executionMode?: ExecutionMode;
  @Prop({
    required: true,
    type: String,
    enum: ['proven-on-base-sepolia', 'not-proven', 'target-production'],
  })
  proofStatus!: ProofStatus;
  @Prop({ type: [Number], required: true, default: [] })
  supportedChains!: number[];
  @Prop() defaultChainId?: number;
  @Prop({ type: String, enum: ['none', 'optional', 'required'] }) aiMode?: string;
  @Prop({ type: [PermissionRequirementSchema], default: [] })
  permissionRequirements?: PermissionRequirement[];
  @Prop({ type: Object }) permissionTemplate?: Record<string, unknown>;
  @Prop({ type: [SupportedPairSchema], default: [] })
  supportedPairs!: SupportedPair[];
  @Prop({ type: SkillPricingSchema, required: true })
  pricing!: SkillPricing;
  @Prop({ type: SkillScheduleSchema, required: true })
  schedule!: SkillSchedule;
  @Prop({ type: Object }) defaultSchedule?: Record<string, unknown>;
  @Prop({ type: SkillMetadataSchema, default: () => ({}) })
  metadata!: SkillMetadata;
  @Prop({ default: false }) builtIn?: boolean;
}

export const SkillDefinitionSchema = SchemaFactory.createForClass(SkillDefinition);
