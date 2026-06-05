import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { SkillDefinition, SkillDefinitionDoc } from './schemas/skill-definition.schema';
import { AppError } from '../common/errors/app-error';
import { ErrorCode } from '../common/errors/error-codes';
import { builtInSkills } from './built-in-skills';

@Injectable()
export class SkillsService {
  private readonly logger = new Logger(SkillsService.name);

  constructor(
    @InjectModel(SkillDefinition.name)
    private readonly model: Model<SkillDefinitionDoc>,
  ) {}

  async list(): Promise<SkillDefinitionDoc[]> {
    return this.model.find({ status: { $ne: 'disabled' } }).exec();
  }

  async findAll(): Promise<SkillDefinitionDoc[]> {
    return this.list();
  }

  async getBySkillId(skillId: string): Promise<SkillDefinitionDoc> {
    const doc = await this.model.findOne({ $or: [{ skillId }, { slug: skillId }] }).exec();
    if (!doc) {
      throw AppError.notFound(`skill ${skillId}`);
    }
    return doc;
  }

  async findBySkillId(skillId: string): Promise<SkillDefinitionDoc> {
    return this.getBySkillId(skillId);
  }

  async create(input: Record<string, unknown>): Promise<SkillDefinitionDoc> {
    if (input.skillId) {
      const existing = await this.model.findOne({ skillId: input.skillId }).exec();
      if (existing) {
        throw new AppError(ErrorCode.CONFLICT, `Skill already exists: ${input.skillId}`);
      }
    }
    return this.model.create(input);
  }

  async update(
    skillId: string,
    input: Record<string, unknown>,
    allowOverwriteBuiltIn = false,
  ): Promise<SkillDefinitionDoc> {
    const existing = await this.getBySkillId(skillId);
    if (existing.builtIn && !allowOverwriteBuiltIn) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        'Cannot overwrite built-in skill definition without allowOverwriteBuiltIn flag',
      );
    }
    Object.assign(existing, input);
    await existing.save();
    return existing;
  }

  async upsertBuiltIn(
    definitions: Array<Record<string, unknown> & { skillId?: string }>,
  ): Promise<void> {
    for (const definition of definitions) {
      if (!definition.skillId) continue;
      await this.model.updateOne(
        { skillId: definition.skillId },
        { $set: { ...definition, builtIn: true } },
        { upsert: true },
      );
    }
  }

  async ensureBuiltInsSeeded(): Promise<void> {
    await this.upsertBuiltIn(builtInSkills as unknown as Array<Record<string, unknown>>);
  }

  async seedIfEmpty(): Promise<void> {
    // await this.upsertBuiltIn(builtInSkills as unknown as Array<Record<string, unknown>>);
    this.logger.log(`seedIfEmpty: ensured ${builtInSkills.length} built-in skill(s)`);
  }
}
