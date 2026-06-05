import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsMongoId, IsObject, IsOptional, IsString, Matches } from 'class-validator';

export class PrepareInstallationDto {
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

  @ApiPropertyOptional({
    description: 'Skill parameters used to scope the delegation',
    type: 'object',
    additionalProperties: true,
  })
  @IsOptional()
  @IsObject()
  parameters?: Record<string, unknown>;
}
