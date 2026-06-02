import { Module, OnApplicationBootstrap, Logger } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { SkillDefinition, SkillDefinitionSchema } from './schemas/skill-definition.schema';
import { SkillsService } from './skills.service';
import { SkillsController } from './skills.controller';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: SkillDefinition.name, schema: SkillDefinitionSchema },
    ]),
  ],
  providers: [SkillsService],
  controllers: [SkillsController],
  exports: [SkillsService, MongooseModule],
})
export class SkillsModule implements OnApplicationBootstrap {
  private readonly logger = new Logger(SkillsModule.name);

  constructor(private readonly skillsService: SkillsService) {}

  async onApplicationBootstrap() {
    try {
      await this.skillsService.ensureBuiltInsSeeded();
      this.logger.log('Built-in skill definitions seeded');
    } catch (err) {
      this.logger.error('Failed to seed built-in skill definitions', err as Error);
    }
  }
}