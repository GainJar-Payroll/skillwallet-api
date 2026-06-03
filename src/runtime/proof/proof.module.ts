import { Module } from '@nestjs/common';
import { ProofController } from './proof.controller';
import { RuntimeModule } from '../runtime.module';

/**
 * Dev-only proof surface. Exposes:
 *   GET  /proof            (HTML)
 *   POST /proof/relayer    (JSON-RPC proxy to 1Shot)
 *
 * Reuses RuntimeModule so the controller can talk to OneShotRelayerService
 * without duplicating provider wiring.
 */
@Module({
  imports: [RuntimeModule],
  controllers: [ProofController],
})
export class ProofModule {}
