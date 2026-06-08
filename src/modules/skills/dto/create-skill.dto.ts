import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
} from 'class-validator';
import type { SkillLimitsConfig, SkillRunType, SkillTriggerConfig } from '../skill-config.types';
import type { SkillParameterDefinition } from '../skill-parameter.types';
import { DelegationScopeConfig, Skill } from '../schemas/skill.schema';

export class CreateSkillDto extends Skill {
  @ApiProperty({ description: 'Display name of the skill', example: 'Generic DCA' })
  @IsString()
  name!: string;

  @ApiProperty({
    description: 'Unique identifier for the skill + Chain Id',
    example: 'generic-dca-84532',
  })
  @IsString()
  skillId!: string;

  @ApiProperty({
    description: 'Short marketing description for the skill catalog',
    example: 'Dollar-cost average USDC into a selected Base token on a fixed schedule.',
  })
  @IsString()
  description!: string;

  @ApiProperty({
    description: 'URL for the skill icon (PNG/SVG)',
    example:
      'https://raw.githubusercontent.com/spothq/cryptocurrency-icons/master/128/color/usdc.png',
  })
  @IsString()
  iconUrl!: string;

  @ApiProperty({
    description: 'How the runner schedules this skill',
    enum: ['cron', 'event-trigger'],
    example: 'cron',
  })
  @IsIn(['cron', 'event-trigger'])
  runType!: SkillRunType;

  @ApiPropertyOptional({
    description: 'Trigger configuration for cron or event-trigger skills',
    type: 'object',
    additionalProperties: true,
  })
  @IsOptional()
  @IsObject()
  trigger!: SkillTriggerConfig;

  @ApiProperty({ description: 'EVM chain id where the skill runs', example: 84532 })
  @IsNumber()
  chainId!: number;

  @ApiProperty({
    description:
      'Delegation scope config used by the executor (targets, selectors, value limit, etc.)',
    type: 'object',
    additionalProperties: true,
  })
  @IsObject()
  delegationScope!: DelegationScopeConfig;

  @ApiPropertyOptional({
    description: 'Optional runtime limits for execution frequency or spend caps',
    type: 'object',
    additionalProperties: true,
  })
  @IsOptional()
  @IsObject()
  limits?: SkillLimitsConfig;

  @ApiPropertyOptional({
    description: 'Parameter declarations the UI renders',
    type: 'array',
    items: { type: 'object', additionalProperties: true },
  })
  @IsOptional()
  @IsArray()
  parameters!: SkillParameterDefinition[];

  @ApiPropertyOptional({
    description: 'Free-form metadata (category, kind, risk, builtin flag, etc.)',
    type: 'object',
    additionalProperties: true,
  })
  @IsOptional()
  @IsObject()
  metadata!: Record<string, unknown>;

  @ApiPropertyOptional({ description: 'Whether the skill is currently listed', example: true })
  @IsOptional()
  @IsBoolean()
  isActive!: boolean;
}
