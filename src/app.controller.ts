import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

@ApiTags('App')
@Controller()
export class AppController {
  @Get()
  @ApiOperation({
    summary: 'Service index',
    description: 'Returns high-level metadata and a route map. Use this for human discovery and as a smoke test.',
  })
  @ApiOkResponse({
    description: 'Backend metadata and key endpoints',
    schema: {
      type: 'object',
      properties: {
        name: { type: 'string', example: 'SkillWallet Backend' },
        status: { type: 'string', example: 'ok' },
        endpoints: {
          type: 'object',
          properties: {
            docs: { type: 'string', example: '/docs' },
            health: { type: 'string', example: '/health' },
            proof: { type: 'string', example: '/proof' },
            skills: { type: 'string', example: '/skills' },
            installations: { type: 'string', example: '/installations' },
            executor: { type: 'string', example: '/executor/address' },
            seedSkills: { type: 'string', example: '/admin/skills/seed' },
          },
        },
      },
    },
  })
  index() {
    return {
      name: 'SkillWallet Backend',
      status: 'ok',
      endpoints: {
        docs: '/docs',
        health: '/health',
        proof: '/proof',
        skills: '/skills',
        installations: '/installations',
        executor: '/executor/address',
        seedSkills: '/admin/skills/seed',
      },
    };
  }
}
