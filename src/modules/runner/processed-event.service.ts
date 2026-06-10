import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { getAddress } from 'viem';
import {
  ProcessedEvent,
  ProcessedEventDocument,
} from './schemas/processed-event.schema';

export interface ProcessedEventKey {
  chainId: number;
  contractAddress: string;
  txHash: string;
  logIndex: number;
}

@Injectable()
export class ProcessedEventService {
  private readonly logger = new Logger(ProcessedEventService.name);

  constructor(
    @InjectModel(ProcessedEvent.name)
    private readonly model: Model<ProcessedEventDocument>,
  ) {}

  async tryMarkProcessed(key: ProcessedEventKey): Promise<boolean> {
    if (
      typeof key.chainId !== 'number' ||
      typeof key.logIndex !== 'number' ||
      !key.contractAddress ||
      !key.txHash
    ) {
      throw new Error(
        `ProcessedEventService: invalid event key ${JSON.stringify(key)}`,
      );
    }

    const normalised = this.normaliseKey(key);

    try {
      await this.model.create({
        chainId: normalised.chainId,
        contractAddress: normalised.contractAddress,
        txHash: normalised.txHash,
        logIndex: normalised.logIndex,
        processedAt: new Date(),
      });
      return true;
    } catch (err) {
      if (this.isDuplicateKeyError(err)) {
        return false;
      }
      this.logger.error(
        `ProcessedEventService.tryMarkProcessed unexpected error: ${(err as Error).message}`,
      );
      throw err;
    }
  }

  private normaliseKey(key: ProcessedEventKey): ProcessedEventKey {
    return {
      chainId: key.chainId,
      contractAddress: this.normaliseString(key.contractAddress),
      txHash: this.normaliseString(key.txHash),
      logIndex: key.logIndex,
    };
  }

  private normaliseString(value: string): string {
    try {
      return getAddress(value).toLowerCase();
    } catch {
      return value.toLowerCase();
    }
  }

  private isDuplicateKeyError(err: unknown): boolean {
    if (!err || typeof err !== 'object') return false;
    const code = (err as { code?: unknown }).code;
    return code === 11000 || code === 11001;
  }
}
