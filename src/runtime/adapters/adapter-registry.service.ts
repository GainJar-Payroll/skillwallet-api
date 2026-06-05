import { Injectable } from '@nestjs/common';
import { AppError } from '../../common/errors/app-error';
import type { ISkillAdapter, SkillAdapterKind, SkillConfig } from './skill-adapter.interface';
import { DirectRouterDcaAdapter } from './direct-router-dca.adapter';
import { GmSelfCallAdapter } from './gm-self-call.adapter';

@Injectable()
export class AdapterRegistryService {
  private readonly map = new Map<SkillAdapterKind, ISkillAdapter>();

  constructor(
    directRouterDcaAdapter: DirectRouterDcaAdapter,
    gmSelfCallAdapter: GmSelfCallAdapter,
  ) {
    this.register(directRouterDcaAdapter);
    this.register(gmSelfCallAdapter);
  }

  register(adapter: ISkillAdapter): void {
    this.map.set(adapter.kind, adapter);
  }

  get(kind: string): ISkillAdapter {
    const adapter = this.map.get(kind as SkillAdapterKind);
    if (!adapter) {
      throw AppError.notConfigured(`skillAdapter=${kind}`, `No adapter registered for "${kind}"`);
    }
    return adapter;
  }

  resolve(kind: string): ISkillAdapter {
    return this.get(kind);
  }

  list(): ISkillAdapter[] {
    return [...this.map.values()];
  }

  parseConfig(kind: string, config: unknown): SkillConfig {
    return this.get(kind).parseConfig(config);
  }
}
