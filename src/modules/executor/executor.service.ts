import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createPublicClient,
  http,
  type PrivateKeyAccount,
  type PublicClient,
} from 'viem';
import { base, baseSepolia } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import type { ExecutorInfo } from './executor.types';

@Injectable()
export class ExecutorService implements OnModuleInit {
  private readonly logger = new Logger(ExecutorService.name);
  private account!: PrivateKeyAccount;
  private publicClients: Record<number, PublicClient> = {};

  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    const pk = this.config.get<`0x${string}`>('executorPrivateKey');
    if (!pk) {
      throw new Error('EXECUTOR_PRIVATE_KEY is missing from config');
    }
    this.account = privateKeyToAccount(pk);
    this.logger.log(`Executor address: ${this.account.address}`);

    const rpc = this.config.get<Record<number, string>>('rpc') || {};
    for (const [chainIdStr, url] of Object.entries(rpc)) {
      const chainId = Number(chainIdStr);
      this.publicClients[chainId] = createPublicClient({
        chain: chainId === 8453 ? base : baseSepolia,
        transport: http(url),
      }) as PublicClient;
    }
  }

  getAddress(): `0x${string}` {
    return this.account.address;
  }

  getAccount(): PrivateKeyAccount {
    return this.account;
  }

  getInfo(): ExecutorInfo {
    return {
      address: this.account.address,
      privateKey: this.config.get<`0x${string}`>('executorPrivateKey')!,
    };
  }

  getPublicClient(chainId: number): PublicClient {
    const client = this.publicClients[chainId];
    if (!client) {
      throw new Error(`No public client for chainId ${chainId}`);
    }
    return client;
  }
}
