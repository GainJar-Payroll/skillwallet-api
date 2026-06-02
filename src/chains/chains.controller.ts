import { Controller, Get, Param, ParseIntPipe } from '@nestjs/common';
import { ChainsService } from './chains.service';

@Controller('chains')
export class ChainsController {
  constructor(private readonly chainsService: ChainsService) {}

  @Get()
  async list() {
    return this.chainsService.findAll();
  }

  @Get(':chainId')
  async getOne(@Param('chainId', ParseIntPipe) chainId: number) {
    return this.chainsService.findByChainId(chainId);
  }
}
