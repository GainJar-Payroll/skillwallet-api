import { Prop, SchemaFactory } from '@nestjs/mongoose';

export class AerodromeVoteSkillConfig {
  @Prop({ required: true, default: 'aerodrome-vote' }) type!: string;
  @Prop({ required: true }) veAeroTokenId!: string;
  @Prop({ required: true, enum: ['max-reward-density', 'risk-adjusted', 'balanced'] })
  strategy!: string;
  @Prop({ required: true, min: 1 }) maxPools!: number;
  @Prop() executionWindow?: {
    day: 'wednesday' | 'thursday';
    startUtcHour: number;
    endUtcHour: number;
  };
  @Prop({ required: true, default: false }) allowAiExplanation!: boolean;
}

export const AerodromeVoteSkillConfigSchema =
  SchemaFactory.createForClass(AerodromeVoteSkillConfig);
