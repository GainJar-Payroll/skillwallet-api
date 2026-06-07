import { ApiProperty } from '@nestjs/swagger';
import { IsNumber, IsObject, IsString } from 'class-validator';

export class SimulateEventDto {
  @ApiProperty({ example: 'usdc-inbound-dca-84532' })
  @IsString()
  skillId!: string;

  @ApiProperty({ example: 84532 })
  @IsNumber()
  chainId!: number;

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    example: {
      contractAddress: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
      eventSignature: 'Transfer(address indexed from,address indexed to,uint256 value)',
      txHash: '0xabababababababababababababababababababababababababababababababab',
      logIndex: 0,
      blockNumber: '0',
      args: {
        from: '0x0000000000000000000000000000000000000001',
        to: '0x0000000000000000000000000000000000000abc',
        value: '1000000',
      },
    },
  })
  @IsObject()
  event!: Record<string, unknown>;
}
