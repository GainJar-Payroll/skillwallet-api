import { Test } from '@nestjs/testing';
import { privateKeyToAccount } from 'viem/accounts';
import { X402Service } from './x402.service';
import { ExecutorService } from '../executor/executor.service';

const URL = 'https://api.example.com/paid';
const PK = '0x4bbbf85ce3377467afe5d46f804f221813b2bb87f24d81f60f1fcdbf7cbf4356' as `0x${string}`;
const TEST_EXECUTOR = '0x90F79bf6EB2c4f870365E785982E1f101E93b906' as `0x${string}`;

function mockResponseSequence(
  responses: Array<{
    ok: boolean;
    status: number;
    json?: () => unknown;
    text?: () => string;
    headers?: Headers;
  }>,
) {
  let i = 0;
  global.fetch = jest.fn().mockImplementation(async () => {
    const r = responses[i++] ?? responses[responses.length - 1];
    return {
      ok: r.ok,
      status: r.status,
      headers: r.headers ?? new Headers(),
      json: async () => r.json?.() ?? {},
      text: async () => r.text?.() ?? '',
    } as Response;
  }) as unknown as typeof fetch;
}

describe('X402Service', () => {
  let service: X402Service;
  let executorMock: { getAddress: jest.Mock; getAccount: jest.Mock };
  const originalFetch = global.fetch;

  beforeEach(async () => {
    const account = privateKeyToAccount(PK);
    executorMock = {
      getAddress: jest.fn().mockReturnValue(account.address),
      getAccount: jest.fn().mockReturnValue(account),
    };
    const mod = await Test.createTestingModule({
      providers: [
        X402Service,
        { provide: ExecutorService, useValue: executorMock },
      ],
    }).compile();
    service = mod.get(X402Service);
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('returns body when first call succeeds (no 402)', async () => {
    mockResponseSequence([
      { ok: true, status: 200, json: () => ({ data: 'ok' }) },
    ]);
    const out = await service.fetch<{ data: string }>(URL);
    expect(out.data).toBe('ok');
  });

  it('throws on non-402 failure', async () => {
    mockResponseSequence([{ ok: false, status: 500, json: () => ({}) }]);
    await expect(service.fetch(URL)).rejects.toThrow(/unexpected status 500/);
  });

  it('throws when 402 missing PAYMENT-REQUIRED header', async () => {
    mockResponseSequence([{ ok: false, status: 402, json: () => ({}) }]);
    await expect(service.fetch(URL)).rejects.toThrow(/PAYMENT-REQUIRED/);
  });

  it('throws when no base payment option', async () => {
    const headers = new Headers();
    headers.set('PAYMENT-REQUIRED', JSON.stringify({ accepts: [{ network: 'ethereum' }] }));
    mockResponseSequence([{ ok: false, status: 402, headers, json: () => ({}) }]);
    await expect(service.fetch(URL)).rejects.toThrow(/no Base network/);
  });

  it('replays request with X-402-Payment header on second call', async () => {
    const headers402 = new Headers();
    headers402.set(
      'PAYMENT-REQUIRED',
      JSON.stringify({
        accepts: [
          {
            network: 'base',
            payTo: TEST_EXECUTOR,
            asset: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
            scheme: 'exact',
            maxAmountRequired: '1000',
            maxTimeoutSeconds: 60,
            resource: URL,
            description: 'paid',
            mimeType: 'application/json',
            extra: { name: 'USDC', version: '2' },
          },
        ],
      }),
    );
    mockResponseSequence([
      { ok: false, status: 402, headers: headers402, json: () => ({}) },
      { ok: true, status: 200, json: () => ({ paid: true }) },
    ]);
    const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
    const realFetch = global.fetch;
    (global as unknown as { fetch: typeof fetch }).fetch = jest
      .fn()
      .mockImplementation(async (url: string, init?: RequestInit) => {
        calls.push({ url, init });
        return realFetch(url, init);
      }) as unknown as typeof fetch;

    const out = await service.fetch<{ paid: boolean }>(URL);
    expect(out.paid).toBe(true);
    expect(calls.length).toBe(2);
    const secondHeaders = (calls[1].init?.headers ?? {}) as Record<string, string>;
    expect(secondHeaders['X-402-Payment']).toBeDefined();
  });

  it('throws on second-call payment failure', async () => {
    const headers402 = new Headers();
    headers402.set(
      'PAYMENT-REQUIRED',
      JSON.stringify({
        accepts: [
          {
            network: 'base',
            payTo: TEST_EXECUTOR,
            asset: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
            scheme: 'exact',
            maxAmountRequired: '1000',
            maxTimeoutSeconds: 60,
            extra: { name: 'USDC', version: '2' },
          },
        ],
      }),
    );
    mockResponseSequence([
      { ok: false, status: 402, headers: headers402, json: () => ({}) },
      { ok: false, status: 403, text: () => 'forbidden' },
    ]);
    await expect(service.fetch(URL)).rejects.toThrow(/payment failed/);
  });
});
