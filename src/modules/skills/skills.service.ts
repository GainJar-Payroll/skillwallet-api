import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model } from 'mongoose';
import { Skill, SkillDocument } from './schemas/skill.schema';
import { CreateSkillDto } from './dto/create-skill.dto';
import { UpdateSkillDto } from './dto/update-skill.dto';

export interface FindSkillsOptions {
  onlyActive?: boolean;
  chainId?: number;
}

@Injectable()
export class SkillsService {
  constructor(@InjectModel(Skill.name) private readonly skillModel: Model<SkillDocument>) {}

  async findAll(options: boolean | FindSkillsOptions = true): Promise<Skill[]> {
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

    return this.skillModel.find(filter).sort({ name: 1, chainId: 1 }).lean().exec();
  }

  async findById(id: string): Promise<Skill> {
    const skill = await this.skillModel.findById(id).lean().exec();
    if (!skill) throw new NotFoundException('Skill not found');
    return skill;
  }

  async findByIdRaw(id: string): Promise<SkillDocument | null> {
    return this.skillModel.findById(id).exec();
  }

  async create(dto: CreateSkillDto): Promise<Skill> {
    this.validateRunType(dto);

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
      name: dto.name ?? existing.name,
      description: dto.description ?? existing.description,
      iconUrl: dto.iconUrl ?? existing.iconUrl,
      runType: dto.runType ?? existing.runType,
      cronExpression: dto.cronExpression ?? existing.cronExpression,
      eventTriggerConfig: (dto.eventTriggerConfig ?? existing.eventTriggerConfig) as
        | Record<string, unknown>
        | undefined,
      chainId: dto.chainId ?? existing.chainId,
      delegationScope: (dto.delegationScope as Record<string, unknown>) ?? existing.delegationScope,
      parameters: dto.parameters ?? existing.parameters,
      metadata: dto.metadata ?? existing.metadata,
      isActive: dto.isActive ?? existing.isActive,
    };

    this.validateRunType(merged);

    Object.assign(existing, dto);
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
    this.validateRunType(payload);

    const updated = await this.skillModel
      .findOneAndUpdate(
        { name, chainId: payload.chainId },
        { $set: { ...payload, isActive: payload.isActive ?? true } },
        { new: true, upsert: true },
      )
      .exec();

    return updated!.toObject();
  }

  private validateRunType(dto: CreateSkillDto): void {
    if (dto.runType === 'cron' && !dto.cronExpression) {
      throw new BadRequestException('cronExpression is required for runType "cron"');
    }

    if (dto.runType === 'event-trigger' && !dto.eventTriggerConfig) {
      throw new BadRequestException('eventTriggerConfig is required for runType "event-trigger"');
    }
  }
}
