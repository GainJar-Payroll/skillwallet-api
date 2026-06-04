import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

@Schema({ _id: false })
export class PermissionRequirement {
  @Prop({ required: true }) chainId!: number;
  @Prop({ required: true }) permissionType!: string;
  @Prop({ type: [String], required: true }) requiredRuleTypes!: string[];
  @Prop({ default: true }) required?: boolean;
  @Prop() description?: string;
}

export const PermissionRequirementSchema = SchemaFactory.createForClass(PermissionRequirement);

export type SkillDefinitionDocument = HydratedDocument<SkillDefinition>;

@Schema({ timestamps: true, collection: 'skill_definitions' })
export class SkillDefinition {
  @Prop({ required: true, unique: true, index: true })
  skillId!: string;

  @Prop({ required: true, unique: true, index: true })
  slug!: string;

  @Prop({ required: true })
  name!: string;

  @Prop({ required: true })
  description!: string;

  @Prop({
    required: true,
    enum: ['dca', 'aerodrome-vote', 'lp-keeper', 'x402-research', 'internal-native-transfer-proof'],
  })
  adapter!: string;

  @Prop({
    required: true,
    enum: ['live', 'adapter-ready', 'coming-soon', 'disabled', 'internal'],
    index: true,
  })
  status!: string;

  @Prop({ required: true, type: [Number] })
  supportedChains!: number[];

  @Prop({ required: true })
  defaultChainId!: number;

  @Prop({ required: true, enum: ['none', 'optional', 'required'] })
  aiMode!: string;

  @Prop({ type: [PermissionRequirementSchema], default: [] })
  permissionRequirements!: PermissionRequirement[];

  @Prop({ required: true, type: Object })
  permissionTemplate!: Record<string, unknown>;

  @Prop({ required: true, type: Object })
  pricing!: Record<string, unknown>;

  @Prop({ required: true, type: Object })
  defaultSchedule!: Record<string, unknown>;

  @Prop({ required: true, type: Object })
  metadata!: Record<string, unknown>;

  @Prop({ default: false })
  builtIn?: boolean;
}

export const SkillDefinitionSchema = SchemaFactory.createForClass(SkillDefinition);
