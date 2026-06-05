import { describe, it, expect, mock, beforeEach, afterEach } from 'bun:test';
import { OneShotRelayerService } from '../src/runtime/relayers/oneshot-relayer.service';
import { OneShotBundleValidator } from '../src/runtime/relayers/oneshot-bundle-validator';
import { ErrorCode } from '../src/common/errors/error-codes';
import type { OneShotDelegation } from '../src/runtime/relayers/relayer.interface';

function buildRelayerService(
  overrides: Partial<{
    network: 'mainnet' | 'testnet';
    relayerUrl: string;
    paymentTokenAddress: string;
    testnetChainId: number;
    mainnetChainId: number;
  }> = {},
) {
  const map: Record<string, string | number> = {
    ONESHOT_NETWORK: overrides.network ?? 'testnet',
    ONESHOT_RELAYER_URL: overrides.relayerUrl ?? '',
    ONESHOT_PAYMENT_TOKEN_ADDRESS: overrides.paymentTokenAddress ?? '',
    ONESHOT_TESTNET_CHAIN_ID: overrides.testnetChainId ?? 84532,
    ONESHOT_MAINNET_CHAIN_ID: overrides.mainnetChainId ?? 8453,
  };
  const config = { get: (key: string) => map[key] ?? '' };
  return new OneShotRelayerService(config as never, new OneShotBundleValidator());
}

describe('OneShotRelayerService (v2 JSON-RPC)', () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('throws NOT_CONFIGURED when chain has no default USDC and no override set', async () => {
    const svc = buildRelayerService({
      testnetChainId: 424242,
    });
    await expect(
      svc.send7710Transaction({
        chainId: 424242,
        transactions: [],
      }),
    ).rejects.toThrow(/payment token/i);
  });

  it('defaults payment token to USDC for eth sepolia when not configured', () => {
    const svc = buildRelayerService({ testnetChainId: 11155111 });
    expect(svc.getPaymentTokenAddress()).toBe('0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238');
  });

  it('defaults payment token to USDC for base sepolia testnet when not configured', () => {
    const svc = buildRelayerService();
    expect(svc.getPaymentTokenAddress()).toBe('0x036CbD53842c5426634e7929541eC2318f3dCF7e');
  });

  it('defaults payment token to USDC for base when not configured', () => {
    const svc = buildRelayerService({
      network: 'mainnet',
      mainnetChainId: 8453,
    });
    expect(svc.getPaymentTokenAddress()).toBe('0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913');
  });

  it('posts JSON-RPC envelope to /relayers with correct bundle shape', async () => {
    let capturedUrl = '';
    let capturedBody: Record<string, unknown> | null = null;
    globalThis.fetch = mock(async (url: string, init?: RequestInit) => {
      capturedUrl = url;
      capturedBody = JSON.parse(init?.body as string) as Record<string, unknown>;
      return new Response(
        JSON.stringify({
          jsonrpc: '2.0',
          id: '1',
          result: 'task_abc',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }) as unknown as typeof fetch;

    const svc = buildRelayerService({
      paymentTokenAddress: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    });
    const result = await svc.send7710Transaction({
      chainId: 8453,
      transactions: [
        {
          permissionContext: [
            {
              delegate: '0x1234567890123456789012345678901234567890',
              delegator: '0x2345678901234567890123456789012345678901',
              authority: '0xROOT',
              caveats: [],
              salt: '0x00',
              signature: '0x',
            },
          ],
          executions: [
            {
              target: '0x1111111111111111111111111111111111111111',
              data: '0xdeadbeef',
              value: '0x0',
            },
          ],
        },
      ],
      context: '0xctx',
    });

    expect(capturedUrl).toBe('https://relayer.1shotapi.dev/relayers');
    expect(capturedBody?.['jsonrpc'] as unknown as string).toBe('2.0');
    expect(capturedBody?.['method'] as unknown as string).toBe('relayer_send7710Transaction');
    const params = capturedBody?.['params'] as unknown as Record<string, unknown>;
    expect(params.chainId).toBe('8453');
    expect(typeof params.taskId).toBe('string');
    const tx = (params.transactions as Array<Record<string, unknown>>)[0];
    expect(Array.isArray(tx.permissionContext)).toBe(true);
    const exec = (tx.executions as Array<Record<string, unknown>>)[0];
    expect(exec.target).toBe('0x1111111111111111111111111111111111111111');
    expect(exec.data).toBe('0xdeadbeef');

    expect(result.taskId).toBe('task_abc');
    expect(result.raw).toBe('task_abc');
  });

  it('maps statusCode 100/110/200/400/500 to name', async () => {
    const cases: Array<[number, 'pending' | 'submitted' | 'confirmed' | 'rejected' | 'reverted']> =
      [
        [100, 'pending'],
        [110, 'submitted'],
        [200, 'confirmed'],
        [400, 'rejected'],
        [500, 'reverted'],
      ];
    for (const [code, _name] of cases) {
      globalThis.fetch = mock(async () => {
        return new Response(
          JSON.stringify({
            jsonrpc: '2.0',
            id: '1',
            result: { id: 't', status: code, chainId: '8453', createdAt: 1710000000 },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }) as unknown as typeof fetch;
      const svc = buildRelayerService({
        paymentTokenAddress: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
      });
      const result = await svc.getStatus('t');
      expect(result.statusCode as number).toBe(code);
      expect(result.status).toBe(_name);
    }
  });

  it('maps JSON-RPC error code 4200 → ONESHOT_INSUFFICIENT_PAYMENT', async () => {
    globalThis.fetch = mock(async () => {
      return new Response(
        JSON.stringify({
          jsonrpc: '2.0',
          id: '1',
          error: { code: 4200, message: 'bad params' },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }) as unknown as typeof fetch;
    const svc = buildRelayerService({
      paymentTokenAddress: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    });
    try {
      await svc.send7710Transaction({
        chainId: 8453,
        transactions: [],
      });
      throw new Error('should have thrown');
    } catch (err) {
      expect((err as { code: string }).code).toBe(ErrorCode.ONESHOT_INSUFFICIENT_PAYMENT);
    }
  });

  it('maps JSON-RPC error code 4202 → ONESHOT_PAYMENT_TOKEN_UNSUPPORTED', async () => {
    globalThis.fetch = mock(
      async () =>
        new Response(
          JSON.stringify({
            jsonrpc: '2.0',
            id: '1',
            error: { code: 4202, message: 'task not found' },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
    ) as unknown as typeof fetch;
    const svc = buildRelayerService({
      paymentTokenAddress: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    });
    try {
      await svc.getStatus('missing_task');
      throw new Error('should have thrown');
    } catch (err) {
      expect((err as { code: string }).code).toBe(ErrorCode.ONESHOT_PAYMENT_TOKEN_UNSUPPORTED);
    }
  });

  it('maps JSON-RPC error code 4211 → ONESHOT_SIMULATION_FAILED', async () => {
    globalThis.fetch = mock(
      async () =>
        new Response(
          JSON.stringify({
            jsonrpc: '2.0',
            id: '1',
            error: { code: 4211, message: 'simulation failed' },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
    ) as unknown as typeof fetch;
    const svc = buildRelayerService({
      paymentTokenAddress: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    });
    try {
      await svc.getStatus('t');
      throw new Error('should have thrown');
    } catch (err) {
      expect((err as { code: string }).code).toBe(ErrorCode.ONESHOT_SIMULATION_FAILED);
    }
  });

  it('getCapabilities passes chain id as params[0]', async () => {
    let capturedBody: Record<string, unknown> | null = null;
    globalThis.fetch = mock(async (_url: string, init?: RequestInit) => {
      capturedBody = JSON.parse(init?.body as string) as Record<string, unknown>;
      return new Response(
        JSON.stringify({
          jsonrpc: '2.0',
          id: '1',
          result: {
            '11155111': {
              feeCollector: '0xE936e8FAf4A5655469182A49a505055B71C17604',
              targetAddress: '0x02c9979a75fbdbc3a77485024ab8b6474308591e',
              tokens: [
                {
                  address: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
                  symbol: 'USDC',
                  decimals: 6,
                },
              ],
            },
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }) as unknown as typeof fetch;
    const svc = buildRelayerService();
    const caps = await svc.getCapabilities(11155111);
    const params = capturedBody?.['params'] as unknown as unknown[];
    expect(Array.isArray(params)).toBe(true);
    expect(params[0]).toBe('11155111');
    expect(caps.chains).toHaveLength(1);
    expect(caps.chains[0]?.chainId).toBe('11155111');
    expect(caps.chains[0]?.feeCollector).toBe('0xE936e8FAf4A5655469182A49a505055B71C17604');
    expect(caps.chains[0]?.tokens[0]?.symbol).toBe('USDC');
  });

  it('getFeeData passes {chainId, token} as object params', async () => {
    let capturedBody: Record<string, unknown> | null = null;
    globalThis.fetch = mock(async (_url: string, init?: RequestInit) => {
      capturedBody = JSON.parse(init?.body as string) as Record<string, unknown>;
      return new Response(
        JSON.stringify({
          jsonrpc: '2.0',
          id: '1',
          result: {
            chainId: '11155111',
            token: { address: '0xUSDC', symbol: 'USDC', decimals: 6 },
            rate: 2000,
            minFee: '0.01',
            expiry: 1780414494,
            gasPrice: '1213024330',
            feeCollector: '0xFC',
            targetAddress: '0xTA',
            context: '{}',
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }) as unknown as typeof fetch;
    const svc = buildRelayerService({
      paymentTokenAddress: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    });
    const fee = await svc.getFeeData({
      chainId: 11155111,
      transactions: [{ permissionContext: [] as OneShotDelegation[], executions: [] }],
    });
    const params = capturedBody?.['params'] as unknown as Record<string, unknown>;
    expect(params.chainId).toBe('11155111');
    expect(params.token).toBe('0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48');
    expect(fee.rate).toBe(2000);
    expect(fee.minFee).toBe('0.01');
    expect(fee.feeCollector).toBe('0xFC');
  });

  it('uses mainnet URL when ONESHOT_NETWORK=mainnet', async () => {
    let capturedUrl = '';
    globalThis.fetch = mock(async (url: string) => {
      capturedUrl = url;
      return new Response(
        JSON.stringify({
          jsonrpc: '2.0',
          id: '1',
          result: {},
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }) as unknown as typeof fetch;
    const svc = buildRelayerService({
      network: 'mainnet',
      paymentTokenAddress: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    });
    await svc.getCapabilities(1);
    expect(capturedUrl).toBe('https://relayer.1shotapi.com/relayers');
  });

  it('uses custom ONESHOT_RELAYER_URL when provided', async () => {
    let capturedUrl = '';
    globalThis.fetch = mock(async (url: string) => {
      capturedUrl = url;
      return new Response(
        JSON.stringify({
          jsonrpc: '2.0',
          id: '1',
          result: {},
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }) as unknown as typeof fetch;
    const svc = buildRelayerService({
      relayerUrl: 'https://custom.example.com',
      paymentTokenAddress: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    });
    await svc.getCapabilities();
    expect(capturedUrl).toBe('https://custom.example.com');
  });

  it('sends plain JSON headers for the public relayer', async () => {
    let capturedHeaders: Record<string, string> = {};
    globalThis.fetch = mock(async (_url: string, init?: RequestInit) => {
      const h = (init?.headers ?? {}) as Record<string, string>;
      capturedHeaders = h;
      return new Response(
        JSON.stringify({
          jsonrpc: '2.0',
          id: '1',
          result: {},
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }) as unknown as typeof fetch;
    const svc = buildRelayerService();
    await svc.getCapabilities();
    expect(capturedHeaders['x-api-key']).toBeUndefined();
    expect(capturedHeaders['x-api-secret']).toBeUndefined();
    expect(capturedHeaders['Content-Type']).toBe('application/json');
  });
});
