import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { OneShotService } from './oneshot.service';

const RELAYER = 'https://test.1shot.rpctest.com/json-rpc';
const TASK_ID = ('0x' + 'ab'.repeat(32)) as `0x${string}`;

function mockFetchSequence(responses: Array<{ ok: boolean; status: number; json: () => unknown }>) {
  const calls: Array<{ url: string; body: unknown }> = [];
  let i = 0;
  global.fetch = jest.fn().mockImplementation(async (url: string, init: RequestInit) => {
    calls.push({ url, body: JSON.parse(init.body as string) });
    const r = responses[i++] ?? responses[responses.length - 1];
    return {
      ok: r.ok,
      status: r.status,
      json: async () => r.json(),
    } as Response;
  }) as unknown as typeof fetch;
  return calls;
}

describe('OneShotService', () => {
  let service: OneShotService;
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  beforeEach(async () => {
    const mod = await Test.createTestingModule({
      providers: [
        OneShotService,
        { provide: ConfigService, useValue: { get: () => RELAYER } },
      ],
    }).compile();
    service = mod.get(OneShotService);
  });

  describe('rpc', () => {
    it('returns result on success', async () => {
      const calls = mockFetchSequence([{ ok: true, status: 200, json: () => ({ result: { foo: 1 } }) }]);
      const out = await service.getCapabilities(84532);
      expect(out).toEqual({ foo: 1 });
      expect(calls[0].body.method).toBe('relayer_getCapabilities');
      expect(calls[0].body.jsonrpc).toBe('2.0');
    });

    it('throws on rpc error', async () => {
      mockFetchSequence([{ ok: false, status: 500, json: () => ({ error: { message: 'oops' } }) }]);
      await expect(service.getCapabilities(84532)).rejects.toThrow(/oops/);
    });
  });

  describe('getFeeData', () => {
    it('passes chainId + token', async () => {
      const calls = mockFetchSequence([{ ok: true, status: 200, json: () => ({ result: { fee: '1000' } }) }]);
      const out = await service.getFeeData(84532, '0xToken' as `0x${string}`);
      expect(out).toEqual({ fee: '1000' });
      expect(calls[0].body.params).toEqual([84532, '0xToken']);
    });
  });

  describe('send7710Transaction', () => {
    it('serialises bigints to hex and returns task id', async () => {
      const calls = mockFetchSequence([{ ok: true, status: 200, json: () => ({ result: TASK_ID }) }]);
      const taskId = await service.send7710Transaction({
        chainId: '84532',
        transactions: [
          {
            permissionContext: [],
            executions: [
              { target: '0xTarget' as `0x${string}`, value: '0', data: '0x' as `0x${string}` },
            ],
          },
        ],
      });
      expect(taskId).toBe(TASK_ID);
      expect(calls[0].body.method).toBe('relayer_send7710Transaction');
    });
  });

  describe('toRelayerJson', () => {
    it('converts bigint to hex', () => {
      expect(OneShotService.toRelayerJson(255n)).toBe('0xff');
    });
    it('converts Uint8Array to hex', () => {
      const out = OneShotService.toRelayerJson(new Uint8Array([0xde, 0xad, 0xbe, 0xef]));
      expect(out).toBe('0xdeadbeef');
    });
    it('recurses into arrays and objects', () => {
      const out = OneShotService.toRelayerJson({ a: 1n, b: [2n, 'x'] });
      expect(out).toEqual({ a: '0x1', b: ['0x2', 'x'] });
    });
    it('returns primitives unchanged', () => {
      expect(OneShotService.toRelayerJson(null)).toBe(null);
      expect(OneShotService.toRelayerJson(undefined)).toBe(undefined);
      expect(OneShotService.toRelayerJson('s')).toBe('s');
      expect(OneShotService.toRelayerJson(42)).toBe(42);
    });
  });

  describe('poll', () => {
    it('returns when status=200', async () => {
      mockFetchSequence([{ ok: true, status: 200, json: () => ({ result: { status: 200, hash: '0xH' } }) }]);
      const out = await service.poll(TASK_ID, 5000);
      expect(out.status).toBe(200);
    });

    it('throws on status=400', async () => {
      mockFetchSequence([{ ok: true, status: 200, json: () => ({ result: { status: 400, message: 'rejected' } }) }]);
      await expect(service.poll(TASK_ID, 5000)).rejects.toThrow(/rejected/);
    });

    it('throws on status=500', async () => {
      mockFetchSequence([{ ok: true, status: 200, json: () => ({ result: { status: 500, message: 'reverted' } }) }]);
      await expect(service.poll(TASK_ID, 5000)).rejects.toThrow(/reverted/);
    });

    it('times out after deadline', async () => {
      mockFetchSequence([{ ok: true, status: 200, json: () => ({ result: { status: 100 } }) }]);
      await expect(service.poll(TASK_ID, 100)).rejects.toThrow(/timed out/);
    });
  });
});
