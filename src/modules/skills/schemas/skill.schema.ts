import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export class SkillParameter {
  key: string;
  label: string;
  type: 'select' | 'number' | 'boolean';
  required: boolean;
  options?: string[];
  defaultValue?: unknown;
  description?: string;
}

export class EventTriggerConfig {
  contractAddress: string;
  eventSignature: string;
  filterArgs?: Record<string, string>;
}

export class DelegationScopeConfig {
  type: string;
  targets?: string[];
  selectors?: string[];
  valueLte?: { maxValue: string };
  tokenAddress?: string;
  maxAmount?: string;
  [key: string]: unknown;
}

export type SkillDocument = Skill & Document;

@Schema({ timestamps: true, collection: 'skills' })
export class Skill {
  @Prop({ required: true })
  name: string;

  @Prop({ required: true })
  description: string;

  @Prop({ required: true })
  iconUrl: string;

  @Prop({ required: true, enum: ['cron', 'event-trigger'] })
  runType: 'cron' | 'event-trigger';

  @Prop()
  cronExpression?: string;

  @Prop({ type: Object })
  eventTriggerConfig?: EventTriggerConfig;

  @Prop({ required: true })
  chainId: number;

  @Prop({ required: true, type: Object })
  delegationScope: DelegationScopeConfig;

  @Prop({ type: [Object], default: [] })
  parameters: SkillParameter[];

  @Prop({ default: true })
  isActive: boolean;

  @Prop({ type: Object, default: {} })
  metadata: Record<string, unknown>;
}

export const SkillSchema = SchemaFactory.createForClass(Skill);
SkillSchema.index({ name: 1 });
