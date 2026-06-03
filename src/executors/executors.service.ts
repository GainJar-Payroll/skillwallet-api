import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ExecutorRegistry, ExecutorRegistryDocument } from './schemas/executor-registry.schema';
import { CreateExecutorDto, UpdateExecutorDto } from './dto/executor.dto';
import { AppError } from '../common/errors/app-error';
import { ErrorCode } from '../common/errors/error-codes';
import { normalizeAddress } from '../common/utils/address';

@Injectable()
export class ExecutorsService {
  constructor(
    @InjectModel(ExecutorRegistry.name)
    private readonly executorModel: Model<ExecutorRegistryDocument>,
  ) {}

  async findAll(): Promise<ExecutorRegistry[]> {
    return this.executorModel.find().lean();
  }

  async findById(id: string): Promise<ExecutorRegistry> {
    const exec = await this.executorModel.findById(id).lean();
    if (!exec) {
      throw new AppError(ErrorCode.NOT_FOUND, `Executor not found: ${id}`);
    }
    return exec;
  }

  async findActive(chainId: number): Promise<ExecutorRegistry | null> {
    return this.executorModel.findOne({ chainId, status: 'active' }).lean();
  }

  async ensureBuiltInsSeeded(): Promise<void> {
    // Get all supported chain IDs from DCA skill (MVP 1: DCA defines the chains)
    const supportedChainIds = [1, 10, 56, 130, 137, 143, 146, 8453, 11155111, 42161, 42220, 59144];
    const executorAddress =
      process.env.EXECUTOR_ADDRESS || '0x62ec02AC72f8cA92A03065C9C19a95a7D94CE42e';

    for (const chainId of supportedChainIds) {
      const existing = await this.executorModel.findOne({ chainId, status: 'active' }).lean();
      if (existing) {
        continue; // Already seeded
      }

      // Map chain ID to delegation manager address
      let delegationManagerAddress: string | undefined;
      if (chainId === 11155111) {
        delegationManagerAddress = '0xdb9B1e94B5b69Df7e401DDbedE43491141047dB3'; // Sepolia v1.3.0
      } else if (chainId === 8453) {
        delegationManagerAddress = '0xdb9644369c79C3633cDE70D2Df50d827D7dC7Dbc'; // Base
      }
      // For other chains, delegationManagerAddress remains undefined (to be set later)

      await this.executorModel.create({
        adapter: 'multi',
        chainId,
        executorAddress,
        executorAddressNormalized: normalizeAddress(executorAddress),
        delegationManagerAddress,
        status: 'active',
        metadata: {},
      });
    }
  }

  async create(input: CreateExecutorDto): Promise<ExecutorRegistry> {
    const existing = await this.executorModel.findOne({ chainId: input.chainId });
    if (existing) {
      throw new AppError(
        ErrorCode.CONFLICT,
        `Executor already registered for chainId=${input.chainId} (MVP 1: one executor per chain)`,
      );
    }
    const doc = await this.executorModel.create({
      adapter: input.adapter ?? 'multi',
      chainId: input.chainId,
      executorAddress: input.executorAddress,
      executorAddressNormalized: normalizeAddress(input.executorAddress),
      delegationManagerAddress: input.delegationManagerAddress,
      status: 'active',
      metadata: input.metadata ?? {},
    });
    return doc.toObject();
  }

  async update(id: string, input: UpdateExecutorDto): Promise<ExecutorRegistry> {
    const exec = await this.executorModel.findById(id);
    if (!exec) {
      throw new AppError(ErrorCode.NOT_FOUND, `Executor not found: ${id}`);
    }
    if (input.status) exec.status = input.status;
    if (input.delegationManagerAddress)
      exec.delegationManagerAddress = input.delegationManagerAddress;
    if (input.metadata) exec.metadata = { ...exec.metadata, ...input.metadata };
    await exec.save();
    return exec.toObject();
  }
}
