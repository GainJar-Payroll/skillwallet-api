import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, PopulateOptions, Types } from 'mongoose';
import { getAddress } from 'viem';
import { Installation, InstallationDocument, ExecutionRecord } from './schemas/installation.schema';
import { SkillsService } from '../skills/skills.service';
import { DelegationService } from '../delegation/delegation.service';
import { PrepareInstallationDto } from './dto/prepare-installation.dto';
import { ConfirmInstallationDto } from './dto/confirm-installation.dto';

export interface PrepareInstallationResponse {
  delegation: Record<string, unknown>;
  salt: `0x${string}`;
  skillId: string;
  executorAddress: `0x${string}`;
  chainId: number;
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

    if (!skill.isActive) {
      throw new BadRequestException('Skill is not active');
    }

    const userAddress = getAddress(dto.userAddress) as `0x${string}`;
    const smartAccountAddress = getAddress(dto.smartAccountAddress) as `0x${string}`;

    await this.assertNoActiveDuplicate({
      userAddress,
      smartAccountAddress,
      skillId: skill.skillId,
    });

    const salt = this.delegationService.generateSalt();

    const delegation = (await this.delegationService.prepare(
      skill,
      smartAccountAddress,
      salt,
    )) as unknown as Record<string, unknown>;

    return {
      delegation,
      salt,
      skillId: skill.skillId,
      executorAddress: delegation.delegate as `0x${string}`,
      chainId: skill.chainId,
    };
  }

  async confirmInstallation(dto: ConfirmInstallationDto): Promise<Installation> {
    const skill = await this.skillsService.findById(dto.skillId);

    if (!skill.isActive) {
      throw new BadRequestException('Skill is not active');
    }

    const userAddress = getAddress(dto.userAddress) as `0x${string}`;
    const smartAccountAddress = getAddress(dto.smartAccountAddress) as `0x${string}`;

    await this.assertNoActiveDuplicate({
      userAddress,
      smartAccountAddress,
      skillId: skill.skillId,
    });

    const expected = (await this.delegationService.prepare(
      skill,
      smartAccountAddress,
      dto.delegationSalt as `0x${string}`,
    )) as unknown as Record<string, unknown>;

    const expectedDelegate = getAddress(expected.delegate as string) as `0x${string}`;

    try {
      this.delegationService.validateDelegationShape(
        dto.signedDelegation,
        smartAccountAddress,
        expectedDelegate,
      );
    } catch (err) {
      throw new BadRequestException(`Invalid delegation signature: ${(err as Error).message}`);
    }

    if (
      (dto.signedDelegation.salt as string)?.toLowerCase() !==
      (expected.salt as string)?.toLowerCase()
    ) {
      throw new BadRequestException('Delegation salt mismatch');
    }

    if (
      getAddress(dto.signedDelegation.delegator as string) !==
      getAddress(expected.delegator as string)
    ) {
      throw new BadRequestException('Delegation delegator mismatch');
    }

    if (
      getAddress(dto.signedDelegation.delegate as string) !==
      getAddress(expected.delegate as string)
    ) {
      throw new BadRequestException('Delegation delegate mismatch');
    }

    const created = await this.installationModel.create({
      userAddress,
      smartAccountAddress,
      skillId: skill.skillId,
      signedDelegation: dto.signedDelegation,
      delegationSalt: dto.delegationSalt,
      chainId: skill.chainId,
      parameters: dto.parameters ?? {},
      status: 'active',
    });

    return created.toObject();
  }

  async findByUser(userAddress: string, options: FindInstallationsOptions = {}): Promise<Installation[]> {
    const checksummed = getAddress(userAddress);

    if (options.chainId !== undefined && !Number.isInteger(options.chainId)) {
      throw new BadRequestException('chainId must be an integer');
    }

    const filter: {
      userAddress: string;
      chainId?: number;
      smartAccountAddress?: string;
    } = {
      userAddress: checksummed,
    };

    if (options.chainId !== undefined) {
      filter.chainId = options.chainId;
    }

    if (options.smartAccountAddress) {
      filter.smartAccountAddress = getAddress(options.smartAccountAddress);
    }

    return this.installationModel
      .find(filter)
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

    if (doc.executions.length > 50) {
      doc.executions = doc.executions.slice(0, 50);
    }

    doc.lastExecutedAt = record.executedAt;
    doc.markModified('executions');

    await doc.save();
  }

  async findExecutions(id: string): Promise<ExecutionRecord[]> {
    const doc = await this.installationModel.findById(id).lean().exec();

    if (!doc) throw new NotFoundException('Installation not found');

    return doc.executions ?? [];
  }

  async updateLastExecution(id: string, patch: Partial<ExecutionRecord>): Promise<void> {
    const doc = await this.installationModel.findById(id).exec();

    if (!doc) return;

    const target = doc.executions[0];

    if (!target) return;

    Object.assign(target, patch);

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

    const target = doc.executions.find((execution) => execution.executionId === executionId);

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

  private async assertNoActiveDuplicate(input: {
    userAddress: `0x${string}`;
    smartAccountAddress: `0x${string}`;
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
        `Skill is already installed for this smart account. installationId=${existing._id}`,
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
