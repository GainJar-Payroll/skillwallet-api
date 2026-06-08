import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ExecutorService } from './executor.service';

const PK = '0x4bbbf85ce3377467afe5d46f804f221813b2bb87f24d81f60f1fcdbf7cbf4356';

describe('ExecutorService', () => {
  let service: ExecutorService;
  let config: { get: jest.Mock };

  beforeEach(async () => {
    config = {
      get: jest.fn().mockImplementation((k: string) => {
        const map: Record<string, unknown> = {
          executorPrivateKey: PK,
          rpc: { 84532: 'https://sepolia.base.org', 8453: 'https://mainnet.base.org' },
        };
        return map[k];
      }),
    };
    const mod = await Test.createTestingModule({
      providers: [
        ExecutorService,
        { provide: ConfigService, useValue: config },
      ],
    }).compile();
    service = mod.get(ExecutorService);
    service.onModuleInit();
  });

  it('derives address from private key', () => {
    expect(service.getAddress()).toMatch(/^0x[a-fA-F0-9]{40}$/);
  });

  it('exposes the same address in getInfo', () => {
    expect(service.getInfo().address).toBe(service.getAddress());
  });

  it('does not leak the executor private key through getInfo', () => {
    expect((service.getInfo() as Record<string, unknown>).privateKey).toBeUndefined();
  });

  it('exposes the account object', () => {
    expect(service.getAccount().address).toBe(service.getAddress());
  });

  it('builds public clients for configured chains', () => {
    expect(() => service.getPublicClient(84532)).not.toThrow();
    expect(() => service.getPublicClient(8453)).not.toThrow();
  });

  it('throws for unknown chainId', () => {
    expect(() => service.getPublicClient(1)).toThrow(/No public client/);
  });

  it('throws when private key is missing', async () => {
    const mod = await Test.createTestingModule({
      providers: [
        ExecutorService,
        { provide: ConfigService, useValue: { get: () => undefined } },
      ],
    }).compile();
    const s = mod.get(ExecutorService);
    expect(() => s.onModuleInit()).toThrow(/EXECUTOR_PRIVATE_KEY/);
  });

  it('skips clients for chains without rpc entry', async () => {
    const cfg = {
      get: jest.fn().mockImplementation((k: string) => {
        const map: Record<string, unknown> = { executorPrivateKey: PK, rpc: {} };
        return map[k];
      }),
    };
    const mod = await Test.createTestingModule({
      providers: [ExecutorService, { provide: ConfigService, useValue: cfg }],
    }).compile();
    const s = mod.get(ExecutorService);
    s.onModuleInit();
    expect(() => s.getPublicClient(84532)).toThrow();
  });
});
