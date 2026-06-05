import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches } from 'class-validator';

export class OwnershipDto {
  @ApiProperty({
    description: 'EVM address of the user owning the installation',
    example: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
  })
  @IsString()
  @Matches(/^0x[a-fA-F0-9]{40}$/, { message: 'userAddress must be a valid 0x address' })
  userAddress: string;
}
