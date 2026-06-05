import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsMongoId, IsObject, IsOptional, IsString, Matches } from 'class-validator';

export class ConfirmInstallationDto {
  @ApiProperty({
    description: 'Mongo ObjectId of the skill being installed',
    example: '652f1f77bcf86cd799439011',
  })
  @IsMongoId()
  skillId: string;

  @ApiProperty({
    description: 'EVM address of the user installing the skill',
    example: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
  })
  @IsString()
  @Matches(/^0x[a-fA-F0-9]{40}$/, { message: 'userAddress must be a valid 0x address' })
  userAddress: string;

  @ApiProperty({
    description:
      'Signed delegation object as produced by MetaMask Smart Accounts Kit signDelegation',
    type: 'object',
    additionalProperties: true,
  })
  @IsObject()
  signedDelegation: Record<string, unknown>;

  @ApiProperty({
    description: 'Salt returned from /installations/prepare',
    example: '0xabc...',
  })
  @IsString()
  delegationSalt: string;

  @ApiPropertyOptional({
    description: 'Skill parameters (e.g. amountUsdc, outputToken for DCA)',
    type: 'object',
    additionalProperties: true,
  })
  @IsOptional()
  @IsObject()
  parameters?: Record<string, unknown>;
}
