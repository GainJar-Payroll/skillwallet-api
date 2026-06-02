import { Controller, Get, Param, Post, Body, Patch, Query } from '@nestjs/common';
import { SkillsService } from './skills.service';
import {
  createSkillDefinitionSchema,
  CreateSkillDefinitionDto,
  updateSkillDefinitionSchema,
  UpdateSkillDefinitionDto,
} from './dto/create-skill-definition.dto';

@Controller('skills')
export class SkillsController {
  constructor(private readonly skillsService: SkillsService) {}

  @Get()
  async findAll() {
    return this.skillsService.findAll();
  }

  @Get(':skillId')
  async findOne(@Param('skillId') skillId: string) {
    return this.skillsService.findBySkillId(skillId);
  }

  @Post()
  async create(@Body() body: unknown) {
    const dto: CreateSkillDefinitionDto = createSkillDefinitionSchema.parse(body);
    return this.skillsService.create(dto);
  }

  @Patch(':skillId')
  async update(
    @Param('skillId') skillId: string,
    @Body() body: unknown,
    @Query('allowOverwriteBuiltIn') allowOverwriteBuiltIn?: string,
  ) {
    const dto: UpdateSkillDefinitionDto = updateSkillDefinitionSchema.parse(body);
    return this.skillsService.update(skillId, dto, allowOverwriteBuiltIn === 'true');
  }
}