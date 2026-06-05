import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { EventTriggerConfig, Skill, SkillDocument } from './schemas/skill.schema';
import { CreateSkillDto } from './dto/create-skill.dto';
import { UpdateSkillDto } from './dto/update-skill.dto';

@Injectable()
export class SkillsService {
  constructor(
    @InjectModel(Skill.name) private readonly skillModel: Model<SkillDocument>,
  ) {}

  async findAll(onlyActive = true): Promise<Skill[]> {
    const filter = onlyActive ? { isActive: true } : {};
    return this.skillModel.find(filter).lean().exec();
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
    const created = await this.skillModel.create(dto);
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
    const updated = await this.skillModel
      .findOneAndUpdate({ name }, { $set: payload }, { new: true, upsert: true })
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
