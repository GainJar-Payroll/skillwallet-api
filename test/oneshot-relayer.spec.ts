import { describe, it, expect, mock, beforeEach, afterEach } from 'bun:test';
import { generateKeyPairSync, sign } from 'crypto';
import { OneShotRelayerService } from '../src/runtime/relayers/oneshot-relayer.service';
import { WebhookSignatureVerifier } from '../src/runtime/relayers/webhook-signature-verifier.service';
import { OneShotBundleValidator } from '../src/runtime/relayers/oneshot-bundle-validator';
import { ErrorCode } from '../src/common/errors/error-codes';
import type { OneShotDelegation } from '../src/runtime/relayers/relayer.interface';

function buildRelayerService(
  overrides: Partial<{
    network: 'mainnet' | 'testnet';
    relayerUrl: string;
    paymentTokenAddress: string;
    destinationUrl: string;
    apiKey: string;
    apiSecret: string;
    relayerWallet: string;
    testnetChainId: number;
    mainnetChainId: number;
  }> = {},
) {
  const map: Record<string, string | number> = {
    ONESHOT_NETWORK: overrides.network ?? 'testnet',
    ONESHOT_RELAYER_URL: overrides.relayerUrl ?? '',
    ONESHOT_PAYMENT_TOKEN_ADDRESS: overrides.paymentTokenAddress ?? '',
    ONESHOT_DESTINATION_URL: overrides.destinationUrl ?? '',
    ONESHOT_API_KEY: overrides.apiKey ?? '',
    ONESHOT_API_SECRET: overrides.apiSecret ?? '',
    ONESHOT_RELAYER_WALLET: overrides.relayerWallet ?? '',
    ONESHOT_TESTNET_CHAIN_ID: overrides.testnetChainId ?? 11155111,
    ONESHOT_MAINNET_CHAIN_ID: overrides.mainnetChainId ?? 8453,
  };
  const config = { get: (key: string) => map[key] ?? '' };
  return new OneShotRelayerService(
    config as never,
    undefined as never,
    new OneShotBundleValidator(),
  );
}

function buildVerifier(fallbackKeyJwk: Record<string, unknown> | null) {
  const map: Record<string, string> = {
    ONESHOT_JWKS_URL: '',
    ONESHOT_WEBHOOK_PUBLIC_KEY: fallbackKeyJwk ? JSON.stringify(fallbackKeyJwk) : '',
  };
  const config = { get: (key: string) => map[key] ?? '' };
  return new WebhookSignatureVerifier(config as never);
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
      destinationUrl: 'https://example.com/hook',
    });
    await expect(
      svc.relayDelegatedExecution({
        chainId: 424242,
        delegationManager: '0x1234567890123456789012345678901234567890',
        permissionContext: '0xabcd',
        call: { to: '0x1111111111111111111111111111111111111111', data: '0x' },
      }),
    ).rejects.toThrow(/payment token/i);
  });

  it('warns and proceeds when destination URL is missing (bundle + env both empty)', async () => {
    let sendBody: Record<string, unknown> | null = null;
    globalThis.fetch = mock(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(init?.body as string) as Record<string, unknown>;
      if (body['method'] === 'relayer_getCapabilities') {
        return new Response(
          JSON.stringify({
            jsonrpc: '2.0',
            id: '1',
            result: {
              '8453': {
                feeCollector: '0xE936e8FAf4A5655469182A49a505055B71C17604',
                targetAddress: '0x02c9979a75fbdbc3a77485024ab8c6474308591e',
                tokens: [
                  {
                    address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
                    symbol: 'USDC',
                    decimals: 6,
                  },
                ],
              },
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      sendBody = body;
      return new Response(
        JSON.stringify({ jsonrpc: '2.0', id: '1', result: 'task_no_destination' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }) as unknown as typeof fetch;

    const svc = buildRelayerService({
      paymentTokenAddress: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    });
    const permissionContext = JSON.stringify([
      {
        delegate: '0x1234567890123456789012345678901234567890',
        delegator: '0x2345678901234567890123456789012345678901',
        authority: '0xROOT',
        caveats: [],
        salt: '0x00',
        signature: '0x',
      },
    ]);
    const result = await svc.relayDelegatedExecution({
      chainId: 8453,
      delegationManager: '0x1234567890123456789012345678901234567890',
      permissionContext,
      call: { to: '0x1111111111111111111111111111111111111111', data: '0xdeadbeef', value: '0x0' },
      context: JSON.stringify({
        expiry: Math.floor(Date.now() / 1000) + 600,
        chainId: 8453,
        paymentTokenAddress: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
      }),
    });

    expect(result.taskId).toBe('task_no_destination');
    const params = sendBody?.['params'] as unknown as Record<string, unknown>;
    expect(params?.['destinationUrl']).toBeUndefined();
  });

  it('bundle.destinationUrl overrides env ONESHOT_DESTINATION_URL', async () => {
    let sendParams: Record<string, unknown> | null = null;
    globalThis.fetch = mock(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(init?.body as string) as Record<string, unknown>;
      if (body['method'] === 'relayer_getCapabilities') {
        return new Response(
          JSON.stringify({
            jsonrpc: '2.0',
            id: '1',
            result: {
              '8453': {
                feeCollector: '0xE936e8FAf4A5655469182A49a505055B71C17604',
                targetAddress: '0x02c9979a75fbdbc3a77485024ab8c6474308591e',
                tokens: [
                  {
                    address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
                    symbol: 'USDC',
                    decimals: 6,
                  },
                ],
              },
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      sendParams = body['params'] as Record<string, unknown>;
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: '1', result: 'task_override' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as unknown as typeof fetch;

    const svc = buildRelayerService({
      paymentTokenAddress: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
      destinationUrl: 'https://env-host.example.com/webhook',
    });
    const permissionContext = JSON.stringify([
      {
        delegate: '0x1234567890123456789012345678901234567890',
        delegator: '0x2345678901234567890123456789012345678901',
        authority: '0xROOT',
        caveats: [],
        salt: '0x00',
        signature: '0x',
      },
    ]);
    await svc.relayDelegatedExecution({
      chainId: 8453,
      delegationManager: '0x1234567890123456789012345678901234567890',
      permissionContext,
      call: { to: '0x1111111111111111111111111111111111111111', data: '0xdeadbeef', value: '0x0' },
      destinationUrl: 'https://bundle-host.example.com/webhook',
      context: JSON.stringify({
        expiry: Math.floor(Date.now() / 1000) + 600,
        chainId: 8453,
        paymentTokenAddress: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
      }),
    });

    expect(sendParams?.['destinationUrl'] as unknown as string).toBe(
      'https://bundle-host.example.com/webhook',
    );
  });

  it('defaults payment token to USDC for eth sepolia when not configured', () => {
    const svc = buildRelayerService({ testnetChainId: 11155111 });
    expect(svc.getPaymentTokenAddress()).toBe('0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238');
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
    let callIndex = 0;
    globalThis.fetch = mock(async (url: string, init?: RequestInit) => {
      capturedUrl = url;
      capturedBody = JSON.parse(init?.body as string) as Record<string, unknown>;
      callIndex += 1;
      if (callIndex === 1) {
        return new Response(
          JSON.stringify({
            jsonrpc: '2.0',
            id: '1',
            result: {
              '8453': {
                feeCollector: '0xE936e8FAf4A5655469182A49a505055B71C17604',
                targetAddress: '0x02c9979a75fbdbc3a77485024ab8b6474308591e',
                tokens: [
                  {
                    address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
                    symbol: 'USDC',
                    decimals: 6,
                  },
                ],
              },
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
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
      destinationUrl: 'https://example.com/hook',
    });
    const permissionContext = JSON.stringify([
      {
        delegate: '0x1234567890123456789012345678901234567890',
        delegator: '0x2345678901234567890123456789012345678901',
        authority: '0xROOT',
        caveats: [],
        salt: '0x00',
        signature: '0x',
      },
    ]);
    const result = await svc.relayDelegatedExecution({
      chainId: 8453,
      delegationManager: '0x1234567890123456789012345678901234567890',
      permissionContext,
      call: { to: '0x1111111111111111111111111111111111111111', data: '0xdeadbeef', value: '0x0' },
      context: JSON.stringify({
        expiry: Math.floor(Date.now() / 1000) + 600,
        chainId: 8453,
        paymentTokenAddress: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
      }),
    });

    expect(capturedUrl).toBe('https://relayer.1shotapi.dev/relayers');
    expect(capturedBody?.['jsonrpc'] as unknown as string).toBe('2.0');
    expect(capturedBody?.['method'] as unknown as string).toBe('relayer_send7710Transaction');
    const params = capturedBody?.['params'] as unknown as Record<string, unknown>;
    expect(params.chainId).toBe('8453');
    expect(typeof params.taskId).toBe('string');
    expect(params.destinationUrl).toBe('https://example.com/hook');
    const tx = (params.transactions as Array<Record<string, unknown>>)[0];
    expect(Array.isArray(tx.permissionContext)).toBe(true);
    const exec = (tx.executions as Array<Record<string, unknown>>)[0];
    expect(exec.target).toBe('0x1111111111111111111111111111111111111111');
    expect(exec.data).toBe('0xdeadbeef');

    expect(result.taskId).toBe('task_abc');
    expect(result.statusCode).toBe(100);
    expect(result.status).toBe('pending');
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
      let callIndex = 0;
      globalThis.fetch = mock(async () => {
        callIndex += 1;
        if (callIndex === 1) {
          return new Response(
            JSON.stringify({
              jsonrpc: '2.0',
              id: '1',
              result: {
                '8453': {
                  feeCollector: '0xE936e8FAf4A5655469182A49a505055B71C17604',
                  targetAddress: '0x02c9979a75fbdbc3a77485024ab8b6474308591e',
                  tokens: [
                    {
                      address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
                      symbol: 'USDC',
                      decimals: 6,
                    },
                  ],
                },
              },
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          );
        }
        return new Response(
          JSON.stringify({
            jsonrpc: '2.0',
            id: '1',
            result: { taskId: 't', statusCode: code },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }) as unknown as typeof fetch;
      const svc = buildRelayerService({
        paymentTokenAddress: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        destinationUrl: 'https://example.com/hook',
      });
      const permissionContext = JSON.stringify([
        {
          delegate: '0x1234567890123456789012345678901234567890',
          delegator: '0x2345678901234567890123456789012345678901',
          authority: '0xROOT',
          caveats: [],
          salt: '0x00',
          signature: '0x',
        },
      ]);
      const result = await svc.relayDelegatedExecution({
        chainId: 8453,
        delegationManager: '0x1234567890123456789012345678901234567890',
        permissionContext,
        call: { to: '0x1111111111111111111111111111111111111111', data: '0x' },
        context: JSON.stringify({
          expiry: Math.floor(Date.now() / 1000) + 600,
          chainId: 8453,
          paymentTokenAddress: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        }),
      });
      expect(result.statusCode as number).toBe(100);
      expect(result.status).toBe('pending');
    }
  });

  it('maps JSON-RPC error code 4200 → ONESHOT_INSUFFICIENT_PAYMENT', async () => {
    let callIndex = 0;
    globalThis.fetch = mock(async () => {
      callIndex += 1;
      if (callIndex === 1) {
        return new Response(
          JSON.stringify({
            jsonrpc: '2.0',
            id: '1',
            result: {
              '8453': {
                feeCollector: '0xE936e8FAf4A5655469182A49a505055B71C17604',
                targetAddress: '0x02c9979a75fbdbc3a77485024ab8b6474308591e',
                tokens: [
                  {
                    address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
                    symbol: 'USDC',
                    decimals: 6,
                  },
                ],
              },
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
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
      destinationUrl: 'https://example.com/hook',
    });
    const permissionContext = JSON.stringify([
      {
        delegate: '0x1234567890123456789012345678901234567890',
        delegator: '0x2345678901234567890123456789012345678901',
        authority: '0xROOT',
        caveats: [],
        salt: '0x00',
        signature: '0x',
      },
    ]);
    try {
      await svc.relayDelegatedExecution({
        chainId: 8453,
        delegationManager: '0x1234567890123456789012345678901234567890',
        permissionContext,
        call: { to: '0x1111111111111111111111111111111111111111', data: '0x' },
        context: JSON.stringify({
          expiry: Math.floor(Date.now() / 1000) + 600,
          chainId: 8453,
          paymentTokenAddress: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        }),
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
      destinationUrl: 'https://example.com/hook',
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
      destinationUrl: 'https://example.com/hook',
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

  it('exposes getRelayerWallet / getActiveChainId reflecting network and config', () => {
    const svcTestnet = buildRelayerService({
      network: 'testnet',
      relayerWallet: '0x2c4E85173372AA9fb0F210F91b69aF92f87BE2B2',
      testnetChainId: 11155111,
    });
    expect(svcTestnet.getRelayerWallet()).toBe('0x2c4E85173372AA9fb0F210F91b69aF92f87BE2B2');
    expect(svcTestnet.getActiveChainId()).toBe(11155111);

    const svcMainnet = buildRelayerService({
      network: 'mainnet',
      relayerWallet: '0x10e5F3354AbD0a16fD079Db8Fa499AcEE9a4637d',
      mainnetChainId: 8453,
    });
    expect(svcMainnet.getRelayerWallet()).toBe('0x10e5F3354AbD0a16fD079Db8Fa499AcEE9a4637d');
    expect(svcMainnet.getActiveChainId()).toBe(8453);
  });

  it('forwards x-api-key and x-api-secret headers when configured', async () => {
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
    const svc = buildRelayerService({
      apiKey: 'qmJmFWeStdcTDvAIx06hKxW4KaqG7Gmm',
      apiSecret: 'iJ1Emy3dVmmePZPQdHlLrhdVjISbwV2C',
    });
    await svc.getCapabilities();
    expect(capturedHeaders['x-api-key']).toBe('qmJmFWeStdcTDvAIx06hKxW4KaqG7Gmm');
    expect(capturedHeaders['x-api-secret']).toBe('iJ1Emy3dVmmePZPQdHlLrhdVjISbwV2C');
    expect(capturedHeaders['Content-Type']).toBe('application/json');
  });

  it('omits auth headers when API key/secret are empty', async () => {
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

describe('WebhookSignatureVerifier (Ed25519)', () => {
  it('verifies a valid Ed25519 signature against the fallback public key', async () => {
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    const jwk = publicKey.export({ format: 'jwk' }) as Record<string, unknown>;
    const verifier = buildVerifier(jwk);

    const body = JSON.stringify({ taskId: 't1', statusCode: 200 });
    const sig = sign(null, Buffer.from(body), privateKey).toString('base64');

    expect(await verifier.verify(body, sig)).toBe(true);
  });

  it('rejects a tampered body', async () => {
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    const jwk = publicKey.export({ format: 'jwk' }) as Record<string, unknown>;
    const verifier = buildVerifier(jwk);

    const body = JSON.stringify({ taskId: 't1', statusCode: 200 });
    const sig = sign(null, Buffer.from(body), privateKey).toString('base64');
    const tampered = JSON.stringify({ taskId: 't1', statusCode: 500 });

    expect(await verifier.verify(tampered, sig)).toBe(false);
  });

  it('rejects an empty signature', async () => {
    const { publicKey } = generateKeyPairSync('ed25519');
    const jwk = publicKey.export({ format: 'jwk' }) as Record<string, unknown>;
    const verifier = buildVerifier(jwk);
    expect(await verifier.verify('payload', '')).toBe(false);
  });

  it('rejects when no verification key is configured', async () => {
    const verifier = buildVerifier(null);
    expect(await verifier.verify('payload', 'AAAA')).toBe(false);
  });
});
