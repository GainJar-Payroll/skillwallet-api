import { Global, Module } from '@nestjs/common';
import { X402Service } from './x402.service';

@Global()
@Module({
  providers: [X402Service],
  exports: [X402Service],
})
export class X402Module {}
