import { Injectable } from '@nestjs/common';
import { DcaAdapter } from './dca.adapter';
import { AerodromeVoteAdapter } from './aerodrome-vote.adapter';
import { AdapterId, SkillAdapter } from './skill-adapter.interface';

@Injectable()
export class AdapterRegistryService {
  private readonly adapters: Map<AdapterId, SkillAdapter>;

  constructor(
    private readonly dcaAdapter: DcaAdapter,
    private readonly aerodromeAdapter: AerodromeVoteAdapter,
  ) {
    this.adapters = new Map<AdapterId, SkillAdapter>([
      ['dca', this.dcaAdapter],
      ['aerodrome-vote', this.aerodromeAdapter],
    ]);
  }

  resolve(adapterId: string): SkillAdapter {
    const adapter = this.adapters.get(adapterId as AdapterId);
    if (!adapter) {
      throw new Error(`No adapter registered for "${adapterId}"`);
    }
    return adapter;
  }

  has(adapterId: string): boolean {
    return this.adapters.has(adapterId as AdapterId);
  }
}
