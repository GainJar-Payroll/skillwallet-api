import { Module, OnApplicationBootstrap } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { SkillDefinition, SkillDefinitionSchema } from './schemas/skill-definition.schema';
import { SkillsService } from './skills.service';
import { SkillsController } from './skills.controller';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: SkillDefinition.name, schema: SkillDefinitionSchema }]),
  ],
  providers: [SkillsService],
  controllers: [SkillsController],
  exports: [SkillsService],
})
export class SkillsModule implements OnApplicationBootstrap {
  constructor(private readonly service: SkillsService) {}
  async onApplicationBootstrap() {
    await this.service.seedIfEmpty();
  }
}
