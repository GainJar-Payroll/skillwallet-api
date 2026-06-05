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

export class CreateSkillDto {
  @ApiProperty({ description: 'Display name of the skill', example: 'Generic DCA' })
  @IsString()
  name: string;

  @ApiProperty({
    description: 'Short marketing description for the skill catalog',
    example: 'Dollar-cost average USDC into a selected Base token on a fixed schedule.',
  })
  @IsString()
  description: string;

  @ApiProperty({
    description: 'URL for the skill icon (PNG/SVG)',
    example: 'https://raw.githubusercontent.com/spothq/cryptocurrency-icons/master/128/color/usdc.png',
  })
  @IsString()
  iconUrl: string;

  @ApiProperty({
    description: 'How the runner schedules this skill',
    enum: ['cron', 'event-trigger'],
    example: 'cron',
  })
  @IsIn(['cron', 'event-trigger'])
  runType: 'cron' | 'event-trigger';

  @ApiPropertyOptional({
    description: 'cron expression for cron-based skills (5-field Unix cron)',
    example: '0 9 * * *',
  })
  @IsOptional()
  @IsString()
  cronExpression?: string;

  @ApiPropertyOptional({
    description: 'Event trigger configuration for event-trigger skills',
    type: 'object',
    additionalProperties: true,
  })
  @IsOptional()
  @IsObject()
  eventTriggerConfig?: Record<string, unknown>;

  @ApiProperty({ description: 'EVM chain id where the skill runs', example: 84532 })
  @IsNumber()
  chainId: number;

  @ApiProperty({
    description: 'Delegation scope config used by the executor (targets, selectors, value limit, etc.)',
    type: 'object',
    additionalProperties: true,
  })
  @IsObject()
  delegationScope: Record<string, unknown>;

  @ApiPropertyOptional({
    description: 'Parameter declarations the UI renders',
    type: 'array',
    items: { type: 'object', additionalProperties: true },
  })
  @IsOptional()
  @IsArray()
  parameters?: unknown[];

  @ApiPropertyOptional({
    description: 'Free-form metadata (category, kind, risk, builtin flag, etc.)',
    type: 'object',
    additionalProperties: true,
  })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;

  @ApiPropertyOptional({ description: 'Whether the skill is currently listed', example: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
