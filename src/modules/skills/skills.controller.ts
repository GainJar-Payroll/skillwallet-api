import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { SkillsService } from './skills.service';
import { CreateSkillDto } from './dto/create-skill.dto';
import { UpdateSkillDto } from './dto/update-skill.dto';
import { AdminApiKeyGuard } from '../../common/guards/admin-api-key.guard';

@ApiTags('Skills')
@ApiSecurity('admin-api-key')
@Controller('skills')
export class SkillsController {
  constructor(private readonly skills: SkillsService) {}

  @Get()
  @ApiOperation({
    summary: 'List skills',
    description:
      'Returns active skills by default. Supports filtering by chainId. Pass active=false to include deactivated skills.',
  })
  @ApiQuery({
    name: 'active',
    required: false,
    type: String,
    description: 'Filter by active state ("true"/"false"). Defaults to true.',
  })
  @ApiQuery({
    name: 'chainId',
    required: false,
    type: Number,
    description: 'Filter skills by EVM chain id, for example 84532 or 8453.',
  })
  @ApiOkResponse({ description: 'Catalog of skills wrapped in { data }' })
  async findAll(@Query('active') active?: string, @Query('chainId') chainId?: string) {
    const onlyActive = active === undefined ? true : active === 'true';

    const parsedChainId = chainId === undefined || chainId === '' ? undefined : Number(chainId);

    const data = await this.skills.findAll({
      onlyActive,
      chainId: parsedChainId,
    });

    return { data };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a skill by id' })
  @ApiParam({ name: 'id', description: 'Public skillId of the skill' })
  @ApiOkResponse({ description: 'Skill document' })
  async findOne(@Param('id') id: string) {
    return this.skills.findById(id);
  }

  @Post()
  @ApiOperation({ summary: 'Create a skill (admin)' })
  @ApiCreatedResponse({ description: 'Skill document' })
  @UseGuards(AdminApiKeyGuard)
  async create(@Body() dto: CreateSkillDto) {
    return this.skills.create(dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a skill (admin)' })
  @ApiParam({ name: 'id', description: 'Mongo ObjectId of the skill to update' })
  @ApiOkResponse({ description: 'Updated skill document' })
  @UseGuards(AdminApiKeyGuard)
  async update(@Param('id') id: string, @Body() dto: UpdateSkillDto) {
    return this.skills.update(id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Deactivate a skill (admin)' })
  @ApiParam({ name: 'id', description: 'Mongo ObjectId of the skill to deactivate' })
  @ApiOkResponse({ description: 'Deactivation confirmation' })
  @UseGuards(AdminApiKeyGuard)
  async remove(@Param('id') id: string) {
    await this.skills.remove(id);
    return { message: 'Skill deactivated' };
  }
}
