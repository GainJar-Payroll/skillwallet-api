import { Controller, Get, Post, Patch, Body, Param } from '@nestjs/common';
import { ExecutorsService } from './executors.service';
import {
  createExecutorSchema,
  CreateExecutorDto,
  updateExecutorSchema,
  UpdateExecutorDto,
} from './dto/executor.dto';
import { AdminOnly } from '../common/auth';

@Controller('executors')
export class ExecutorsController {
  constructor(private readonly executorsService: ExecutorsService) {}

  @Get()
  async findAll() {
    return this.executorsService.findAll();
  }

  @Post()
  @AdminOnly()
  async create(@Body() body: unknown) {
    const dto: CreateExecutorDto = createExecutorSchema.parse(body);
    return this.executorsService.create(dto);
  }

  @Patch(':id')
  @AdminOnly()
  async update(@Param('id') id: string, @Body() body: unknown) {
    const dto: UpdateExecutorDto = updateExecutorSchema.parse(body);
    return this.executorsService.update(id, dto);
  }
}
