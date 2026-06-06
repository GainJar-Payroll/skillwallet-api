import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Matches,
} from 'class-validator';

export class PrepareInstallationDto {
  @ApiProperty({
    description: 'Public skillId defined by the skill catalog',
    example: 'generic-dca-84532',
  })
  @IsString()
  @IsNotEmpty()
  skillId!: string;

  @ApiProperty({
    description: 'EOA address of the user installing the skill',
    example: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
  })
  @IsString()
  @Matches(/^0x[a-fA-F0-9]{40}$/, {
    message: 'userAddress must be a valid 0x address',
  })
  userAddress!: string;

  @ApiProperty({
    description: 'MetaMask Hybrid Smart Account address. This is the real delegation delegator.',
    example: '0x1234567890123456789012345678901234567890',
  })
  @IsString()
  @Matches(/^0x[a-fA-F0-9]{40}$/, {
    message: 'smartAccountAddress must be a valid 0x address',
  })
  smartAccountAddress!: string;

  @ApiPropertyOptional({
    description: 'Expected chain id. If provided, it must match the selected skill chainId.',
    example: 84532,
  })
  @IsOptional()
  @IsInt()
  chainId?: number;

  @ApiPropertyOptional({
    description: 'Skill parameters/config used by frontend proof flow',
    type: 'object',
    additionalProperties: true,
  })
  @IsOptional()
  @IsObject()
  config?: Record<string, unknown>;

  @ApiPropertyOptional({
    description: 'Skill parameters used to scope the delegation',
    type: 'object',
    additionalProperties: true,
  })
  @IsOptional()
  @IsObject()
  parameters?: Record<string, unknown>;
}
