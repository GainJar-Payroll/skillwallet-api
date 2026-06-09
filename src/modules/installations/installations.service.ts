import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, PopulateOptions, Types } from 'mongoose';
import { Address, getAddress } from 'viem';
import {
  Installation,
  type InstallationDocument,
  type ExecutionRecord,
} from './schemas/installation.schema';
import { SkillsService } from '../skills/skills.service';
import { DelegationService } from '../delegation/delegation.service';
import { type PrepareInstallationDto } from './dto/prepare-installation.dto';
import { type ConfirmInstallationDto } from './dto/confirm-installation.dto';
import { validateSkillParameters } from '../skills/skill-parameter-validation';
import { getExplorerTxUrl } from '../../config/chains.config';

export interface PrepareInstallationResponse {
  delegation: Record<string, unknown>;
  salt: `0x${string}`;
  skillId: string;
  executorAddress: `0x${string}`;
  chainId: number;
}

export interface InstallationExecutionsResponse {
  installationId: string;
  chainId: number;
  latest: ExecutionProof | null;
  data: ExecutionRecord[];
}

export interface ExecutionProof {
  executionId: string | undefined;
  status: ExecutionRecord['status'];
  oneShotTaskId: string | undefined;
  txHash: string | undefined;
  explorerUrl: string | undefined;
  executedAt: Date;
  completedAt: Date | undefined;
}

export interface FindInstallationsOptions {
  chainId?: number;
  smartAccountAddress?: string;
}

@Injectable()
export class InstallationsService {
  private readonly skillPopulate: PopulateOptions = {
    path: 'skillId',
    model: 'Skill',
    localField: 'skillId',
    foreignField: 'skillId',
    justOne: true,
    select: 'skillId name iconUrl runType chainId',
  };

  constructor(
    @InjectModel(Installation.name)
    private readonly installationModel: Model<InstallationDocument>,
    private readonly skillsService: SkillsService,
    private readonly delegationService: DelegationService,
  ) {}

  async prepareInstallation(dto: PrepareInstallationDto): Promise<PrepareInstallationResponse> {
    const skill = await this.skillsService.findById(dto.skillId);
    if (!skill.isActive) throw new BadRequestException('Skill is not active');

    await this.assertNoActiveDuplicate({
      userAddress: dto.userAddress,
      smartAccountAddress: dto.smartAccountAddress,
      skillId: skill.skillId,
    });

    validateSkillParameters(skill.parameters, dto.parameters);

    const salt = this.delegationService.generateSalt();
    const delegation = (await this.delegationService.prepare(
      skill,
      dto.smartAccountAddress,
      salt,
    )) as unknown as Record<string, unknown>;

    return {
      delegation,
      salt,
      skillId: skill.skillId,
      executorAddress: delegation.delegate as Address,
      chainId: skill.chainId,
    };
  }

  async confirmInstallation(dto: ConfirmInstallationDto): Promise<Installation> {
    const skill = await this.skillsService.findById(dto.skillId);
    if (!skill.isActive) throw new BadRequestException('Skill is not active');

    const userAddress = getAddress(dto.userAddress) as `0x${string}`;
    const smartAccountAddress = getAddress(dto.smartAccountAddress) as `0x${string}`;

    await this.assertNoActiveDuplicate({
      userAddress,
      smartAccountAddress,
      skillId: skill.skillId,
    });

    const validatedParameters = validateSkillParameters(skill.parameters, dto.parameters);

    // Re-derive the expected delegation server-side to verify the client signed
    // the correct delegation (right delegate = 1Shot targetAddress, right scope).
    const expected = (await this.delegationService.prepare(
      skill,
      smartAccountAddress,
      dto.delegationSalt as `0x${string}`,
    )) as unknown as Record<string, unknown>;

    try {
      this.delegationService.validateDelegationShape(
        dto.signedDelegation,
        smartAccountAddress,
        getAddress(expected.delegate as string) as `0x${string}`,
      );
    } catch (err) {
      throw new BadRequestException(`Invalid delegation: ${(err as Error).message}`);
    }

    if (
      (dto.signedDelegation.salt as string)?.toLowerCase() !==
      (expected.salt as string)?.toLowerCase()
    ) {
      throw new BadRequestException('Delegation salt mismatch');
    }

    const created = await this.installationModel.create({
      userAddress,
      smartAccountAddress,
      skillId: skill.skillId,
      signedDelegation: dto.signedDelegation,
      delegationSalt: dto.delegationSalt,
      chainId: skill.chainId,
      parameters: validatedParameters,
      status: 'active',
    });

    return created.toObject();
  }

  async findByUser(
    userAddress: string,
    options: FindInstallationsOptions = {},
  ): Promise<Installation[]> {
    if (options.chainId !== undefined && !Number.isInteger(options.chainId)) {
      throw new BadRequestException('chainId must be an integer');
    }

    return this.installationModel
      .find({
        userAddress: getAddress(userAddress),
        ...(options.chainId !== undefined && { chainId: options.chainId }),
        ...(options.smartAccountAddress && {
          smartAccountAddress: getAddress(options.smartAccountAddress),
        }),
      })
      .populate(this.skillPopulate)
      .lean()
      .exec();
  }

  async findById(id: string): Promise<Installation> {
    const inst = await this.installationModel
      .findById(id)
      .populate(this.skillPopulate)
      .lean()
      .exec();
    if (!inst) throw new NotFoundException('Installation not found');
    return inst;
  }

  async findByIdRaw(id: string): Promise<InstallationDocument | null> {
    return this.installationModel.findById(id).exec();
  }

  async pause(id: string, userAddress: string): Promise<Installation> {
    return this.setStatus(id, userAddress, 'paused');
  }

  async resume(id: string, userAddress: string): Promise<Installation> {
    return this.setStatus(id, userAddress, 'active');
  }

  async revoke(id: string, userAddress: string): Promise<void> {
    await this.setStatus(id, userAddress, 'revoked');
  }

  async appendExecution(id: string, record: ExecutionRecord): Promise<void> {
    const doc = await this.installationModel.findById(id).exec();
    if (!doc) throw new NotFoundException('Installation not found');

    doc.executions.unshift(record);
    if (doc.executions.length > 50) doc.executions = doc.executions.slice(0, 50);

    doc.lastExecutedAt = record.executedAt;
    doc.markModified('executions');
    await doc.save();
  }

  async updateExecution(
    id: string,
    executionId: string,
    patch: Partial<ExecutionRecord>,
  ): Promise<void> {
    const doc = await this.installationModel.findById(id).exec();
    if (!doc) return;

    const target = doc.executions.find((e) => e.executionId === executionId);
    if (!target) return;

    Object.assign(target, patch);
    doc.markModified('executions');
    await doc.save();
  }

  async updateNextExecution(id: string, nextAt: Date): Promise<void> {
    await this.installationModel
      .updateOne({ _id: new Types.ObjectId(id) }, { $set: { nextExecutionAt: nextAt } })
      .exec();
  }

  async findDueForExecution(): Promise<Installation[]> {
    const now = new Date();
    return this.installationModel
      .find({
        status: 'active',
        $or: [
          { nextExecutionAt: { $lte: now } },
          { nextExecutionAt: { $exists: false } },
          { nextExecutionAt: null },
        ],
      })
      .populate(this.skillPopulate)
      .lean()
      .exec();
  }

  async findActiveBySkillId(skillId: string): Promise<Installation[]> {
    return this.installationModel.find({ status: 'active', skillId }).lean().exec();
  }

  async findExecutions(id: string): Promise<InstallationExecutionsResponse> {
    const doc = await this.installationModel.findById(id).lean().exec();
    if (!doc) throw new NotFoundException('Installation not found');

    const executions = doc.executions ?? [];
    const latest = executions[0];

    return {
      installationId: id,
      chainId: doc.chainId,
      latest: latest
        ? {
            executionId: latest.executionId,
            status: latest.status,
            oneShotTaskId: latest.oneShotTaskId,
            txHash: latest.txHash,
            explorerUrl: getExplorerTxUrl(doc.chainId, latest.txHash),
            executedAt: latest.executedAt,
            completedAt: latest.completedAt,
          }
        : null,
      data: executions.map((e) => ({ ...e, explorerUrl: getExplorerTxUrl(doc.chainId, e.txHash) })),
    };
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  private async assertNoActiveDuplicate(input: {
    userAddress: string;
    smartAccountAddress: string;
    skillId: string;
  }): Promise<void> {
    const existing = await this.installationModel
      .findOne({
        userAddress: input.userAddress,
        smartAccountAddress: input.smartAccountAddress,
        skillId: input.skillId,
        status: { $in: ['active', 'paused'] },
      })
      .lean()
      .exec();

    if (existing) {
      throw new ConflictException(
        `Skill already installed for this smart account. installationId=${existing._id}`,
      );
    }
  }

  private async setStatus(
    id: string,
    userAddress: string,
    status: 'active' | 'paused' | 'revoked',
  ): Promise<Installation> {
    const inst = await this.installationModel.findById(id).exec();
    if (!inst) throw new NotFoundException('Installation not found');

    if (getAddress(inst.userAddress) !== getAddress(userAddress)) {
      throw new ForbiddenException('Caller is not the owner of this installation');
    }

    inst.status = status;
    await inst.save();
    return inst.toObject();
  }
}
