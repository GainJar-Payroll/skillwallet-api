import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import {
  SkillRunEnum,
  type SkillLimitsConfig,
  type SkillRunType,
  type SkillTriggerConfig,
} from '../skill-config.types';
import type { SkillParameterDefinition } from '../skill-parameter.types';

export type SkillParameter = SkillParameterDefinition;

export class DelegationScopeConfig {
  type!: string;
  targets?: string[];
  selectors?: string[];
  valueLte?: { maxValue: string }; // Allow spend ETH
  tokenAddress?: string;
  maxAmount?: string;
  [key: string]: unknown;
}

export type SkillDocument = Skill & Document;

@Schema({ timestamps: true, collection: 'skills' })
export class Skill {
  @Prop({ required: true })
  name!: string;

  @Prop({ required: true })
  skillId!: string;

  @Prop({ required: true })
  description!: string;

  @Prop({ required: true })
  iconUrl!: string;

  @Prop({ required: true, type: String, enum: SkillRunEnum })
  runType!: SkillRunType;

  @Prop({ type: Object })
  trigger!: SkillTriggerConfig;

  @Prop({ type: Object })
  limits?: SkillLimitsConfig;

  @Prop({ required: true, index: true })
  chainId!: number;

  @Prop({ required: true, type: Object })
  delegationScope!: DelegationScopeConfig;

  @Prop({ type: [Object], default: [] })
  parameters!: SkillParameter[];

  @Prop({ default: true, index: true })
  isActive!: boolean;

  @Prop({ type: Object, default: {} })
  metadata!: Record<string, unknown>;
}

export const SkillSchema = SchemaFactory.createForClass(Skill);

SkillSchema.index({ name: 1, chainId: 1 }, { unique: true });
SkillSchema.index({ isActive: 1, chainId: 1 });
SkillSchema.index({ 'metadata.kind': 1, chainId: 1 });
