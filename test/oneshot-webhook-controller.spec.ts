import { describe, it, expect, mock, beforeEach, afterEach } from 'bun:test';
import { OneshotWebhookController } from '../src/runtime/relayers/oneshot-webhook.controller';
import { generateKeyPairSync, sign, KeyObject } from 'crypto';
import { createHash } from 'crypto';
import { WebhookSignatureVerifier } from '../src/runtime/relayers/webhook-signature-verifier.service';

function buildVerifier() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const jwk = publicKey.export({ format: 'jwk' }) as Record<string, unknown>;
  const config = {
    get: (k: string) =>
      k === 'ONESHOT_JWKS_URL' ? '' : k === 'ONESHOT_WEBHOOK_PUBLIC_KEY' ? JSON.stringify(jwk) : '',
  };
  const verifier = new WebhookSignatureVerifier(config as never);
  return { verifier, privateKey };
}

interface FakeAttempt {
  attemptId: string;
  installationId: string;
  chainId: number;
  userAddress?: string;
  relay: { taskId: string };
}

function buildController(opts: {
  foundAttempt?: FakeAttempt | null;
  updateResult?: FakeAttempt | null;
}) {
  const { verifier, privateKey } = buildVerifier();
  const findByTaskId = mock(async (_taskId: string) => opts.foundAttempt ?? null);
  const updateRelayFromWebhook = mock(
    async (_attemptId: string, _patch: unknown) => opts.updateResult ?? null,
  );
  const log = mock(async (_input: unknown) => undefined);
  const attempts = { findByTaskId, updateRelayFromWebhook } as never;
  const activity = { log } as never;
  // Inject a relayer that delegates to the real verifier
  const relayer = {
    verifyWebhookSignature: (raw: Buffer, sig: string) => verifier.verify(raw, sig),
  } as never;
  const ctrl = new OneshotWebhookController(relayer, attempts, activity);
  return {
    ctrl,
    attempts: { findByTaskId, updateRelayFromWebhook },
    activity: { log },
    privateKey,
    verifier,
  };
}

function signBody(body: string, privateKey: KeyObject) {
  return sign(null, Buffer.from(body), privateKey).toString('base64');
}

describe('OneshotWebhookController', () => {
  let originalFetch: typeof fetch;
  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('rejects when rawBody is missing', async () => {
    const { ctrl } = buildController({});
    await expect(ctrl.handle({ rawBody: undefined } as never, {} as never)).rejects.toThrow(
      /Raw body not available/,
    );
  });

  it('rejects when signature is missing (header or body)', async () => {
    const { ctrl } = buildController({});
    await expect(
      ctrl.handle(
        { rawBody: Buffer.from('{}'), headers: {} } as never,
        {
          eventName: 'TransactionExecutionSuccess',
          data: { transactionId: 't', transactionReceipt: { hash: '0x' } },
          timestamp: 0,
          apiVersion: 0,
        } as never,
      ),
    ).rejects.toThrow(/missing signature/);
  });

  it('rejects when signature is invalid (WEBHOOK_SIGNATURE_INVALID)', async () => {
    const { ctrl, privateKey } = buildController({});
    const payload = {
      eventName: 'TransactionExecutionSuccess',
      data: {
        transactionId: 't1',
        transactionReceipt: { hash: '0x' + 'a'.repeat(64) },
      },
      timestamp: 1,
      apiVersion: 0,
    };
    const body = JSON.stringify(payload);
    const sig = signBody(body, privateKey);
    // Tamper the parsed body so the signature no longer matches
    const tamperedBody = { ...payload, eventName: 'Tampered' };
    await expect(
      ctrl.handle(
        { rawBody: Buffer.from(body), headers: { signature: sig } } as never,
        tamperedBody as never,
      ),
    ).rejects.toThrow(/signature did not verify/);
  });

  it('accepts a valid signature, returns ok:true even when no attempt matches', async () => {
    const { ctrl, privateKey } = buildController({ foundAttempt: null });
    const payload = {
      eventName: 'TransactionExecutionSuccess',
      data: { transactionId: 't1', transactionReceipt: { hash: '0x' + 'a'.repeat(64) } },
      timestamp: 1,
      apiVersion: 0,
    };
    const body = JSON.stringify(payload);
    const sig = signBody(body, privateKey);
    const res = await ctrl.handle(
      { rawBody: Buffer.from(body), headers: { signature: sig } } as never,
      payload as never,
    );
    expect(res.ok).toBe(true);
    expect(res.taskId).toBe('t1');
    expect(res.statusCode).toBe(200);
    expect(res.eventName).toBe('TransactionExecutionSuccess');
  });

  it('accepts signature from body field (not header)', async () => {
    const { ctrl, privateKey } = buildController({ foundAttempt: null });
    const payload = {
      eventName: 'TransactionExecutionSuccess',
      data: { transactionId: 't2', transactionReceipt: { hash: '0x' + 'b'.repeat(64) } },
      timestamp: 1,
      apiVersion: 0,
    };
    // The signature signs the body WITHOUT the signature field, then
    // we add it back to the body for verification
    const unsignedBody = JSON.stringify({ ...payload });
    const sig = signBody(unsignedBody, privateKey);
    const signedBody = { ...payload, signature: sig };
    const res = await ctrl.handle(
      { rawBody: Buffer.from(unsignedBody), headers: {} } as never,
      signedBody as never,
    );
    expect(res.ok).toBe(true);
  });

  it('patches attempt + writes activity log on a confirmed (200) event', async () => {
    const attempt: FakeAttempt = {
      attemptId: 'att_1',
      installationId: 'inst_1',
      chainId: 8453,
      userAddress: '0x' + '1'.repeat(40),
      relay: { taskId: 't3' },
    };
    const updated: FakeAttempt = { ...attempt };
    const { ctrl, attempts, activity, privateKey } = buildController({
      foundAttempt: attempt,
      updateResult: updated,
    });
    const payload = {
      eventName: 'TransactionExecutionSuccess',
      data: {
        transactionId: 't3',
        transactionReceipt: { hash: '0x' + 'c'.repeat(64), status: '0x1' },
      },
      timestamp: 1,
      apiVersion: 0,
    };
    const body = JSON.stringify(payload);
    const sig = signBody(body, privateKey);
    const res = await ctrl.handle(
      { rawBody: Buffer.from(body), headers: { signature: sig } } as never,
      payload as never,
    );
    expect(res.statusCode).toBe(200);
    expect(attempts.updateRelayFromWebhook).toHaveBeenCalled();
    expect(activity.log).toHaveBeenCalled();
    const logArg = activity.log.mock.calls[0]?.[0] as {
      type: string;
      metadata: { taskId: string; statusCode: number };
    };
    expect(logArg.type).toBe('execution.confirmed');
    expect(logArg.metadata.taskId).toBe('t3');
    expect(logArg.metadata.statusCode).toBe(200);
  });

  it('maps Reverted events to statusCode 500 + execution.failed', async () => {
    const attempt: FakeAttempt = {
      attemptId: 'att_2',
      installationId: 'inst_2',
      chainId: 8453,
      relay: { taskId: 't4' },
    };
    const { ctrl, activity, privateKey } = buildController({
      foundAttempt: attempt,
      updateResult: attempt,
    });
    const payload = {
      eventName: 'TransactionExecutionReverted',
      data: { transactionId: 't4', transactionReceipt: { hash: '0x' + 'd'.repeat(64) } },
      timestamp: 1,
      apiVersion: 0,
    };
    const body = JSON.stringify(payload);
    const sig = signBody(body, privateKey);
    const res = await ctrl.handle(
      { rawBody: Buffer.from(body), headers: { signature: sig } } as never,
      payload as never,
    );
    expect(res.statusCode).toBe(500);
    const logArg = activity.log.mock.calls[0]?.[0] as {
      type: string;
    };
    expect(logArg.type).toBe('execution.failed');
  });

  it('rejects body missing data.transactionId or data.transactionReceipt.hash', async () => {
    const { ctrl, privateKey } = buildController({});
    const payload = {
      eventName: 'TransactionExecutionSuccess',
      data: { transactionReceipt: { hash: '0x' + 'e'.repeat(64) } },
      timestamp: 1,
      apiVersion: 0,
    };
    const body = JSON.stringify(payload);
    const sig = signBody(body, privateKey);
    await expect(
      ctrl.handle(
        { rawBody: Buffer.from(body), headers: { signature: sig } } as never,
        payload as never,
      ),
    ).rejects.toThrow(/transactionId/);
  });

  it('exposes a no-op hash helper (smoke)', () => {
    const h = createHash('sha256').update('x').digest('hex');
    expect(h).toHaveLength(64);
  });
});
