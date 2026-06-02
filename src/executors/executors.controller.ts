import { Controller, Get, Post, Patch, Body, Param } from '@nestjs/common';
import { ExecutorsService } from './executors.service';
import {
  createExecutorSchema,
  CreateExecutorDto,
  updateExecutorSchema,
  UpdateExecutorDto,
} from './dto/executor.dto';

@Controller('executors')
export class ExecutorsController {
  constructor(private readonly executorsService: ExecutorsService) {}

  @Get()
  async findAll() {
    return this.executorsService.findAll();
  }

  @Post()
  async create(@Body() body: unknown) {
    const dto: CreateExecutorDto = createExecutorSchema.parse(body);
    return this.executorsService.create(dto);
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() body: unknown) {
    const dto: UpdateExecutorDto = updateExecutorSchema.parse(body);
    return this.executorsService.update(id, dto);
  }
}