import { describe, it, expect, beforeEach, mock } from 'bun:test';
import { OneShotRelayerService } from '../src/runtime/relayers/oneshot-relayer.service';

function buildService(overrides: Partial<{ enabled: boolean; baseUrl: string; apiKey: string; secret: string }> = {}) {
  const config: any = {
    get: (key: string) => {
      const map: Record<string, string> = {
        ONESHOT_ENABLED: overrides.enabled ? 'true' : 'false',
        ONESHOT_BASE_URL: overrides.baseUrl ?? '',
        ONESHOT_API_KEY: overrides.apiKey ?? '',
        ONESHOT_WEBHOOK_SECRET: overrides.secret ?? '',
      };
      return map[key] ?? '';
    },
  };
  return new OneShotRelayerService(config);
}

describe('OneShotRelayerService', () => {
  it('throws NOT_CONFIGURED when disabled', async () => {
    const svc = buildService();
    await expect(
      svc.relayDelegatedExecution({ chainId: 8453, calls: [{ to: '0x1234', data: '0x' }] }),
    ).rejects.toThrow(/not enabled/i);
  });

  it('throws NOT_CONFIGURED when enabled but missing api key', async () => {
    const svc = buildService({ enabled: true, baseUrl: 'https://relay.example.com' });
    await expect(
      svc.relayDelegatedExecution({ chainId: 8453, calls: [{ to: '0x1234', data: '0x' }] }),
    ).rejects.toThrow(/ONESHOT_BASE_URL or ONESHOT_API_KEY/i);
  });

  it('relays when configured and returns mapped fields', async () => {
    const original = globalThis.fetch;
    globalThis.fetch = mock(async () =>
      new Response(JSON.stringify({ relayId: 'relay_1', status: 'submitted', txHash: '0xhash' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    ) as any;
    try {
      const svc = buildService({ enabled: true, baseUrl: 'https://relay.example.com', apiKey: 'k' });
      const result = await svc.relayDelegatedExecution({
        chainId: 8453,
        delegationManager: '0x1234567890123456789012345678901234567890',
        calls: [{ to: '0x1234', data: '0xabcd' }],
      });
      expect(result.relayId).toBe('relay_1');
      expect(result.status).toBe('submitted');
    } finally {
      globalThis.fetch = original;
    }
  });

  it('maps non-2xx to RELAYER_ERROR', async () => {
    const original = globalThis.fetch;
    globalThis.fetch = mock(async () => new Response('bad', { status: 500 })) as any;
    try {
      const svc = buildService({ enabled: true, baseUrl: 'https://relay.example.com', apiKey: 'k' });
      await expect(
        svc.relayDelegatedExecution({ chainId: 8453, calls: [{ to: '0x1234', data: '0x' }] }),
      ).rejects.toThrow(/returned status 500/);
    } finally {
      globalThis.fetch = original;
    }
  });

  it('verifies webhook signature with hmac-sha256', () => {
    const svc = buildService({ enabled: true, secret: 'shh' });
    const payload = '{"hello":"world"}';
    const crypto = require('crypto');
    const sig = crypto.createHmac('sha256', 'shh').update(payload).digest('hex');
    expect(svc.verifyWebhookSignature(payload, sig)).toBe(true);
    expect(svc.verifyWebhookSignature(payload, '0x' + '00'.repeat(32))).toBe(false);
  });
});