import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsNotEmpty, IsObject, IsOptional, IsString, Matches } from 'class-validator';
import type { SkillParameterInputPayload } from '../../skills/skill-parameter.types';
import { IsEvmAddress } from 'src/common/validator/is-evm-address';

export class ConfirmInstallationDto {
  @ApiProperty({
    description: 'Public skillId of the skill being installed',
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
  userAddress!: string;

  @ApiProperty({
    description:
      'Hybrid Smart Account address. signedDelegation.delegator must match this.',
    example: '0x1234567890123456789012345678901234567890',
  })
  @IsEvmAddress()
  smartAccountAddress!: string;

  @ApiPropertyOptional({
    description: 'Expected chain id. If provided, it must match the selected skill chainId.',
    example: 84532,
  })
  @IsOptional()
  @IsInt()
  chainId?: number;

  @ApiProperty({
    description:
      'Signed delegation object as produced by ERC-4337 delegation framework',
    type: 'object',
    additionalProperties: true,
  })
  @IsObject()
  signedDelegation!: Record<string, unknown>;

  @ApiProperty({
    description: 'Salt returned from /installations/prepare',
    example: '0xabc...',
  })
  @IsString()
  delegationSalt!: string;

  @ApiPropertyOptional({
    description: 'Skill parameters, for example amountPerRun/tokenOut/router',
    type: 'object',
    additionalProperties: true,
  })
  @IsOptional()
  parameters!: SkillParameterInputPayload;
}
