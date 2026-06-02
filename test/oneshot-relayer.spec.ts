import { describe, it, expect, mock, beforeEach, afterEach } from 'bun:test';
import { generateKeyPairSync, sign } from 'crypto';
import { OneShotRelayerService } from '../src/runtime/relayers/oneshot-relayer.service';
import { WebhookSignatureVerifier } from '../src/runtime/relayers/webhook-signature-verifier.service';
import { ErrorCode } from '../src/common/errors/error-codes';

function buildRelayerService(
  overrides: Partial<{
    network: 'mainnet' | 'testnet';
    relayerUrl: string;
    paymentTokenAddress: string;
    destinationUrl: string;
  }> = {},
) {
  const map: Record<string, string> = {
    ONESHOT_NETWORK: overrides.network ?? 'testnet',
    ONESHOT_RELAYER_URL: overrides.relayerUrl ?? '',
    ONESHOT_PAYMENT_TOKEN_ADDRESS: overrides.paymentTokenAddress ?? '',
    ONESHOT_DESTINATION_URL: overrides.destinationUrl ?? '',
  };
  const config = { get: (key: string) => map[key] ?? '' };
  return new OneShotRelayerService(config as never);
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

  it('throws NOT_CONFIGURED when payment token missing on relay', async () => {
    const svc = buildRelayerService({ destinationUrl: 'https://example.com/hook' });
    await expect(
      svc.relayDelegatedExecution({
        chainId: 8453,
        delegationManager: '0x1234567890123456789012345678901234567890',
        permissionContext: '0xabcd',
        call: { to: '0x1234', data: '0x' },
      }),
    ).rejects.toThrow(/payment token/i);
  });

  it('throws NOT_CONFIGURED when destination URL missing', async () => {
    const svc = buildRelayerService({
      paymentTokenAddress: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    });
    await expect(
      svc.relayDelegatedExecution({
        chainId: 8453,
        delegationManager: '0x1234567890123456789012345678901234567890',
        permissionContext: '0xabcd',
        call: { to: '0x1234', data: '0x' },
      }),
    ).rejects.toThrow(/destination/i);
  });

  it('posts JSON-RPC envelope to /rpc with correct bundle shape', async () => {
    let capturedUrl = '';
    let capturedBody: Record<string, unknown> | null = null;
    globalThis.fetch = mock(async (url: string, init?: RequestInit) => {
      capturedUrl = url;
      capturedBody = JSON.parse(init?.body as string) as Record<string, unknown>;
      return new Response(
        JSON.stringify({
          jsonrpc: '2.0',
          id: '1',
          result: {
            taskId: 'task_abc',
            statusCode: 110,
            targetAddress: '0xsmart',
            paymentToken: '0xusdc',
            requiredPaymentAmount: '100000',
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }) as unknown as typeof fetch;

    const svc = buildRelayerService({
      paymentTokenAddress: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
      destinationUrl: 'https://example.com/hook',
    });
    const result = await svc.relayDelegatedExecution({
      chainId: 8453,
      delegationManager: '0x1234567890123456789012345678901234567890',
      permissionContext: '0xabcd',
      call: { to: '0x1234', data: '0xdeadbeef', value: '0x0' },
    });

    expect(capturedUrl).toBe('https://relayer.1shotapi.dev/relayers/rpc');
    expect(capturedBody?.['jsonrpc'] as unknown as string).toBe('2.0');
    expect(capturedBody?.['method'] as unknown as string).toBe('relayer_send7710Transaction');
    const params = ((capturedBody?.['params'] as unknown[] | undefined) ?? [])[0] as Record<
      string,
      unknown
    >;
    expect(params.chainId).toBe(8453);
    expect(typeof params.taskId).toBe('string');
    expect(params.destinationUrl).toBe('https://example.com/hook');
    const tx = (params.transactions as Array<Record<string, unknown>>)[0];
    expect(tx.permissionContext).toBe('0xabcd');
    const exec = (tx.executions as Array<Record<string, unknown>>)[0];
    expect(exec.target).toBe('0x1234');
    expect(exec.callData).toBe('0xdeadbeef');

    expect(result.taskId).toBe('task_abc');
    expect(result.statusCode).toBe(110);
    expect(result.status).toBe('submitted');
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
    for (const [code, name] of cases) {
      globalThis.fetch = mock(
        async () =>
          new Response(
            JSON.stringify({
              jsonrpc: '2.0',
              id: '1',
              result: {
                taskId: 't',
                statusCode: code,
                targetAddress: '0xx',
                paymentToken: '0xy',
                requiredPaymentAmount: '0',
              },
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          ),
      ) as unknown as typeof fetch;
      const svc = buildRelayerService({
        paymentTokenAddress: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        destinationUrl: 'https://example.com/hook',
      });
      const result = await svc.relayDelegatedExecution({
        chainId: 8453,
        delegationManager: '0x1234567890123456789012345678901234567890',
        permissionContext: '0xabcd',
        call: { to: '0x1234', data: '0x' },
      });
      expect(result.statusCode as number).toBe(code);
      expect(result.status).toBe(name);
    }
  });

  it('maps JSON-RPC error code 4200 → VALIDATION_ERROR', async () => {
    globalThis.fetch = mock(
      async () =>
        new Response(
          JSON.stringify({
            jsonrpc: '2.0',
            id: '1',
            error: { code: 4200, message: 'bad params' },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
    ) as unknown as typeof fetch;
    const svc = buildRelayerService({
      paymentTokenAddress: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
      destinationUrl: 'https://example.com/hook',
    });
    try {
      await svc.relayDelegatedExecution({
        chainId: 8453,
        delegationManager: '0x1234567890123456789012345678901234567890',
        permissionContext: '0xabcd',
        call: { to: '0x1234', data: '0x' },
      });
      throw new Error('should have thrown');
    } catch (err) {
      expect((err as { code: string }).code).toBe(ErrorCode.VALIDATION_ERROR);
    }
  });

  it('maps JSON-RPC error code 4202 → NOT_FOUND', async () => {
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
      expect((err as { code: string }).code).toBe(ErrorCode.NOT_FOUND);
    }
  });

  it('maps JSON-RPC error code 4211 → RELAYER_ERROR (insufficient funds)', async () => {
    globalThis.fetch = mock(
      async () =>
        new Response(
          JSON.stringify({
            jsonrpc: '2.0',
            id: '1',
            error: { code: 4211, message: 'insufficient funds' },
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
      expect((err as { code: string }).code).toBe(ErrorCode.RELAYER_ERROR);
    }
  });

  it('uses mainnet URL when ONESHOT_NETWORK=mainnet', async () => {
    let capturedUrl = '';
    globalThis.fetch = mock(async (url: string) => {
      capturedUrl = url;
      return new Response(
        JSON.stringify({
          jsonrpc: '2.0',
          id: '1',
          result: { networks: [1], methods: [], features: [] },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }) as unknown as typeof fetch;
    const svc = buildRelayerService({
      network: 'mainnet',
      paymentTokenAddress: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
      destinationUrl: 'https://example.com/hook',
    });
    await svc.getCapabilities();
    expect(capturedUrl).toBe('https://relayer.1shotapi.com/relayers/rpc');
  });

  it('uses custom ONESHOT_RELAYER_URL when provided', async () => {
    let capturedUrl = '';
    globalThis.fetch = mock(async (url: string) => {
      capturedUrl = url;
      return new Response(
        JSON.stringify({
          jsonrpc: '2.0',
          id: '1',
          result: { networks: [1], methods: [], features: [] },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }) as unknown as typeof fetch;
    const svc = buildRelayerService({
      relayerUrl: 'https://custom.example.com',
      paymentTokenAddress: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
      destinationUrl: 'https://example.com/hook',
    });
    await svc.getCapabilities();
    expect(capturedUrl).toBe('https://custom.example.com/rpc');
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
