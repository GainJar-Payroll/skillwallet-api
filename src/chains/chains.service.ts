import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ChainConfig, ChainConfigDocument } from './chain-config.schema';
import { AppError } from '../common/errors/app-error';
import { ErrorCode } from '../common/errors/error-codes';

@Injectable()
export class ChainsService {
  private readonly logger = new Logger(ChainsService.name);

  constructor(
    @InjectModel(ChainConfig.name)
    private readonly chainModel: Model<ChainConfigDocument>,
  ) {}

  async findAll(): Promise<ChainConfig[]> {
    return this.chainModel.find().lean();
  }

  async findByChainId(chainId: number): Promise<ChainConfig> {
    const chain = await this.chainModel.findOne({ chainId }).lean();
    if (!chain) {
      throw new AppError(ErrorCode.NOT_FOUND, `Chain not found: ${chainId}`);
    }
    return chain;
  }

  async tryFindByChainId(chainId: number): Promise<ChainConfig | null> {
    return this.chainModel.findOne({ chainId }).lean();
  }

  async upsertBuiltIn(definitions: ChainConfig[]): Promise<void> {
    for (const def of definitions) {
      await this.chainModel.updateOne(
        { chainId: def.chainId },
        {
          $set: {
            name: def.name,
            rpcUrl: def.rpcUrl,
            delegationManagerAddress: def.delegationManagerAddress,
            usdcAddress: def.usdcAddress,
            wethAddress: def.wethAddress,
            swapRouterAddress: def.swapRouterAddress,
            metadata: def.metadata,
          },
          $setOnInsert: { chainId: def.chainId },
        },
        { upsert: true },
      );
    }
  }

  async ensureBuiltInsSeeded(): Promise<void> {
    const { builtInChains } = await import('./chain-definitions');
    await this.upsertBuiltIn(builtInChains);
  }
}
