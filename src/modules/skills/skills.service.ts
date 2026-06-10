import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, isValidObjectId, Model } from 'mongoose';
import { getAddress } from 'viem';
import { Skill, SkillDocument } from './schemas/skill.schema';
import { CreateSkillDto } from './dto/create-skill.dto';
import { UpdateSkillDto } from './dto/update-skill.dto';
import { Installation, InstallationDocument } from '../installations/schemas/installation.schema';

export interface FindSkillsOptions {
  onlyActive?: boolean;
  chainId?: number;
  userAddress?: string;
  smartAccountAddress?: string;
}

interface InstallationSummary {
  id: string;
  status: 'active' | 'paused';
  installedAt?: Date;
  lastExecutedAt?: Date;
  nextExecutionAt?: Date;
}

export type SkillWithInstallation = Skill & { installation?: InstallationSummary };

@Injectable()
export class SkillsService {
  constructor(
    @InjectModel(Skill.name) private readonly skillModel: Model<SkillDocument>,
    @InjectModel(Installation.name)
    private readonly installationModel: Model<InstallationDocument>,
  ) {}

  async findAll(options: boolean | FindSkillsOptions = true): Promise<SkillWithInstallation[]> {
    const normalized: FindSkillsOptions =
      typeof options === 'boolean' ? { onlyActive: options } : options;

    const filter: FilterQuery<SkillDocument> = {};

    if (normalized.onlyActive ?? true) {
      filter.isActive = true;
    }

    if (normalized.chainId !== undefined) {
      if (!Number.isInteger(normalized.chainId)) {
        throw new BadRequestException('chainId must be an integer');
      }

      filter.chainId = normalized.chainId;
    }

    const skills = await this.skillModel.find(filter).sort({ name: 1, chainId: 1 }).lean().exec();

    return this.attachInstallations(skills, normalized);
  }

  async findById(id: string): Promise<Skill> {
    const skill = await this.skillModel.findOne({ skillId: id }).lean().exec();

    if (skill) return skill;

    if (isValidObjectId(id)) {
      const byMongoId = await this.skillModel.findById(id).lean().exec();
      if (byMongoId) return byMongoId;
    }

    throw new NotFoundException('Skill not found');
  }

  async findByIdRaw(id: string): Promise<SkillDocument | null> {
    return this.skillModel.findById(id).exec();
  }

  async create(dto: CreateSkillDto): Promise<Skill> {
    const created = await this.skillModel.create({
      ...dto,
      isActive: dto.isActive ?? true,
    });

    return created.toObject();
  }

  async update(id: string, dto: UpdateSkillDto): Promise<Skill> {
    const existing = await this.skillModel.findById(id).exec();
    if (!existing) throw new NotFoundException('Skill not found');

    const merged: CreateSkillDto = {
      skillId: existing.skillId,
      name: dto.name ?? existing.name,
      description: dto.description ?? existing.description,
      iconUrl: dto.iconUrl ?? existing.iconUrl,
      runType: dto.runType ?? existing.runType,
      trigger: dto.trigger ?? existing.trigger,
      chainId: dto.chainId ?? existing.chainId,
      delegationScope: dto.delegationScope ?? existing.delegationScope,
      parameters: dto.parameters ?? existing.parameters,
      limits: dto.limits ?? existing.limits,
      metadata: dto.metadata ?? existing.metadata,
      isActive: dto.isActive ?? existing.isActive,
    };

    Object.assign(existing, merged);
    await existing.save();

    return existing.toObject();
  }

  async remove(id: string): Promise<void> {
    const updated = await this.skillModel
      .findByIdAndUpdate(id, { isActive: false }, { new: true })
      .exec();

    if (!updated) throw new NotFoundException('Skill not found');
  }

  async upsertByName(name: string, payload: CreateSkillDto): Promise<Skill> {
    const updated = await this.skillModel
      .findOneAndUpdate(
        { name, chainId: payload.chainId },
        { $set: { ...payload, isActive: payload.isActive ?? true } },
        { new: true, upsert: true },
      )
      .exec();

    return updated!.toObject();
  }

  private async attachInstallations(
    skills: Skill[],
    options: FindSkillsOptions,
  ): Promise<SkillWithInstallation[]> {
    if (!options.userAddress && !options.smartAccountAddress) {
      return skills;
    }

    const installationFilter: {
      userAddress?: string;
      smartAccountAddress?: string;
      chainId?: number;
      status: { $in: Array<'active' | 'paused'> };
      skillId?: { $in: string[] };
    } = {
      status: { $in: ['active', 'paused'] },
    };

    if (options.userAddress) {
      installationFilter.userAddress = getAddress(options.userAddress);
    }

    if (options.smartAccountAddress) {
      installationFilter.smartAccountAddress = getAddress(options.smartAccountAddress);
    }

    if (options.chainId !== undefined) {
      installationFilter.chainId = options.chainId;
    }

    if (skills.length > 0) {
      installationFilter.skillId = { $in: skills.map((skill) => skill.skillId) };
    }

    const installations = (await this.installationModel
      .find(installationFilter)
      .sort({ createdAt: -1 })
      .lean()
      .exec()) as Array<Installation & { _id: unknown; createdAt?: Date }>;

    const latestBySkillId = new Map<string, InstallationSummary>();

    for (const installation of installations) {
      if (latestBySkillId.has(installation.skillId)) {
        continue;
      }

      latestBySkillId.set(installation.skillId, {
        id: String(installation._id),
        status: installation.status as 'active' | 'paused',
        installedAt: installation.createdAt,
        lastExecutedAt: installation.lastExecutedAt,
        nextExecutionAt: installation.nextExecutionAt,
      });
    }

    return skills.map((skill) => ({
      ...skill,
      installation: latestBySkillId.get(skill.skillId),
    }));
  }
}
