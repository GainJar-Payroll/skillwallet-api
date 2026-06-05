import { Module } from '@nestjs/common';
import { ProofController } from './proof.controller';

/**
 * Dev-only proof surface. Exposes:
 *   GET  /proof            (HTML)
 *   GET  /proof/style.css  (CSS)
 */
@Module({
  controllers: [ProofController],
})
export class ProofModule {}
