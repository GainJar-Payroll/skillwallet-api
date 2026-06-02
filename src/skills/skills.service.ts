import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { SkillDefinition, SkillDefinitionDocument } from './schemas/skill-definition.schema';
import { AppError } from '../common/errors/app-error';
import { ErrorCode } from '../common/errors/error-codes';

@Injectable()
export class SkillsService {
  constructor(
    @InjectModel(SkillDefinition.name)
    private readonly skillModel: Model<SkillDefinitionDocument>,
  ) {}

  async findAll(): Promise<SkillDefinition[]> {
    return this.skillModel.find().lean();
  }

  async findBySkillId(skillId: string): Promise<SkillDefinition> {
    const skill = await this.skillModel.findOne({ skillId }).lean();
    if (!skill) {
      throw new AppError(ErrorCode.NOT_FOUND, `Skill not found: ${skillId}`);
    }
    return skill;
  }

  async findBySlug(slug: string): Promise<SkillDefinition | null> {
    return this.skillModel.findOne({ slug }).lean();
  }

  async create(input: Partial<SkillDefinition>): Promise<SkillDefinition> {
    if (input.skillId) {
      const existing = await this.skillModel.findOne({ skillId: input.skillId });
      if (existing) {
        throw new AppError(ErrorCode.CONFLICT, `Skill already exists: ${input.skillId}`);
      }
    }
    const created = await this.skillModel.create(input);
    return created.toObject();
  }

  async update(
    skillId: string,
    input: Partial<SkillDefinition>,
    allowOverwriteBuiltIn = false,
  ): Promise<SkillDefinition> {
    const existing = await this.skillModel.findOne({ skillId });
    if (!existing) {
      throw new AppError(ErrorCode.NOT_FOUND, `Skill not found: ${skillId}`);
    }
    if (existing.builtIn && !allowOverwriteBuiltIn) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        'Cannot overwrite built-in skill definition without allowOverwriteBuiltIn flag',
      );
    }
    Object.assign(existing, input);
    await existing.save();
    return existing.toObject();
  }

  async upsertBuiltIn(definitions: Partial<SkillDefinition>[]): Promise<void> {
    for (const def of definitions) {
      if (!def.skillId) continue;
      await this.skillModel.updateOne(
        { skillId: def.skillId },
        { $set: { ...def, builtIn: true } },
        { upsert: true },
      );
    }
  }

  async ensureBuiltInsSeeded(): Promise<void> {
    // Always upsert: code is the source of truth for built-in catalog.
    // `updateOne` with `upsert: true` is a no-op when nothing changed.
    const { builtInSkills } = await import('./definitions/built-in-skills');
    await this.upsertBuiltIn(builtInSkills);
  }
}
