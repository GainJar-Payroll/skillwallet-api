import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEthereumAddress, IsNotEmpty, IsOptional, IsString, Matches } from 'class-validator';
import type { SkillParameterInputPayload } from '../../skills/skill-parameter.types';
import { IsEvmAddress } from 'src/common/validator/is-evm-address';

export class PrepareInstallationDto {
  @ApiProperty({
    description: 'Public skillId defined by the skill catalog',
    example: 'custom-cron-dca-84532',
  })
  @IsString()
  @IsNotEmpty()
  skillId!: string;

  @ApiProperty({
    description: 'EOA address of the user installing the skill',
    example: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
  })
  @IsEvmAddress()
  @Matches(/^0x[a-fA-F0-9]{40}$/, {
    message: 'userAddress must be a valid 0x address',
  })
  userAddress!: `0x${string}`;

  @ApiProperty({
    description: 'MetaMask Hybrid Smart Account address. This is the real delegation delegator.',
    example: '0x1234567890123456789012345678901234567890',
  })
  @IsEvmAddress()
  @Matches(/^0x[a-fA-F0-9]{40}$/, {
    message: 'smartAccountAddress must be a valid 0x address',
  })
  smartAccountAddress!: `0x${string}`;

  @ApiPropertyOptional({
    description: 'Skill parameters used to scope the delegation',
    type: 'object',
    additionalProperties: true,
  })
  @IsOptional()
  parameters!: SkillParameterInputPayload;
}
