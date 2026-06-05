import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { getAddress } from 'viem';
import {
  Installation,
  InstallationDocument,
  ExecutionRecord,
} from './schemas/installation.schema';
import { SkillsService } from '../skills/skills.service';
import { DelegationService } from '../delegation/delegation.service';
import { ExecutorService } from '../executor/executor.service';
import { PrepareInstallationDto } from './dto/prepare-installation.dto';
import { ConfirmInstallationDto } from './dto/confirm-installation.dto';

export interface PrepareInstallationResponse {
  delegation: Record<string, unknown>;
  salt: `0x${string}`;
  skillId: string;
  executorAddress: `0x${string}`;
  chainId: number;
}

@Injectable()
export class InstallationsService {
  private readonly logger = new Logger(InstallationsService.name);

  constructor(
    @InjectModel(Installation.name)
    private readonly installationModel: Model<InstallationDocument>,
    private readonly skillsService: SkillsService,
    private readonly delegationService: DelegationService,
    private readonly executorService: ExecutorService,
  ) {}

  async prepareInstallation(
    dto: PrepareInstallationDto,
  ): Promise<PrepareInstallationResponse> {
    const skill = await this.skillsService.findById(dto.skillId);
    if (!skill.isActive) {
      throw new BadRequestException('Skill is not active');
    }

    const salt = this.delegationService.generateSalt();
    const userAddress = getAddress(dto.userAddress) as `0x${string}`;
    const delegation = this.delegationService.prepare(
      skill,
      userAddress,
      salt,
    ) as unknown as Record<string, unknown>;

    return {
      delegation,
      salt,
      skillId: dto.skillId,
      executorAddress: this.executorService.getAddress(),
      chainId: skill.chainId,
    };
  }

  async confirmInstallation(dto: ConfirmInstallationDto): Promise<Installation> {
    const skill = await this.skillsService.findById(dto.skillId);
    const userAddress = getAddress(dto.userAddress) as `0x${string}`;

    const expected = this.delegationService.prepare(
      skill,
      userAddress,
      dto.delegationSalt as `0x${string}`,
    ) as unknown as Record<string, unknown>;

    try {
      this.delegationService.validateDelegationShape(dto.signedDelegation, userAddress);
    } catch (err) {
      throw new BadRequestException(
        `Invalid delegation signature: ${(err as Error).message}`,
      );
    }

    if (
      (dto.signedDelegation.salt as string)?.toLowerCase() !==
      (expected.salt as string)?.toLowerCase()
    ) {
      throw new BadRequestException('Delegation salt mismatch');
    }

    const created = await this.installationModel.create({
      userAddress,
      skillId: new Types.ObjectId(dto.skillId),
      signedDelegation: dto.signedDelegation,
      delegationSalt: dto.delegationSalt,
      chainId: skill.chainId,
      parameters: dto.parameters ?? {},
      status: 'active',
    });
    return created.toObject();
  }

  async findByUser(userAddress: string): Promise<Installation[]> {
    const checksummed = getAddress(userAddress);
    return this.installationModel
      .find({ userAddress: checksummed })
      .populate({
        path: 'skillId',
        select: 'name iconUrl runType chainId',
      })
      .lean()
      .exec();
  }

  async findById(id: string): Promise<Installation> {
    const inst = await this.installationModel
      .findById(id)
      .populate({ path: 'skillId', select: 'name iconUrl runType chainId' })
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

  async updateLastExecution(
    id: string,
    patch: Partial<ExecutionRecord>,
  ): Promise<void> {
    const doc = await this.installationModel.findById(id).exec();
    if (!doc) return;
    const target = doc.executions[0];
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
        $or: [{ nextExecutionAt: { $lte: now } }, { nextExecutionAt: { $exists: false } }, { nextExecutionAt: null }],
      })
      .populate({ path: 'skillId', select: 'name iconUrl runType chainId' })
      .lean()
      .exec();
  }

  async findActiveBySkillId(skillId: string): Promise<Installation[]> {
    return this.installationModel
      .find({ status: 'active', skillId: new Types.ObjectId(skillId) })
      .lean()
      .exec();
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
